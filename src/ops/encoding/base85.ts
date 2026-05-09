import type { OpDefinition } from '../types';
import { toText } from '../util';

const ASCII85 =
  '!"#$%&\'()*+,-./0123456789:;<=>?@ABCDEFGHIJKLMNOPQRSTUVWXYZ[\\]^_`abcdefghijklmnopqrstu';

function encodeAscii85(input: Uint8Array): string {
  let out = '';
  let i = 0;
  while (i + 4 <= input.length) {
    let n =
      (input[i] * 0x1000000 + (input[i + 1] << 16) + (input[i + 2] << 8) + input[i + 3]) >>> 0;
    if (n === 0) {
      out += 'z';
    } else {
      const chars = new Array(5);
      for (let j = 4; j >= 0; j--) {
        chars[j] = ASCII85[n % 85];
        n = Math.floor(n / 85);
      }
      out += chars.join('');
    }
    i += 4;
  }
  const rem = input.length - i;
  if (rem > 0) {
    let n = 0;
    for (let j = 0; j < 4; j++) n = (n << 8) | (j < rem ? input[i + j] : 0);
    n = n >>> 0;
    const chars = new Array(5);
    for (let j = 4; j >= 0; j--) {
      chars[j] = ASCII85[n % 85];
      n = Math.floor(n / 85);
    }
    out += chars.slice(0, rem + 1).join('');
  }
  return out;
}

function decodeAscii85(text: string): Uint8Array {
  const cleaned = text
    .replace(/^<~/, '')
    .replace(/~>$/, '')
    .replace(/\s+/g, '');
  const bytes: number[] = [];
  let i = 0;
  while (i < cleaned.length) {
    if (cleaned[i] === 'z') {
      bytes.push(0, 0, 0, 0);
      i++;
      continue;
    }
    const chunk = cleaned.substring(i, i + 5);
    const padded = chunk + 'u'.repeat(5 - chunk.length);
    let n = 0;
    for (const ch of padded) {
      const v = ASCII85.indexOf(ch);
      if (v < 0) throw new Error(`Invalid ASCII85 character "${ch}"`);
      n = n * 85 + v;
    }
    const out = [(n >>> 24) & 0xff, (n >>> 16) & 0xff, (n >>> 8) & 0xff, n & 0xff];
    bytes.push(...out.slice(0, chunk.length - 1));
    i += 5;
  }
  return new Uint8Array(bytes);
}

export const toBase85: OpDefinition = {
  id: 'to-base85',
  name: 'To Base85 (ASCII85)',
  description: 'Encode bytes as ASCII85 / Base85.',
  category: 'Encoding',
  run: (input) => encodeAscii85(input),
};

export const fromBase85: OpDefinition = {
  id: 'from-base85',
  name: 'From Base85 (ASCII85)',
  description: 'Decode an ASCII85 / Base85 string.',
  category: 'Encoding',
  run: (input) => decodeAscii85(toText(input)),
};
