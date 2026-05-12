import { describe, expect, it } from 'vitest';
import { evalAtobUnwrap } from '../javascript/eval_atob';
import { fromCharCodeUnwrap } from '../javascript/charcode';
import { packerUnpack } from '../javascript/packer';
import { jjencodeDecode } from '../javascript/jjencode';
import { aaencodeDecode } from '../javascript/aaencode';
import { jsfuckDecode } from '../javascript/jsfuck';
import { xorBrute } from '../cipher/xor_brute';
import type { ArgValue, OpDefinition } from '../types';

const enc = new TextEncoder();
const dec = new TextDecoder();
const toS = (v: Uint8Array | string) => (typeof v === 'string' ? v : dec.decode(v));

async function run(op: OpDefinition, input: string, args: Record<string, ArgValue> = {}): Promise<string> {
  const result = await Promise.resolve(op.run(enc.encode(input), args));
  return toS(result);
}

async function runBytes(
  op: OpDefinition,
  input: Uint8Array,
  args: Record<string, ArgValue> = {},
): Promise<string> {
  const result = await Promise.resolve(op.run(input, args));
  return toS(result);
}

describe('eval(atob(...)) unwrap', () => {
  it('strips a single layer of base64', async () => {
    const inner = "alert('hi')";
    const wrapped = `eval(atob("${btoa(inner)}"))`;
    const out = await run(evalAtobUnwrap, wrapped);
    expect(out).toBe(inner);
  });

  it('strips multiple nested layers', async () => {
    const inner = 'console.log(1)';
    const layer1 = `eval(atob("${btoa(inner)}"))`;
    const layer2 = `eval(atob("${btoa(layer1)}"))`;
    const out = await run(evalAtobUnwrap, layer2);
    expect(out).toBe(inner);
  });

  it('strips eval(unescape(...))', async () => {
    const wrapped = `eval(unescape("hello%20world"))`;
    const out = await run(evalAtobUnwrap, wrapped);
    expect(out).toBe('hello world');
  });
});

describe('String.fromCharCode unwrap', () => {
  it('replaces fromCharCode with the literal string', async () => {
    const input = 'var x = String.fromCharCode(72, 105, 33);';
    const out = await run(fromCharCodeUnwrap, input);
    expect(out).toBe('var x = "Hi!";');
  });

  it('handles fromCodePoint and hex args', async () => {
    const input = 'String.fromCodePoint(0x1F600)';
    const out = await run(fromCharCodeUnwrap, input);
    expect(out).toContain('"');
    expect(out).toContain('\u{1F600}');
  });
});

describe('P.A.C.K.E.R. unpack', () => {
  it('reverses a real packer-style payload', async () => {
    // Output of running the Dean-Edwards packer on `alert("Hello")`
    // (radix 62, 1 keyword).
    const packed =
      "eval(function(p,a,c,k,e,d){e=function(c){return c};if(!''.replace(/^/,String)){while(c--){d[c]=k[c]||c}k=[function(e){return d[e]}];e=function(){return'\\\\w+'};c=1;};while(c--){if(k[c]){p=p.replace(new RegExp('\\\\b'+e(c)+'\\\\b','g'),k[c])}}return p;}('0(\"Hello\")',62,1,'alert'.split('|'),0,{}))";
    const out = await run(packerUnpack, packed);
    expect(out).toBe('alert("Hello")');
  });

  it('detects packer signature', () => {
    const packed = 'eval(function(p,a,c,k,e,d) { return "x"; }())';
    expect(packerUnpack.detect!(enc.encode(packed))).toBeGreaterThan(0.8);
  });

  it('unescapes single-quote escapes inside the payload', async () => {
    // Bug found in test corpus: the canonical Dean-Edwards packer of
    //   alert('hello world');
    // produces a payload of `'0(\'1 2\');'`. The unpacker was returning
    //   alert(\'hello world\');
    // (still escaped). It now must unescape `\\'` → `'` so the result is
    // valid JS source.
    const packed =
      "eval(function(p,a,c,k,e,d){e=function(c){return c.toString(36)};if(!''.replace(/^/,String)){while(c--){d[c.toString(a)]=k[c]||c.toString(a)}k=[function(e){return d[e]}];e=function(){return'\\\\w+'};c=1};while(c--){if(k[c]){p=p.replace(new RegExp('\\\\b'+e(c)+'\\\\b','g'),k[c])}}return p}('0(\\'1 2\\');',3,3,'alert|hello|world'.split('|'),0,{}))";
    const out = await run(packerUnpack, packed);
    expect(out).toBe("alert('hello world');");
  });
});

describe('JJencode detect', () => {
  it('refuses non-JJencode input', async () => {
    await expect(run(jjencodeDecode, 'console.log(1)')).rejects.toThrow();
  });

  it('matches a JJencode prelude detector', () => {
    const sample = '$=~[];$={___:++$,$$$$:(![]+"")[$],';
    expect(jjencodeDecode.detect!(enc.encode(sample))).toBeGreaterThan(0.8);
  });
});

describe('AAencode detect', () => {
  it('refuses plain JS', async () => {
    await expect(run(aaencodeDecode, 'console.log(1)')).rejects.toThrow();
  });

  it('matches kaomoji prelude detector', () => {
    const sample = 'ﾟωﾟﾉ= /｀ｍ´）ノ ~┻━┻';
    expect(aaencodeDecode.detect!(enc.encode(sample))).toBeGreaterThan(0.8);
  });
});

describe('JSFuck detect', () => {
  it('detects all-punctuation alphabet', () => {
    const sample = '+'.repeat(40) + '[]()!'.repeat(20);
    expect(jsfuckDecode.detect!(enc.encode(sample))).toBeGreaterThan(0.8);
  });

  it('refuses normal JS', () => {
    expect(jsfuckDecode.detect!(enc.encode('var foo = 123;'))).toBe(0);
  });
});

describe('XOR brute (single byte)', () => {
  it('recovers English plaintext from key 0x42', async () => {
    const plain = 'The quick brown fox jumps over the lazy dog. Pack my box with five dozen liquor jugs.';
    const key = 0x42;
    const cipher = new Uint8Array(plain.length);
    for (let i = 0; i < plain.length; i++) cipher[i] = plain.charCodeAt(i) ^ key;
    const out = await runBytes(xorBrute, cipher);
    expect(out).toContain('The quick brown fox');
    expect(out).toMatch(/key: 0x42/);
  });
});
