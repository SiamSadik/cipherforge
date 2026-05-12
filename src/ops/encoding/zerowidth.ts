import type { OpDefinition } from '../types';
import { toBytes, toText } from '../util';

// Zero-width steganography: encode bytes by mapping each bit to a zero-width
// character. Common on social media to hide watermarks in copy-pasted text.
const BIT0 = '\u200B'; // zero-width space
const BIT1 = '\u200C'; // zero-width non-joiner
const BYTE_BOUNDARY = '\u200D'; // zero-width joiner

export const zeroWidthEncode: OpDefinition = {
  id: 'zero-width-encode',
  name: 'Hide in Zero-Width Chars',
  description:
    'Encode the input bytes as a stream of zero-width Unicode characters. Useful for invisible watermarking inside otherwise-normal text.',
  category: 'Encoding',
  args: [
    {
      name: 'cover',
      label: 'Cover text (visible carrier)',
      kind: { type: 'string', default: '' },
    },
  ],
  run: (input, args) => {
    const bytes = toBytes(input);
    const cover = String(args.cover ?? '');
    let zw = '';
    for (let i = 0; i < bytes.length; i++) {
      for (let bit = 7; bit >= 0; bit--) {
        zw += ((bytes[i] >> bit) & 1) ? BIT1 : BIT0;
      }
      zw += BYTE_BOUNDARY;
    }
    if (cover) {
      // Drop the encoded payload after the first character of the cover.
      return cover.slice(0, 1) + zw + cover.slice(1);
    }
    return zw;
  },
};

export const zeroWidthDecode: OpDefinition = {
  id: 'zero-width-decode',
  name: 'Reveal Zero-Width Chars',
  description: 'Extract bytes hidden as zero-width Unicode characters from the input.',
  category: 'Encoding',
  run: (input) => {
    const text = toText(input);
    const out: number[] = [];
    let cur = 0;
    let bits = 0;
    for (const ch of text) {
      if (ch === BIT0 || ch === BIT1) {
        cur = (cur << 1) | (ch === BIT1 ? 1 : 0);
        bits++;
        if (bits === 8) {
          out.push(cur);
          cur = 0;
          bits = 0;
        }
      } else if (ch === BYTE_BOUNDARY) {
        if (bits > 0) {
          out.push(cur);
          cur = 0;
          bits = 0;
        }
      }
    }
    if (bits > 0) out.push(cur << (8 - bits));
    if (out.length === 0) {
      throw new Error('No zero-width payload found in the input.');
    }
    return new Uint8Array(out);
  },
  detect: (input) => {
    const t = toText(input);
    if (/[\u200B\u200C\u200D]/.test(t)) return 0.85;
    return 0;
  },
};
