import type { OpDefinition } from '../types';
import { toText } from '../util';

function encodeBase(input: Uint8Array, base: number, padBits: number, separator: string): string {
  const parts: string[] = new Array(input.length);
  for (let i = 0; i < input.length; i++) {
    parts[i] = input[i].toString(base).padStart(padBits, '0');
  }
  return parts.join(separator);
}

function decodeBase(text: string, base: number): Uint8Array {
  const cleaned = text.trim().split(/[\s,;]+/).filter(Boolean);
  const out = new Uint8Array(cleaned.length);
  for (let i = 0; i < cleaned.length; i++) {
    const v = parseInt(cleaned[i], base);
    if (Number.isNaN(v) || v < 0 || v > 255) {
      throw new Error(`Invalid base-${base} byte "${cleaned[i]}"`);
    }
    out[i] = v;
  }
  return out;
}

export const toBinary: OpDefinition = {
  id: 'to-binary',
  name: 'To Binary',
  description: 'Encode bytes as a binary (base-2) string.',
  category: 'Encoding',
  args: [
    {
      name: 'separator',
      label: 'Separator',
      kind: {
        type: 'select',
        options: [
          { value: 'space', label: 'Space' },
          { value: 'none', label: 'None' },
          { value: 'comma', label: 'Comma' },
        ],
        default: 'space',
      },
    },
  ],
  run: (input, args) => {
    const sep = args.separator === 'none' ? '' : args.separator === 'comma' ? ',' : ' ';
    return encodeBase(input, 2, 8, sep);
  },
};

export const fromBinary: OpDefinition = {
  id: 'from-binary',
  name: 'From Binary',
  description: 'Decode a binary (base-2) string. Whitespace and commas are ignored.',
  category: 'Encoding',
  run: (input) => {
    const text = toText(input).replace(/[\s,]+/g, '');
    if (!/^[01]+$/.test(text)) throw new Error('Input contains non-binary characters');
    if (text.length % 8 !== 0) throw new Error('Binary input length must be a multiple of 8');
    const out = new Uint8Array(text.length / 8);
    for (let i = 0; i < out.length; i++) {
      out[i] = parseInt(text.substring(i * 8, i * 8 + 8), 2);
    }
    return out;
  },
};

export const toDecimal: OpDefinition = {
  id: 'to-decimal',
  name: 'To Decimal',
  description: 'Encode bytes as decimal numbers (one byte per integer 0-255).',
  category: 'Encoding',
  run: (input) => encodeBase(input, 10, 0, ' '),
};

export const fromDecimal: OpDefinition = {
  id: 'from-decimal',
  name: 'From Decimal',
  description: 'Decode a whitespace/comma-separated list of decimal byte values.',
  category: 'Encoding',
  run: (input) => decodeBase(toText(input), 10),
};

export const toOctal: OpDefinition = {
  id: 'to-octal',
  name: 'To Octal',
  description: 'Encode bytes as octal (base-8).',
  category: 'Encoding',
  run: (input) => encodeBase(input, 8, 3, ' '),
};

export const fromOctal: OpDefinition = {
  id: 'from-octal',
  name: 'From Octal',
  description: 'Decode whitespace-separated octal byte values.',
  category: 'Encoding',
  run: (input) => decodeBase(toText(input), 8),
};
