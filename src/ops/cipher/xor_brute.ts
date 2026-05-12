import type { OpDefinition } from '../types';

/**
 * Single-byte XOR brute-force.
 *
 * Try every possible 1-byte key (0..255), score each output by English-text
 * likelihood, and return the most likely plaintext. Useful for first-stage
 * malware unpacking, CTF challenges, simple home-rolled obfuscation.
 */
export const xorBrute: OpDefinition = {
  id: 'xor-brute',
  name: 'XOR Brute (single byte)',
  description:
    'Brute-force a 1-byte XOR key. Returns the highest-scoring plaintext (English-frequency scored).',
  category: 'Cipher',
  args: [
    {
      name: 'top',
      label: 'Top N candidates',
      kind: { type: 'number', default: 1, min: 1, max: 16 },
    },
  ],
  run: (input, args) => {
    const top = Math.min(16, Math.max(1, Number(args.top ?? 1)));
    const candidates: { key: number; score: number; text: string }[] = [];
    for (let k = 0; k < 256; k++) {
      const out = new Uint8Array(input.length);
      for (let i = 0; i < input.length; i++) out[i] = input[i] ^ k;
      const text = new TextDecoder('utf-8', { fatal: false }).decode(out);
      candidates.push({ key: k, score: englishScore(out), text });
    }
    candidates.sort((a, b) => b.score - a.score);
    if (top === 1) {
      const best = candidates[0];
      return `# best key: 0x${best.key.toString(16).padStart(2, '0')} (score ${best.score.toFixed(2)})\n${best.text}`;
    }
    return candidates
      .slice(0, top)
      .map(
        (c, i) =>
          `# ${i + 1}. key 0x${c.key.toString(16).padStart(2, '0')}  score ${c.score.toFixed(2)}\n${c.text}`,
      )
      .join('\n\n---\n\n');
  },
};

// Approximate English letter / space frequency scoring.
const FREQ: Record<string, number> = {
  ' ': 0.180,
  e: 0.103,
  t: 0.075,
  a: 0.065,
  o: 0.062,
  i: 0.058,
  n: 0.057,
  s: 0.053,
  h: 0.050,
  r: 0.048,
  d: 0.034,
  l: 0.033,
  c: 0.024,
  u: 0.023,
  m: 0.020,
  w: 0.019,
  f: 0.018,
  g: 0.016,
  y: 0.016,
  p: 0.015,
  b: 0.013,
  v: 0.0078,
  k: 0.0069,
  j: 0.0014,
  x: 0.0014,
  q: 0.0010,
  z: 0.0007,
};

function englishScore(bytes: Uint8Array): number {
  if (bytes.length === 0) return 0;
  let score = 0;
  for (const b of bytes) {
    const ch = String.fromCharCode(b).toLowerCase();
    const f = FREQ[ch];
    if (f) score += Math.log(f);
    else if (b >= 0x20 && b <= 0x7e) score += Math.log(0.001);
    else if (b === 0x0a || b === 0x0d || b === 0x09) score += Math.log(0.005);
    else score -= 4; // strong penalty for non-printables
  }
  return score / bytes.length;
}
