import type { OpDefinition } from '../types';
import { toText } from '../util';

function modInverse(a: number, m: number): number {
  a = ((a % m) + m) % m;
  for (let x = 1; x < m; x++) {
    if ((a * x) % m === 1) return x;
  }
  throw new Error(`'a' (${a}) has no modular inverse mod ${m} — pick a value coprime with 26`);
}

function applyAffine(text: string, a: number, b: number, encrypt: boolean): string {
  const m = 26;
  const aInv = encrypt ? a : modInverse(a, m);
  let out = '';
  for (const ch of text) {
    const code = ch.charCodeAt(0);
    if (code >= 65 && code <= 90) {
      const x = code - 65;
      const y = encrypt ? (a * x + b) % m : (aInv * (x - b + m * m)) % m;
      out += String.fromCharCode(((y % m) + m) % m + 65);
    } else if (code >= 97 && code <= 122) {
      const x = code - 97;
      const y = encrypt ? (a * x + b) % m : (aInv * (x - b + m * m)) % m;
      out += String.fromCharCode(((y % m) + m) % m + 97);
    } else {
      out += ch;
    }
  }
  return out;
}

export const affineEncrypt: OpDefinition = {
  id: 'affine-encrypt',
  name: 'Affine Encrypt',
  description: 'E(x) = (a·x + b) mod 26. `a` must be coprime with 26.',
  category: 'Cipher',
  args: [
    { name: 'a', label: 'a', kind: { type: 'number', default: 5, min: 1, max: 25 } },
    { name: 'b', label: 'b', kind: { type: 'number', default: 8, min: 0, max: 25 } },
  ],
  run: (input, args) => applyAffine(toText(input), Number(args.a ?? 5), Number(args.b ?? 8), true),
};

export const affineDecrypt: OpDefinition = {
  id: 'affine-decrypt',
  name: 'Affine Decrypt',
  description: 'D(y) = a⁻¹·(y − b) mod 26.',
  category: 'Cipher',
  args: [
    { name: 'a', label: 'a', kind: { type: 'number', default: 5, min: 1, max: 25 } },
    { name: 'b', label: 'b', kind: { type: 'number', default: 8, min: 0, max: 25 } },
  ],
  run: (input, args) => applyAffine(toText(input), Number(args.a ?? 5), Number(args.b ?? 8), false),
};
