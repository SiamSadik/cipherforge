import CryptoJS from 'crypto-js';
import type { OpDefinition } from '../types';
import { bytesToHex, toText } from '../util';

function bytesToWordArray(input: Uint8Array): CryptoJS.lib.WordArray {
  const words: number[] = [];
  for (let i = 0; i < input.length; i += 4) {
    words.push(
      ((input[i] ?? 0) << 24) |
        ((input[i + 1] ?? 0) << 16) |
        ((input[i + 2] ?? 0) << 8) |
        (input[i + 3] ?? 0),
    );
  }
  return CryptoJS.lib.WordArray.create(words, input.length);
}

function makeHashOp(
  id: string,
  name: string,
  description: string,
  hasher: (wa: CryptoJS.lib.WordArray) => CryptoJS.lib.WordArray,
): OpDefinition {
  return {
    id,
    name,
    description,
    category: 'Hash',
    run: (input) => hasher(bytesToWordArray(input)).toString(CryptoJS.enc.Hex),
  };
}

export const md5 = makeHashOp('md5', 'MD5', 'MD5 hash. Broken — do not use for security.', CryptoJS.MD5);
export const sha1 = makeHashOp('sha1', 'SHA-1', 'SHA-1 hash. Broken — do not use for security.', CryptoJS.SHA1);
export const sha224 = makeHashOp('sha224', 'SHA-224', 'SHA-224 (truncated SHA-256).', CryptoJS.SHA224);
export const sha256 = makeHashOp('sha256', 'SHA-256', 'SHA-256.', CryptoJS.SHA256);
export const sha384 = makeHashOp('sha384', 'SHA-384', 'SHA-384.', CryptoJS.SHA384);
export const sha512 = makeHashOp('sha512', 'SHA-512', 'SHA-512.', CryptoJS.SHA512);
export const sha3_256 = makeHashOp(
  'sha3-256',
  'SHA-3 (256)',
  'SHA-3 with 256-bit output.',
  (wa) => CryptoJS.SHA3(wa, { outputLength: 256 }),
);
export const sha3_512 = makeHashOp(
  'sha3-512',
  'SHA-3 (512)',
  'SHA-3 with 512-bit output.',
  (wa) => CryptoJS.SHA3(wa, { outputLength: 512 }),
);
export const ripemd160 = makeHashOp(
  'ripemd160',
  'RIPEMD-160',
  'RIPEMD-160 (used in Bitcoin addresses).',
  CryptoJS.RIPEMD160,
);

export const hmac: OpDefinition = {
  id: 'hmac',
  name: 'HMAC',
  description: 'Keyed hash. Pick the underlying hash and supply a key.',
  category: 'Hash',
  args: [
    { name: 'key', label: 'Key', kind: { type: 'string', default: 'secret' } },
    {
      name: 'algo',
      label: 'Algorithm',
      kind: {
        type: 'select',
        options: [
          { value: 'sha1', label: 'HMAC-SHA1' },
          { value: 'sha256', label: 'HMAC-SHA256' },
          { value: 'sha384', label: 'HMAC-SHA384' },
          { value: 'sha512', label: 'HMAC-SHA512' },
          { value: 'md5', label: 'HMAC-MD5' },
        ],
        default: 'sha256',
      },
    },
  ],
  run: (input, args) => {
    const key = String(args.key ?? '');
    const algo = String(args.algo ?? 'sha256');
    const map: Record<string, (m: CryptoJS.lib.WordArray, k: string) => CryptoJS.lib.WordArray> = {
      sha1: CryptoJS.HmacSHA1,
      sha256: CryptoJS.HmacSHA256,
      sha384: CryptoJS.HmacSHA384,
      sha512: CryptoJS.HmacSHA512,
      md5: CryptoJS.HmacMD5,
    };
    const fn = map[algo];
    if (!fn) throw new Error(`Unknown HMAC algorithm: ${algo}`);
    return fn(bytesToWordArray(input), key).toString(CryptoJS.enc.Hex);
  },
};

const CRC_TABLE = (() => {
  const table = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) {
      c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    }
    table[n] = c >>> 0;
  }
  return table;
})();

export const crc32: OpDefinition = {
  id: 'crc32',
  name: 'CRC-32',
  description: 'CRC-32 checksum (IEEE 802.3 polynomial 0xEDB88320).',
  category: 'Hash',
  run: (input) => {
    let crc = 0xffffffff;
    for (const b of input) crc = CRC_TABLE[(crc ^ b) & 0xff] ^ (crc >>> 8);
    crc = (crc ^ 0xffffffff) >>> 0;
    return crc.toString(16).padStart(8, '0');
  },
};

export const fingerprintAll: OpDefinition = {
  id: 'fingerprint-all',
  name: 'All Hashes',
  description: 'Compute a battery of common hashes at once. Useful for quick fingerprinting.',
  category: 'Hash',
  run: (input) => {
    const wa = bytesToWordArray(input);
    const lines = [
      `MD5        ${CryptoJS.MD5(wa).toString(CryptoJS.enc.Hex)}`,
      `SHA-1      ${CryptoJS.SHA1(wa).toString(CryptoJS.enc.Hex)}`,
      `SHA-256    ${CryptoJS.SHA256(wa).toString(CryptoJS.enc.Hex)}`,
      `SHA-384    ${CryptoJS.SHA384(wa).toString(CryptoJS.enc.Hex)}`,
      `SHA-512    ${CryptoJS.SHA512(wa).toString(CryptoJS.enc.Hex)}`,
      `RIPEMD-160 ${CryptoJS.RIPEMD160(wa).toString(CryptoJS.enc.Hex)}`,
      `SHA3-256   ${CryptoJS.SHA3(wa, { outputLength: 256 }).toString(CryptoJS.enc.Hex)}`,
      `Length     ${input.length} bytes`,
      `Hex (first 32) ${bytesToHex(input.slice(0, 32))}${input.length > 32 ? '...' : ''}`,
      // eslint-disable-next-line no-control-regex
      `UTF-8 (first 80) ${toText(input.slice(0, 80)).replace(/[\x00-\x1f]/g, '·')}${input.length > 80 ? '...' : ''}`,
    ];
    return lines.join('\n');
  },
};
