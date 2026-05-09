import type { OpDefinition } from '../types';
import { toText } from '../util';

const RFC4648 = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';
const HEX_EXT = '0123456789ABCDEFGHIJKLMNOPQRSTUV';

function table(variant: string): string {
  return variant === 'hex' ? HEX_EXT : RFC4648;
}

function encode(input: Uint8Array, alpha: string, pad: boolean): string {
  let bits = 0;
  let value = 0;
  let out = '';
  for (const b of input) {
    value = (value << 8) | b;
    bits += 8;
    while (bits >= 5) {
      out += alpha[(value >>> (bits - 5)) & 0x1f];
      bits -= 5;
    }
  }
  if (bits > 0) {
    out += alpha[(value << (5 - bits)) & 0x1f];
  }
  if (pad) {
    while (out.length % 8 !== 0) out += '=';
  }
  return out;
}

function decode(text: string, alpha: string): Uint8Array {
  const lookup = new Int8Array(256).fill(-1);
  for (let i = 0; i < alpha.length; i++) {
    lookup[alpha.charCodeAt(i)] = i;
    lookup[alpha.toLowerCase().charCodeAt(i)] = i;
  }
  const cleaned = text.replace(/[\s\r\n]+/g, '').replace(/=+$/, '');
  const out: number[] = [];
  let bits = 0;
  let value = 0;
  for (let i = 0; i < cleaned.length; i++) {
    const v = lookup[cleaned.charCodeAt(i)];
    if (v < 0) throw new Error(`Invalid Base32 character "${cleaned[i]}"`);
    value = (value << 5) | v;
    bits += 5;
    if (bits >= 8) {
      out.push((value >>> (bits - 8)) & 0xff);
      bits -= 8;
    }
  }
  return new Uint8Array(out);
}

export const toBase32: OpDefinition = {
  id: 'to-base32',
  name: 'To Base32',
  description: 'Encode bytes as Base32 (RFC 4648 or hex-extended).',
  category: 'Encoding',
  args: [
    {
      name: 'variant',
      label: 'Alphabet',
      kind: {
        type: 'select',
        options: [
          { value: 'rfc4648', label: 'RFC 4648 (A-Z 2-7)' },
          { value: 'hex', label: 'Extended Hex (0-9 A-V)' },
        ],
        default: 'rfc4648',
      },
    },
    { name: 'pad', label: 'Pad with =', kind: { type: 'boolean', default: true } },
  ],
  run: (input, args) => encode(input, table(String(args.variant ?? 'rfc4648')), Boolean(args.pad ?? true)),
};

export const fromBase32: OpDefinition = {
  id: 'from-base32',
  name: 'From Base32',
  description: 'Decode a Base32 string.',
  category: 'Encoding',
  args: [
    {
      name: 'variant',
      label: 'Alphabet',
      kind: {
        type: 'select',
        options: [
          { value: 'rfc4648', label: 'RFC 4648 (A-Z 2-7)' },
          { value: 'hex', label: 'Extended Hex (0-9 A-V)' },
        ],
        default: 'rfc4648',
      },
    },
  ],
  run: (input, args) => decode(toText(input), table(String(args.variant ?? 'rfc4648'))),
};
