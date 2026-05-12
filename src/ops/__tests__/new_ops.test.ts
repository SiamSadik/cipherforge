import { describe, expect, it } from 'vitest';
import { fromBase45, toBase45 } from '../encoding/base45';
import { pemDecode, pemEncode } from '../encoding/pem';
import { fromPunycode, toPunycode } from '../encoding/punycode';
import { zeroWidthDecode, zeroWidthEncode } from '../encoding/zerowidth';
import { hexdump } from '../format/hexdump';
import { parseUrl } from '../format/url';
import { parseQueryString } from '../format/qs';
import { vigenereBrute } from '../cipher/vigenere_brute';
import { lineDiff } from '../format/diff';
import { fromDecimalCodePoints, toDecimalUnicode } from '../format/decimal_unicode';
import type { ArgValue, OpDefinition } from '../types';

const enc = new TextEncoder();
const dec = new TextDecoder();
const toS = (v: Uint8Array | string) => (typeof v === 'string' ? v : dec.decode(v));

async function run(op: OpDefinition, input: string, args: Record<string, ArgValue> = {}): Promise<string> {
  const result = await Promise.resolve(op.run(enc.encode(input), args));
  return toS(result);
}

describe('Base45', () => {
  it('encodes hello', async () => {
    expect(await run(toBase45, 'AB')).toBe('BB8');
  });

  it('round-trips', async () => {
    const encoded = await run(toBase45, 'Hello, World!');
    const decoded = await run(fromBase45, encoded);
    expect(decoded).toBe('Hello, World!');
  });
});

describe('Punycode', () => {
  it('encodes münchen.de', async () => {
    expect(await run(toPunycode, 'münchen.de')).toBe('xn--mnchen-3ya.de');
  });

  it('decodes xn--mnchen-3ya', async () => {
    expect(await run(fromPunycode, 'xn--mnchen-3ya.de')).toBe('münchen.de');
  });
});

describe('PEM', () => {
  it('round-trips bytes', async () => {
    const original = 'cipher forge demo';
    const pem = await run(pemEncode, original, { label: 'TEST' });
    expect(pem).toMatch(/-----BEGIN TEST-----/);
    const der = await run(pemDecode, pem);
    expect(der).toBe(original);
  });
});

describe('Zero-width steg', () => {
  it('round-trips through zero-width chars', async () => {
    const encoded = await run(zeroWidthEncode, 'hi');
    const decoded = await run(zeroWidthDecode, encoded);
    expect(decoded).toBe('hi');
  });
});

describe('hexdump', () => {
  it('produces a recognizable canonical dump', async () => {
    const out = await run(hexdump, 'abc');
    expect(out).toMatch(/00000000.*61.*62.*63.*\|abc\s*\|/s);
  });
});

describe('parseUrl', () => {
  it('parses scheme/host/path/query', async () => {
    const out = JSON.parse(await run(parseUrl, 'https://x.com/a/b?k=v&k=v2#frag'));
    expect(out.scheme).toBe('https');
    expect(out.path).toBe('/a/b');
    expect(out.query.k).toEqual(['v', 'v2']);
    expect(out.hash).toBe('#frag');
  });
});

describe('parseQueryString', () => {
  it('parses with leading ?', async () => {
    const out = JSON.parse(await run(parseQueryString, '?a=1&b=2'));
    expect(out).toEqual({ a: '1', b: '2' });
  });

  it('parses without leading ?', async () => {
    const out = JSON.parse(await run(parseQueryString, 'a=1&b=2'));
    expect(out).toEqual({ a: '1', b: '2' });
  });
});

describe('decimal unicode', () => {
  it('round-trips', async () => {
    const dump = await run(toDecimalUnicode, 'Hi🚀');
    expect(dump).toMatch(/72/); // H
    expect(dump).toMatch(/U\+1F680/); // 🚀
  });

  it('parses U+ hex codepoints back', async () => {
    expect(await run(fromDecimalCodePoints, 'U+0048 U+0069')).toBe('Hi');
  });
});

describe('lineDiff', () => {
  it('reports inserted lines', async () => {
    const out = await run(lineDiff, 'a\nb\nc', { reference: 'a\nc' });
    expect(out).toContain('+1 -0 ~1');
  });
});

describe('Vigenère brute force', () => {
  it('recovers a 5-letter key from English plaintext', async () => {
    // Plaintext encrypted with key "LEMON".
    // Plaintext = "ATTACKATDAWNTHEROCKETSAREALREADYINFLIGHTANDWILLLAUNCHATSUNRISE..."
    const plain =
      'ATTACKATDAWNTHEROCKETSAREALREADYINFLIGHTANDWILLLAUNCHATSUNRISE'.repeat(2);
    const key = 'LEMON';
    let cipher = '';
    for (let i = 0; i < plain.length; i++) {
      const p = plain.charCodeAt(i) - 65;
      const k = key.charCodeAt(i % key.length) - 65;
      cipher += String.fromCharCode(((p + k) % 26) + 65);
    }
    const out = await run(vigenereBrute, cipher);
    expect(out).toMatch(/Recovered key: LEMON/);
  });
});
