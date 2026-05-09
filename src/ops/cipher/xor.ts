import type { OpDefinition } from '../types';
import { bytesFromHex, printableRatio, toText } from '../util';

function parseKey(raw: string, format: string): Uint8Array {
  if (raw.length === 0) throw new Error('Key cannot be empty');
  switch (format) {
    case 'utf8':
      return new TextEncoder().encode(raw);
    case 'hex':
      return bytesFromHex(raw);
    case 'base64': {
      const padded = raw.replace(/-/g, '+').replace(/_/g, '/');
      if (typeof atob === 'function') {
        const decoded = atob(padded.padEnd(padded.length + ((4 - (padded.length % 4)) % 4), '='));
        const bytes = new Uint8Array(decoded.length);
        for (let i = 0; i < decoded.length; i++) bytes[i] = decoded.charCodeAt(i);
        return bytes;
      }
      // Browser fallback: shouldn't happen since `atob` is always available, but
      // keep types happy without depending on Node's Buffer.
      throw new Error('Base64 decoding not supported in this environment');
    }
    default:
      throw new Error(`Unknown key format: ${format}`);
  }
}

function xorBytes(input: Uint8Array, key: Uint8Array): Uint8Array {
  const out = new Uint8Array(input.length);
  for (let i = 0; i < input.length; i++) {
    out[i] = input[i] ^ key[i % key.length];
  }
  return out;
}

export const xor: OpDefinition = {
  id: 'xor',
  name: 'XOR',
  description: 'Repeating-key XOR. Self-inverse — use the same key to encrypt and decrypt.',
  category: 'Cipher',
  args: [
    { name: 'key', label: 'Key', kind: { type: 'string', default: 'secret' } },
    {
      name: 'format',
      label: 'Key format',
      kind: {
        type: 'select',
        options: [
          { value: 'utf8', label: 'UTF-8 text' },
          { value: 'hex', label: 'Hex' },
          { value: 'base64', label: 'Base64' },
        ],
        default: 'utf8',
      },
    },
  ],
  run: (input, args) => xorBytes(input, parseKey(String(args.key ?? ''), String(args.format ?? 'utf8'))),
};

export const xorBruteSingleByte: OpDefinition = {
  id: 'xor-brute-byte',
  name: 'XOR Brute Force (1-byte key)',
  description:
    'Try all 256 single-byte XOR keys and show the most plausible plaintexts (ranked by printable-ASCII ratio).',
  category: 'Cipher',
  args: [
    { name: 'top', label: 'Top N candidates', kind: { type: 'number', default: 10, min: 1, max: 256 } },
  ],
  run: (input, args) => {
    const top = Math.max(1, Math.min(256, Number(args.top ?? 10) | 0));
    const candidates: { key: number; score: number; preview: string }[] = [];
    for (let k = 0; k < 256; k++) {
      const out = new Uint8Array(input.length);
      for (let i = 0; i < input.length; i++) out[i] = input[i] ^ k;
      const score = printableRatio(out);
      candidates.push({
        key: k,
        score,
        preview: toText(out.slice(0, 120)).replace(
          // eslint-disable-next-line no-control-regex
          /[\x00-\x1f]/g,
          '·',
        ),
      });
    }
    candidates.sort((a, b) => b.score - a.score);
    const lines = candidates
      .slice(0, top)
      .map(
        (c) =>
          `key=0x${c.key.toString(16).padStart(2, '0')} (${c.key.toString().padStart(3)}) ` +
          `score=${(c.score * 100).toFixed(1).padStart(5)}%  ${c.preview}`,
      );
    return lines.join('\n');
  },
};
