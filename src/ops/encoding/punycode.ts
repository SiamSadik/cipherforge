import type { OpDefinition } from '../types';
import { toText } from '../util';

/**
 * Punycode (RFC 3492) — used to represent Unicode in IDN domain names. We
 * implement the algorithm directly because Node's `punycode` module isn't
 * universally available in the browser and adding a dep is overkill.
 */

const BASE = 36;
const TMIN = 1;
const TMAX = 26;
const SKEW = 38;
const DAMP = 700;
const INITIAL_BIAS = 72;
const INITIAL_N = 128;

function adapt(delta: number, numPoints: number, firstTime: boolean): number {
  delta = firstTime ? Math.floor(delta / DAMP) : delta >> 1;
  delta += Math.floor(delta / numPoints);
  let k = 0;
  for (; delta > ((BASE - TMIN) * TMAX) >> 1; k += BASE) {
    delta = Math.floor(delta / (BASE - TMIN));
  }
  return k + Math.floor(((BASE - TMIN + 1) * delta) / (delta + SKEW));
}

function digitToCp(digit: number): number {
  // 0..25 -> a..z, 26..35 -> 0..9
  return digit + 22 + 75 * (digit < 26 ? 1 : 0);
}

function cpToDigit(cp: number): number {
  if (cp >= 0x30 && cp <= 0x39) return cp - 22; // 0-9 -> 26-35
  if (cp >= 0x41 && cp <= 0x5a) return cp - 65; // A-Z -> 0-25
  if (cp >= 0x61 && cp <= 0x7a) return cp - 97; // a-z -> 0-25
  return -1;
}

function encodePart(label: string): string {
  // Basic codepoints first.
  const out: string[] = [];
  const codepoints = Array.from(label, (c) => c.codePointAt(0)!);
  let n = INITIAL_N;
  let delta = 0;
  let bias = INITIAL_BIAS;
  for (const cp of codepoints) if (cp < 0x80) out.push(String.fromCodePoint(cp));
  let h = out.length;
  const b = h;
  if (b > 0) out.push('-');
  while (h < codepoints.length) {
    let m = Number.MAX_SAFE_INTEGER;
    for (const cp of codepoints) if (cp >= n && cp < m) m = cp;
    delta += (m - n) * (h + 1);
    n = m;
    for (const cp of codepoints) {
      if (cp < n) {
        delta++;
      } else if (cp === n) {
        let q = delta;
        for (let k = BASE; ; k += BASE) {
          const t = k <= bias ? TMIN : k >= bias + TMAX ? TMAX : k - bias;
          if (q < t) break;
          out.push(String.fromCodePoint(digitToCp(t + ((q - t) % (BASE - t)))));
          q = Math.floor((q - t) / (BASE - t));
        }
        out.push(String.fromCodePoint(digitToCp(q)));
        bias = adapt(delta, h + 1, h === b);
        delta = 0;
        h++;
      }
    }
    delta++;
    n++;
  }
  return out.join('');
}

function decodePart(input: string): string {
  let n = INITIAL_N;
  let i = 0;
  let bias = INITIAL_BIAS;
  const lastDash = input.lastIndexOf('-');
  const out: number[] = [];
  if (lastDash > 0) {
    for (let j = 0; j < lastDash; j++) {
      const cp = input.codePointAt(j)!;
      if (cp >= 0x80) throw new Error('Invalid Punycode: non-ASCII before delimiter');
      out.push(cp);
    }
  }
  let pos = lastDash > 0 ? lastDash + 1 : 0;
  while (pos < input.length) {
    const oldI = i;
    let w = 1;
    for (let k = BASE; ; k += BASE) {
      if (pos >= input.length) throw new Error('Punycode: truncated input');
      const digit = cpToDigit(input.codePointAt(pos++)!);
      if (digit < 0) throw new Error('Punycode: invalid digit');
      i += digit * w;
      const t = k <= bias ? TMIN : k >= bias + TMAX ? TMAX : k - bias;
      if (digit < t) break;
      w *= BASE - t;
    }
    bias = adapt(i - oldI, out.length + 1, oldI === 0);
    n += Math.floor(i / (out.length + 1));
    i = i % (out.length + 1);
    out.splice(i, 0, n);
    i++;
  }
  return String.fromCodePoint(...out);
}

export const toPunycode: OpDefinition = {
  id: 'to-punycode',
  name: 'To Punycode',
  description:
    'Encode a Unicode domain name as Punycode (xn--…). Operates label-by-label so a full hostname can be encoded in one shot.',
  category: 'Encoding',
  run: (input) => {
    const text = toText(input).trim();
    return text
      .split('.')
      .map((label) => {
        // ASCII-only label → leave as-is.
        let isAscii = true;
        for (let i = 0; i < label.length; i++) {
          if (label.charCodeAt(i) > 0x7f) {
            isAscii = false;
            break;
          }
        }
        if (isAscii) return label;
        return 'xn--' + encodePart(label);
      })
      .join('.');
  },
};

export const fromPunycode: OpDefinition = {
  id: 'from-punycode',
  name: 'From Punycode',
  description: 'Decode a Punycode-encoded (xn--…) hostname back to Unicode.',
  category: 'Encoding',
  run: (input) => {
    const text = toText(input).trim();
    return text
      .split('.')
      .map((label) =>
        label.toLowerCase().startsWith('xn--') ? decodePart(label.slice(4)) : label,
      )
      .join('.');
  },
  detect: (input) => (toText(input).toLowerCase().includes('xn--') ? 0.9 : 0),
};
