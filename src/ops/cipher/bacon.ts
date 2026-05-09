import type { OpDefinition } from '../types';
import { toText } from '../util';

const TABLE: Record<string, string> = {
  A: 'AAAAA', B: 'AAAAB', C: 'AAABA', D: 'AAABB', E: 'AABAA',
  F: 'AABAB', G: 'AABBA', H: 'AABBB', I: 'ABAAA', J: 'ABAAB',
  K: 'ABABA', L: 'ABABB', M: 'ABBAA', N: 'ABBAB', O: 'ABBBA',
  P: 'ABBBB', Q: 'BAAAA', R: 'BAAAB', S: 'BAABA', T: 'BAABB',
  U: 'BABAA', V: 'BABAB', W: 'BABBA', X: 'BABBB', Y: 'BBAAA',
  Z: 'BBAAB',
};

const REVERSE: Record<string, string> = Object.fromEntries(
  Object.entries(TABLE).map(([k, v]) => [v, k]),
);

export const baconEncode: OpDefinition = {
  id: 'bacon-encode',
  name: "Bacon's Cipher Encode",
  description: 'Encode each letter as a 5-character A/B sequence.',
  category: 'Cipher',
  run: (input) =>
    toText(input)
      .toUpperCase()
      .split('')
      .map((c) => TABLE[c] ?? '')
      .filter(Boolean)
      .join(' '),
};

export const baconDecode: OpDefinition = {
  id: 'bacon-decode',
  name: "Bacon's Cipher Decode",
  description: 'Decode A/B (or 0/1) groups of 5 back to letters.',
  category: 'Cipher',
  run: (input) => {
    const norm = toText(input)
      .toUpperCase()
      .replace(/[01]/g, (c) => (c === '0' ? 'A' : 'B'))
      .replace(/[^AB\s]/g, '')
      .replace(/\s+/g, '');
    let out = '';
    for (let i = 0; i < norm.length; i += 5) {
      const chunk = norm.substring(i, i + 5);
      if (chunk.length < 5) break;
      out += REVERSE[chunk] ?? '?';
    }
    return out;
  },
};
