import type { OpDefinition } from '../types';
import { bytesFromHex, bytesToHex, toText } from '../util';

export const toHex: OpDefinition = {
  id: 'to-hex',
  name: 'To Hex',
  description: 'Encode bytes as a hexadecimal string.',
  category: 'Encoding',
  args: [
    {
      name: 'separator',
      label: 'Separator',
      kind: {
        type: 'select',
        options: [
          { value: 'none', label: 'None (deadbeef)' },
          { value: 'space', label: 'Space (de ad be ef)' },
          { value: 'colon', label: 'Colon (de:ad:be:ef)' },
          { value: 'comma', label: 'Comma (de,ad,be,ef)' },
          { value: '0x', label: '0x prefix per byte (0xde 0xad ...)' },
        ],
        default: 'none',
      },
    },
    {
      name: 'uppercase',
      label: 'Uppercase',
      kind: { type: 'boolean', default: false },
    },
  ],
  run: (input, args) => {
    const sepKind = String(args.separator ?? 'none');
    const sep =
      sepKind === 'space' ? ' ' : sepKind === 'colon' ? ':' : sepKind === 'comma' ? ',' : '';
    let out: string;
    if (sepKind === '0x') {
      const parts: string[] = [];
      for (const b of input) parts.push('0x' + b.toString(16).padStart(2, '0'));
      out = parts.join(' ');
    } else {
      out = bytesToHex(input, sep);
    }
    return args.uppercase ? out.toUpperCase() : out;
  },
};

export const fromHex: OpDefinition = {
  id: 'from-hex',
  name: 'From Hex',
  description: 'Decode a hexadecimal string. Whitespace, colons, commas and 0x prefixes are ignored.',
  category: 'Encoding',
  run: (input) => bytesFromHex(toText(input)),
  detect: (input) => {
    const text = toText(input).trim();
    if (text.length < 2) return 0;
    const cleaned = text.replace(/[\s,;:_-]/g, '').replace(/^0x/i, '');
    if (cleaned.length % 2 !== 0) return 0;
    return /^[0-9a-fA-F]+$/.test(cleaned) ? 0.55 : 0;
  },
};
