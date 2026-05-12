import type { OpDefinition } from '../types';
import { toBytes, toText } from '../util';

// Base45 — RFC 9285. Used by EU Digital COVID Certificates (HC1: prefix) and
// some QR-code-friendly payloads. Alphabet: 0-9 A-Z then `$%*+-./:`.
const ALPHABET = '0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZ $%*+-./:';
const VAL_FOR: Record<string, number> = {};
for (let i = 0; i < ALPHABET.length; i++) VAL_FOR[ALPHABET[i]] = i;

export const toBase45: OpDefinition = {
  id: 'to-base45',
  name: 'To Base45',
  description: 'Encode bytes as Base45 (RFC 9285). Used by EU Digital COVID Certificates (HC1).',
  category: 'Encoding',
  run: (input) => {
    const bytes = toBytes(input);
    let out = '';
    for (let i = 0; i + 1 < bytes.length; i += 2) {
      const x = (bytes[i] << 8) | bytes[i + 1];
      const c = x % 45;
      const d = Math.floor(x / 45) % 45;
      const e = Math.floor(x / (45 * 45));
      out += ALPHABET[c] + ALPHABET[d] + ALPHABET[e];
    }
    if (bytes.length % 2 === 1) {
      const x = bytes[bytes.length - 1];
      const c = x % 45;
      const d = Math.floor(x / 45);
      out += ALPHABET[c] + ALPHABET[d];
    }
    return out;
  },
};

export const fromBase45: OpDefinition = {
  id: 'from-base45',
  name: 'From Base45',
  description: 'Decode a Base45 (RFC 9285) string back to bytes.',
  category: 'Encoding',
  run: (input) => {
    // Note: the Base45 alphabet INCLUDES a space, so we can't strip whitespace.
    // We do strip newlines/tabs/CRs (those are never part of the encoded body)
    // and trim leading/trailing newlines.
    const text = toText(input).replace(/[\r\n\t]+/g, '').replace(/^[ ]+|[ ]+$/g, '');
    if (text.length % 3 === 1) throw new Error('Base45: input length cannot be 1 mod 3');
    const out: number[] = [];
    let i = 0;
    // Process full 3-char groups → 2 bytes each.
    while (i + 3 <= text.length && (text.length - i) >= 3 && (text.length - i) % 3 !== 2) {
      let n = 0;
      for (let j = 0; j < 3; j++) {
        const v = VAL_FOR[text[i + j]];
        if (v === undefined) throw new Error(`Base45: invalid char "${text[i + j]}"`);
        n += v * Math.pow(45, j);
      }
      out.push((n >> 8) & 0xff, n & 0xff);
      i += 3;
    }
    // Final group: 3 chars → 2 bytes, 2 chars → 1 byte.
    while (i < text.length) {
      const remaining = text.length - i;
      const take = remaining >= 3 ? 3 : 2;
      let n = 0;
      for (let j = 0; j < take; j++) {
        const v = VAL_FOR[text[i + j]];
        if (v === undefined) throw new Error(`Base45: invalid char "${text[i + j]}"`);
        n += v * Math.pow(45, j);
      }
      if (take === 3) out.push((n >> 8) & 0xff, n & 0xff);
      else out.push(n & 0xff);
      i += take;
    }
    return new Uint8Array(out);
  },
  detect: (input) => {
    const t = toText(input).trim();
    if (t.length < 4) return 0;
    if (/^HC1:/.test(t)) return 0.95;
    if (!/^[0-9A-Z $%*+\-./:]+$/.test(t)) return 0;
    return 0.45;
  },
};
