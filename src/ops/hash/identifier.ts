import type { OpDefinition } from '../types';
import { toText } from '../util';

interface Signature {
  name: string;
  example?: string;
  test: (s: string) => boolean;
  /** Higher score == more confident. */
  weight: number;
}

const SIGNATURES: Signature[] = [
  { name: 'MD5', test: (s) => /^[a-f0-9]{32}$/i.test(s), weight: 50, example: 'plain unsalted MD5' },
  { name: 'NTLM', test: (s) => /^[a-f0-9]{32}$/i.test(s), weight: 30, example: 'Windows NTLM hash' },
  { name: 'MD4', test: (s) => /^[a-f0-9]{32}$/i.test(s), weight: 10 },
  { name: 'SHA-1', test: (s) => /^[a-f0-9]{40}$/i.test(s), weight: 60 },
  { name: 'RIPEMD-160', test: (s) => /^[a-f0-9]{40}$/i.test(s), weight: 20 },
  { name: 'SHA-224', test: (s) => /^[a-f0-9]{56}$/i.test(s), weight: 60 },
  { name: 'SHA-256', test: (s) => /^[a-f0-9]{64}$/i.test(s), weight: 70 },
  { name: 'SHA-384', test: (s) => /^[a-f0-9]{96}$/i.test(s), weight: 70 },
  { name: 'SHA-512', test: (s) => /^[a-f0-9]{128}$/i.test(s), weight: 70 },
  { name: 'CRC-32', test: (s) => /^[a-f0-9]{8}$/i.test(s), weight: 30 },
  { name: 'bcrypt', test: (s) => /^\$2[aybxy]\$\d{2}\$[./A-Za-z0-9]{53}$/.test(s), weight: 95 },
  { name: 'scrypt', test: (s) => /^\$7\$/.test(s), weight: 90 },
  { name: 'Argon2', test: (s) => /^\$argon2(?:i|d|id)\$/.test(s), weight: 95 },
  { name: 'PHPass', test: (s) => /^\$P\$|^\$H\$/.test(s), weight: 80 },
  { name: 'Linux SHA-512 crypt', test: (s) => /^\$6\$/.test(s), weight: 90 },
  { name: 'Linux SHA-256 crypt', test: (s) => /^\$5\$/.test(s), weight: 85 },
  { name: 'Linux MD5 crypt', test: (s) => /^\$1\$/.test(s), weight: 80 },
  { name: 'Apache APR1 MD5', test: (s) => /^\$apr1\$/.test(s), weight: 85 },
  {
    name: 'Django PBKDF2',
    test: (s) => /^pbkdf2_sha\d+\$\d+\$[A-Za-z0-9+/=]+\$/.test(s),
    weight: 90,
  },
  { name: 'JWT', test: (s) => /^e[yJ][A-Za-z0-9_-]+\.[A-Za-z0-9_-]+(\.[A-Za-z0-9_-]+)?$/.test(s), weight: 95 },
  {
    name: 'UUID',
    test: (s) => /^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/i.test(s),
    weight: 95,
  },
  { name: 'MySQL old', test: (s) => /^[a-f0-9]{16}$/i.test(s), weight: 30 },
  { name: 'MySQL 4.1+', test: (s) => /^\*[A-F0-9]{40}$/.test(s), weight: 95 },
  { name: 'Bitcoin/Litecoin Base58 address', test: (s) => /^[13][a-km-zA-HJ-NP-Z1-9]{25,34}$/.test(s), weight: 90 },
];

export const hashIdentify: OpDefinition = {
  id: 'hash-identify',
  name: 'Hash / Token Identifier',
  description: 'Inspect a hash or token and list possible algorithms ranked by confidence.',
  category: 'Hash',
  run: (input) => {
    const text = toText(input).trim();
    if (!text) return '';
    const matches = SIGNATURES.filter((s) => s.test(text)).sort((a, b) => b.weight - a.weight);
    if (matches.length === 0) {
      return `No known hash format recognised.\nLength: ${text.length} chars`;
    }
    const header = `Input: ${text.length} chars\nMatches (highest confidence first):\n`;
    return (
      header +
      matches
        .map(
          (m, i) =>
            `${(i + 1).toString().padStart(2)}. ${m.name.padEnd(28)} ${`(score ${m.weight})`}${
              m.example ? ` — ${m.example}` : ''
            }`,
        )
        .join('\n')
    );
  },
};
