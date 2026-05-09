import type { OpDefinition } from '../types';
import { toText } from '../util';

const ALPHA = 'ABCDEFGHIKLMNOPQRSTUVWXYZ'; // I/J share a square

function coords(ch: string): string {
  const i = ALPHA.indexOf(ch === 'J' ? 'I' : ch);
  if (i < 0) return '';
  return `${Math.floor(i / 5) + 1}${(i % 5) + 1}`;
}

export const polybiusEncode: OpDefinition = {
  id: 'polybius-encode',
  name: 'Polybius Square Encode',
  description: 'Encode letters as row/column pairs in a 5×5 square (I/J merged).',
  category: 'Cipher',
  run: (input) =>
    toText(input)
      .toUpperCase()
      .split('')
      .map((c) => coords(c))
      .filter(Boolean)
      .join(' '),
};

export const polybiusDecode: OpDefinition = {
  id: 'polybius-decode',
  name: 'Polybius Square Decode',
  description: 'Decode space-separated row/column digit pairs.',
  category: 'Cipher',
  run: (input) =>
    toText(input)
      .trim()
      .split(/\s+/)
      .map((pair) => {
        if (pair.length !== 2) return '';
        const r = parseInt(pair[0], 10);
        const c = parseInt(pair[1], 10);
        if (!r || !c || r < 1 || r > 5 || c < 1 || c > 5) return '';
        return ALPHA[(r - 1) * 5 + (c - 1)];
      })
      .join(''),
};
