import { describe, it, expect } from 'vitest';
import { deadCodeElim } from '../javascript/dead_code';
import { toText } from '../util';

const enc = new TextEncoder();
const run = async (src: string): Promise<string> => {
  const out = await Promise.resolve(deadCodeElim.run(enc.encode(src), {}));
  return typeof out === 'string' ? out : toText(out);
};

describe('js-dead-code-elim', () => {
  it('removes statements after a return', async () => {
    const src = `function f() {
      return 42;
      console.log("never runs");
      var unused = 1;
    }`;
    const out = await run(src);
    expect(out).toContain('return 42');
    expect(out).not.toContain('console.log("never runs")');
  });

  it('removes if (false) branches', async () => {
    const src = `if (false) { console.log("dead"); }
                 if (true) { console.log("alive"); }`;
    const out = await run(src);
    expect(out).toContain('alive');
    expect(out).not.toContain('dead');
  });

  it('keeps reachable statements untouched', async () => {
    const src = `function f(x) {
      if (x) {
        return 1;
      }
      return 2;
    }`;
    const out = await run(src);
    expect(out).toContain('return 1');
    expect(out).toContain('return 2');
  });

  it('removes _0x... assignment lines that come after a return', async () => {
    // Models the obfuscator.io self-defending decoy pattern
    const src = `function f() {
      return result;
      _0x3759e8 = undefined || {};
      _0x5876c6(_0xf8093c[_0x3f69e]);
    }`;
    const out = await run(src);
    expect(out).not.toContain('_0x3759e8');
    expect(out).not.toContain('_0x5876c6');
    expect(out).toContain('return result');
  });

  it('keeps reachable variables intact', async () => {
    const src = `function f(cond) {
      if (cond) return early;
      var x = 1;
      return x;
    }`;
    const out = await run(src);
    // The var x = 1 path is reachable when !cond, so it must survive
    expect(out).toContain('x = 1');
  });
});
