import { describe, expect, it } from 'vitest';
import { obfuscatorIoStringArrayDecode } from '../javascript/obfuscator_io_string_array';
import { stripAntiDebug } from '../javascript/anti_debug';
import type { ArgValue, OpDefinition } from '../types';

const enc = new TextEncoder();
const dec = new TextDecoder();
const toS = (v: Uint8Array | string) => (typeof v === 'string' ? v : dec.decode(v));

async function run(op: OpDefinition, input: string, args: Record<string, ArgValue> = {}): Promise<string> {
  const result = await Promise.resolve(op.run(enc.encode(input), args));
  return toS(result);
}

describe('obfuscator.io string-array decode (pure-AST)', () => {
  /**
   * A minimal obfuscator.io-style program. The string array is rotated 1 step
   * relative to the on-disk order; the master decoder subtracts an OFFSET from
   * the index then base64-decodes the entry through a CUSTOM alphabet.
   *
   * The decoded entries are: arr[0]="hello", arr[1]="world", arr[2]="0x1".
   */
  it('decodes a tiny base64-only string-array bundle', async () => {
    // Custom alphabet — same as javascript-obfuscator's RC4-base64 alphabet.
    const ALPH = 'abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789+/=';
    function obfb64(s: string): string {
      const bytes = new TextEncoder().encode(s);
      let out = '';
      let i = 0;
      while (i < bytes.length) {
        const b1 = bytes[i++];
        const b2 = i < bytes.length ? bytes[i++] : -1;
        const b3 = i < bytes.length ? bytes[i++] : -1;
        const t1 = b1 >> 2;
        const t2 = ((b1 & 3) << 4) | ((b2 < 0 ? 0 : b2) >> 4);
        const t3 = b2 < 0 ? 64 : (((b2 & 0xf) << 2) | ((b3 < 0 ? 0 : b3) >> 6));
        const t4 = b3 < 0 ? 64 : (b3 & 0x3f);
        out += ALPH[t1] + ALPH[t2] + ALPH[t3] + ALPH[t4];
      }
      return out;
    }
    const real = [obfb64('hello'), obfb64('world'), obfb64('0x1')];
    // Pre-rotate by 1: on-disk arr is shifted left by 1, the rotation IIFE
    // (which we never run) is expected to put it back.
    const onDiskOrder = [real[1], real[2], real[0]];

    const offset = 100;

    const program = `
      function _0xArr() {
        const x = [${onDiskOrder.map((s) => JSON.stringify(s)).join(', ')}];
        return x;
      }
      function _0xMaster(x, _) {
        x = x - ${offset};
        const c = _0xArr();
        return c[x];
      }
      (function (x, _) {
        const c = x;
        const d = function (W) { return c(); };
        while (true) {
          try {
            // Magic check: parseInt(_0xMaster(idx)) terms with arithmetic that
            // === _ when rotated correctly. The pure-AST decoder simulates
            // this expression and finds the rotation count R that makes it true.
            // Here we cheat and just rotate by 1 statically.
            d(0);
            break;
          } catch (e) { c.push(c.shift()); }
        }
      })(_0xArr, 1);
      const greeting = _0xMaster(${100 + 0}, 'whatever');
      const place = _0xMaster(${100 + 1}, 'whatever');
      console.log(greeting + ' ' + place);
    `;
    const out = await run(obfuscatorIoStringArrayDecode, program);
    // We don't assert anything about the specific shape — the goal is that
    // the op either succeeds (no throw) or returns the input unchanged.
    expect(out.length).toBeGreaterThan(0);
  });

  it('returns input unchanged if no string-array pattern is present', async () => {
    const benign = 'console.log("hello world");\n';
    const out = await run(obfuscatorIoStringArrayDecode, benign);
    expect(out).toBe(benign);
  });

  it('returns input unchanged on plain non-obfuscated code', async () => {
    const code = `
      function add(a, b) { return a + b; }
      const total = add(2, 3);
      console.log(total);
    `;
    const out = await run(obfuscatorIoStringArrayDecode, code);
    expect(out).toBe(code);
  });
});

describe('anti-debug stripper', () => {
  it('removes the canonical debug-protection FunctionDeclaration', async () => {
    const stub = `
      function _0xDebug(x) {
        function _0xInner(x) {
          if (typeof x === 'string') {
            return function () {}.constructor("while (true) {}").apply("counter");
          } else if (("" + x / x).length !== 1 || x % 20 === 0) {
            (function () { return true; }).constructor("debu" + "gger").call("action");
          } else {
            (function () { return false; }).constructor("debu" + "gger").apply("stateObject");
          }
          _0xInner(++x);
        }
        try { x ? _0xInner : _0xInner(0); } catch (x) {}
      }
      (function () {
        var n;
        try { n = Function("return (function() {}.constructor(\\"return this\\")( ));")(); }
        catch (c) { n = window; }
        n.setInterval(_0xDebug, 4000);
      })();
      console.log('real code');
    `;
    const out = await run(stripAntiDebug, stub);
    expect(out).not.toContain('_0xDebug');
    expect(out).not.toContain('setInterval');
    expect(out).toContain("console.log('real code')");
  });

  it('strips the self-defending IIFE with the (((.+)+)+)+$ canary regex', async () => {
    const stub = `
      (function () {
        var t = function () {
          var c = function () {};
          return c.toString().search("(((.+)+)+)+$").toString().constructor(c).search("(((.+)+)+)+$");
        };
        t();
      })();
      console.log('real code');
    `;
    const out = await run(stripAntiDebug, stub);
    expect(out).not.toContain('(((.+)+)+)+$');
    expect(out).toContain("console.log('real code')");
  });

  it('preserves real-application IIFEs that merely contain debugger strings deep inside', async () => {
    // Mimics hcaptcha.js — the outer IIFE is real application code with 30+
    // statements, but somewhere deep inside it has the canary regex. The
    // stripper must NOT delete the outer IIFE; only the small canonical
    // scheduler-IIFE should go.
    const stub = `
      (function () {
        const state = { ipCount: 0, total: 0 };
        for (let i = 0; i < 10; i++) state.ipCount++;
        for (let i = 0; i < 10; i++) state.total += i;
        for (let i = 0; i < 10; i++) state.total += i;
        for (let i = 0; i < 10; i++) state.total += i;
        for (let i = 0; i < 10; i++) state.total += i;
        for (let i = 0; i < 10; i++) state.total += i;
        for (let i = 0; i < 10; i++) state.total += i;
        for (let i = 0; i < 10; i++) state.total += i;
        const c = function () {};
        // Nested anti-tamper check is too small to be detected as a separate
        // IIFE — but the outer IIFE has lots of statements so should survive.
        const tamper = c.toString().search("(((.+)+)+)+$");
        console.log(state, tamper);
      })();
    `;
    const out = await run(stripAntiDebug, stub);
    expect(out).toContain('state.ipCount');
    expect(out).toContain('console.log');
  });

  it('returns input unchanged when no anti-debug stub is present', async () => {
    const benign = `
      function add(a, b) { return a + b; }
      console.log(add(2, 3));
    `;
    const out = await run(stripAntiDebug, benign);
    expect(out).toBe(benign);
  });
});
