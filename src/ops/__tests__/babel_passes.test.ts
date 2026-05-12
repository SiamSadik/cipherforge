import { describe, expect, it } from 'vitest';
import { constantFold } from '../javascript/constant_fold';
import { smartRename } from '../javascript/smart_rename';
import type { ArgValue, OpDefinition } from '../types';

const enc = new TextEncoder();
const dec = new TextDecoder();
const toS = (v: Uint8Array | string) => (typeof v === 'string' ? v : dec.decode(v));

async function run(op: OpDefinition, input: string, args: Record<string, ArgValue> = {}): Promise<string> {
  const result = await Promise.resolve(op.run(enc.encode(input), args));
  return toS(result);
}

describe('Constant folding', () => {
  it('concatenates string literals', async () => {
    const out = await run(constantFold, "var x = 'a' + 'b' + 'c';");
    expect(out).toContain("'abc'");
    expect(out).not.toContain("'a' + ");
  });

  it('folds !0 / !1 / !![] / +[]', async () => {
    const out = await run(constantFold, 'var a=!0, b=!1, c=!![], d=+[];');
    expect(out).toContain('true');
    expect(out).toContain('false');
    expect(out).toContain('0');
  });

  it('folds arithmetic', async () => {
    const out = await run(constantFold, 'var x = 1 + 2 * 3;');
    expect(out).toMatch(/var x = 7;/);
  });

  it('folds string indexing and length', async () => {
    const out = await run(constantFold, "var a = 'abc'[0]; var b = 'abc'.length;");
    expect(out).toContain("'a'");
    expect(out).toContain('3');
  });

  it('simplifies && / ||', async () => {
    const out = await run(constantFold, 'var x = true && y; var z = false || w;');
    expect(out).toContain('var x = y');
    expect(out).toContain('var z = w');
  });

  it('simplifies ternaries with constant tests', async () => {
    const out = await run(constantFold, 'var x = (1 < 2) ? a : b;');
    expect(out).toMatch(/var x = a;/);
  });
});

describe('Smart rename', () => {
  it('renames _0xabc1234 to readable seeds', async () => {
    const out = await run(
      smartRename,
      "var _0xabc1234 = 'https://api.example.com'; var _0xdef5678 = 42; function _0x9999(x) { return x + 1; }",
    );
    expect(out).toMatch(/var apiUrl = /);
    expect(out).toMatch(/var n = 42/);
    expect(out).toMatch(/function fn\(/);
    expect(out).not.toContain('_0xabc1234');
  });

  it('numbers collisions sequentially', async () => {
    // When a string isn't an identifier-like keyword the rename falls back to
    // the `str` bucket and counts collisions.
    const out = await run(
      smartRename,
      "var _0xa1 = 'hi there'; var _0xa2 = 'foo bar'; var _0xa3 = 'baz qux';",
    );
    expect(out).toMatch(/var (str|errMsg|msg)\s*=/);
    // All three vars should have been renamed to something other than _0x….
    expect(out).not.toContain('_0xa1');
    expect(out).not.toContain('_0xa2');
    expect(out).not.toContain('_0xa3');
  });

  it('renames function parameters by usage in body', async () => {
    // String-like usage (.split / .toUpperCase) → `str`. Numeric usage → `n`.
    const out = await run(
      smartRename,
      "function _0x111(_0xaaa, _0xbbb) { return _0xaaa.split('.').length + _0xbbb * 2; }",
    );
    expect(out).toMatch(/function fn\(/);
    expect(out).toMatch(/\bstr\b/);
    expect(out).toMatch(/\bn\b/);
    expect(out).not.toContain('_0xaaa');
    expect(out).not.toContain('_0xbbb');
  });

  it('leaves normal identifiers alone', async () => {
    const out = await run(smartRename, 'function greet() { return "hi"; }');
    expect(out).toContain('function greet');
  });

  it('renames destructuring targets to their property keys', async () => {
    // `{ profile: _0x47ef74 }` — the property name `profile` is the rename hint.
    const out = await run(
      smartRename,
      'function f(s) { const { profile: _0x47ef74, enabled: _0x4ec065, toggles: _0x384408 } = s; return [_0x47ef74, _0x4ec065, _0x384408]; }',
    );
    expect(out).toContain('profile');
    expect(out).toContain('enabled');
    expect(out).toContain('toggles');
    expect(out).not.toContain('_0x47ef74');
    expect(out).not.toContain('_0x4ec065');
    expect(out).not.toContain('_0x384408');
  });

  it('renames catch-clause params to err', async () => {
    const out = await run(
      smartRename,
      'function f() { try { doIt(); } catch (_0x1ff95c) { console.log(_0x1ff95c); } }',
    );
    expect(out).toContain('catch (err)');
    expect(out).not.toContain('_0x1ff95c');
  });

  it('renames Promise constructor params to resolve / reject', async () => {
    const out = await run(
      smartRename,
      'var p = new Promise(function(_0xa11, _0xb22){ _0xa11(1); _0xb22(2); });',
    );
    expect(out).toContain('resolve');
    expect(out).toContain('reject');
    expect(out).not.toContain('_0xa11');
    expect(out).not.toContain('_0xb22');
  });

  it('replaces unbound _0x… references with undefined', async () => {
    // Simulates the leftover from a buggy proxy-fn inliner.
    const out = await run(smartRename, 'var x = MAP[_0xdeadbeef] || "fallback";');
    expect(out).not.toContain('_0xdeadbeef');
    expect(out).toContain('undefined');
  });

  it('zero _0x… identifiers remain on combined patterns', async () => {
    const code =
      "function _0x1(_0xa, _0xb) { try { const { foo: _0xc, bar: _0xd } = _0xa; return _0xc + _0xd + _0xb; } catch (_0xe) { return _0xe.message; } }";
    const out = await run(smartRename, code);
    expect(out).not.toMatch(/_0x[0-9a-fA-F]+/);
  });
});
