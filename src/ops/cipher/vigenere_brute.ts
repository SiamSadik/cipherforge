import type { OpDefinition } from '../types';
import { toText } from '../util';

/**
 * Vigenère brute-force using the Index of Coincidence to estimate key length,
 * then chi-squared frequency analysis to recover each character of the key.
 *
 * This is a classic textbook attack on Vigenère; works on English plaintext.
 */

const ENGLISH_FREQ: Record<string, number> = {
  A: 8.167, B: 1.492, C: 2.782, D: 4.253, E: 12.702, F: 2.228, G: 2.015,
  H: 6.094, I: 6.966, J: 0.153, K: 0.772, L: 4.025, M: 2.406, N: 6.749,
  O: 7.507, P: 1.929, Q: 0.095, R: 5.987, S: 6.327, T: 9.056, U: 2.758,
  V: 0.978, W: 2.360, X: 0.150, Y: 1.974, Z: 0.074,
};

function indexOfCoincidence(s: string): number {
  if (s.length < 2) return 0;
  const counts: Record<string, number> = {};
  for (const c of s) counts[c] = (counts[c] ?? 0) + 1;
  let sum = 0;
  for (const v of Object.values(counts)) sum += v * (v - 1);
  return sum / (s.length * (s.length - 1));
}

function bestShift(slice: string): number {
  let bestK = 0;
  let bestScore = Infinity;
  for (let k = 0; k < 26; k++) {
    const counts = new Array(26).fill(0);
    for (const c of slice) {
      const idx = (c.charCodeAt(0) - 65 - k + 26) % 26;
      counts[idx]++;
    }
    let chi = 0;
    for (let i = 0; i < 26; i++) {
      const expected = (ENGLISH_FREQ[String.fromCharCode(65 + i)] / 100) * slice.length;
      if (expected === 0) continue;
      chi += ((counts[i] - expected) ** 2) / expected;
    }
    if (chi < bestScore) {
      bestScore = chi;
      bestK = k;
    }
  }
  return bestK;
}

export const vigenereBrute: OpDefinition = {
  id: 'vigenere-brute',
  name: 'Vigenère Brute Force',
  description:
    'Recover the Vigenère key by Index-of-Coincidence + chi-squared frequency analysis. Works best on English plaintext.',
  category: 'Cipher',
  args: [
    {
      name: 'maxKeyLen',
      label: 'Max key length to try',
      kind: { type: 'number', default: 12, min: 2, max: 32 },
    },
  ],
  run: (input, args) => {
    const text = toText(input).toUpperCase().replace(/[^A-Z]/g, '');
    if (text.length < 30) {
      throw new Error('Vigenère brute-force needs at least ~30 letters of ciphertext.');
    }
    const maxK = Math.min(Number(args.maxKeyLen ?? 12), text.length / 4);
    let bestLen = 1;
    let bestIc = 0;
    for (let n = 1; n <= maxK; n++) {
      let ic = 0;
      for (let i = 0; i < n; i++) {
        let chunk = '';
        for (let j = i; j < text.length; j += n) chunk += text[j];
        ic += indexOfCoincidence(chunk);
      }
      ic /= n;
      // English IC ~0.067, random ~0.038. Pick the smallest length whose IC
      // is meaningfully closer to English than the ones below it.
      if (ic > bestIc + 0.005) {
        bestIc = ic;
        bestLen = n;
      }
    }
    const keyChars: string[] = [];
    for (let i = 0; i < bestLen; i++) {
      let chunk = '';
      for (let j = i; j < text.length; j += bestLen) chunk += text[j];
      keyChars.push(String.fromCharCode(65 + bestShift(chunk)));
    }
    const key = keyChars.join('');
    const fullText = toText(input);
    let outChars = '';
    let kIdx = 0;
    for (const ch of fullText) {
      const code = ch.charCodeAt(0);
      const isUpper = code >= 65 && code <= 90;
      const isLower = code >= 97 && code <= 122;
      if (!isUpper && !isLower) {
        outChars += ch;
        continue;
      }
      const base = isUpper ? 65 : 97;
      const shift = key.charCodeAt(kIdx % key.length) - 65;
      const decoded = ((code - base - shift + 26) % 26) + base;
      outChars += String.fromCharCode(decoded);
      kIdx++;
    }
    return [
      `Recovered key length: ${bestLen}`,
      `Recovered key: ${key}`,
      `Index of Coincidence: ${bestIc.toFixed(4)}`,
      '',
      outChars,
    ].join('\n');
  },
};
