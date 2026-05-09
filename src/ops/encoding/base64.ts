import type { OpDefinition } from '../types';
import { toText } from '../util';

const STD = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/';
const URL_SAFE = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_';

function alphabet(variant: string): string {
  return variant === 'url' ? URL_SAFE : STD;
}

function encode(input: Uint8Array, alpha: string, pad: boolean): string {
  let out = '';
  let i = 0;
  while (i + 3 <= input.length) {
    const a = input[i++];
    const b = input[i++];
    const c = input[i++];
    out +=
      alpha[a >> 2] +
      alpha[((a & 3) << 4) | (b >> 4)] +
      alpha[((b & 15) << 2) | (c >> 6)] +
      alpha[c & 63];
  }
  const rem = input.length - i;
  if (rem === 1) {
    const a = input[i];
    out += alpha[a >> 2] + alpha[(a & 3) << 4] + (pad ? '==' : '');
  } else if (rem === 2) {
    const a = input[i];
    const b = input[i + 1];
    out += alpha[a >> 2] + alpha[((a & 3) << 4) | (b >> 4)] + alpha[(b & 15) << 2] + (pad ? '=' : '');
  }
  return out;
}

function decode(text: string, alpha: string): Uint8Array {
  const lookup = new Int8Array(256).fill(-1);
  for (let i = 0; i < alpha.length; i++) lookup[alpha.charCodeAt(i)] = i;
  // Accept either alphabet by also marking the cross-variant chars.
  if (alpha === STD) {
    lookup['-'.charCodeAt(0)] = 62;
    lookup['_'.charCodeAt(0)] = 63;
  } else {
    lookup['+'.charCodeAt(0)] = 62;
    lookup['/'.charCodeAt(0)] = 63;
  }
  const cleaned = text.replace(/[\s\r\n]+/g, '').replace(/=+$/, '');
  const bytes = new Uint8Array(Math.floor((cleaned.length * 3) / 4));
  let bitBuf = 0;
  let bits = 0;
  let outIdx = 0;
  for (let i = 0; i < cleaned.length; i++) {
    const v = lookup[cleaned.charCodeAt(i)];
    if (v < 0) throw new Error(`Invalid Base64 character "${cleaned[i]}" at position ${i}`);
    bitBuf = (bitBuf << 6) | v;
    bits += 6;
    if (bits >= 8) {
      bits -= 8;
      bytes[outIdx++] = (bitBuf >> bits) & 0xff;
    }
  }
  return bytes.slice(0, outIdx);
}

export const toBase64: OpDefinition = {
  id: 'to-base64',
  name: 'To Base64',
  description: 'Encode bytes as Base64. Standard or URL-safe alphabet.',
  category: 'Encoding',
  args: [
    {
      name: 'variant',
      label: 'Alphabet',
      kind: {
        type: 'select',
        options: [
          { value: 'standard', label: 'Standard (+ /)' },
          { value: 'url', label: 'URL-safe (- _)' },
        ],
        default: 'standard',
      },
    },
    { name: 'pad', label: 'Pad with =', kind: { type: 'boolean', default: true } },
  ],
  run: (input, args) => encode(input, alphabet(String(args.variant ?? 'standard')), Boolean(args.pad ?? true)),
};

export const fromBase64: OpDefinition = {
  id: 'from-base64',
  name: 'From Base64',
  description: 'Decode a Base64 string. Accepts either the standard or URL-safe alphabet.',
  category: 'Encoding',
  args: [
    {
      name: 'variant',
      label: 'Alphabet',
      kind: {
        type: 'select',
        options: [
          { value: 'standard', label: 'Standard (+ /)' },
          { value: 'url', label: 'URL-safe (- _)' },
        ],
        default: 'standard',
      },
    },
  ],
  run: (input, args) => decode(toText(input), alphabet(String(args.variant ?? 'standard'))),
  detect: (input) => {
    const text = toText(input).trim();
    if (text.length < 4 || text.length % 4 !== 0) return 0;
    if (!/^[A-Za-z0-9+/=\s]+$/.test(text) && !/^[A-Za-z0-9_\-=\s]+$/.test(text)) return 0;
    return 0.6;
  },
};
