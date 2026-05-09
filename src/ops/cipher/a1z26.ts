import type { OpDefinition } from '../types';
import { toText } from '../util';

export const a1z26Encode: OpDefinition = {
  id: 'a1z26-encode',
  name: 'A1Z26 Encode',
  description: 'Map A=1, B=2, ..., Z=26. Letters separated by `-`, words by space.',
  category: 'Cipher',
  run: (input) =>
    toText(input)
      .toUpperCase()
      .split(/(\s+)/)
      .map((seg) => {
        if (/^\s+$/.test(seg)) return ' ';
        return seg
          .split('')
          .filter((c) => c >= 'A' && c <= 'Z')
          .map((c) => c.charCodeAt(0) - 64)
          .join('-');
      })
      .join('')
      .trim(),
};

export const a1z26Decode: OpDefinition = {
  id: 'a1z26-decode',
  name: 'A1Z26 Decode',
  description: 'Decode A1Z26-encoded letters. Numbers separated by `-`, words by spaces.',
  category: 'Cipher',
  run: (input) =>
    toText(input)
      .split(/\s+/)
      .map((word) =>
        word
          .split('-')
          .filter(Boolean)
          .map((n) => {
            const v = parseInt(n, 10);
            if (Number.isNaN(v) || v < 1 || v > 26) return '';
            return String.fromCharCode(64 + v);
          })
          .join(''),
      )
      .join(' '),
};
