import CryptoJS from 'crypto-js';
import type { OpDefinition } from '../types';
import { bytesFromHex, bytesToHex, toText } from '../util';

function wordArrayToBytes(wa: CryptoJS.lib.WordArray): Uint8Array {
  const out = new Uint8Array(wa.sigBytes);
  for (let i = 0; i < wa.sigBytes; i++) {
    out[i] = (wa.words[i >>> 2] >>> (24 - (i % 4) * 8)) & 0xff;
  }
  return out;
}

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

function parseKeyOrIv(raw: string, format: string, label: string): CryptoJS.lib.WordArray {
  if (raw.length === 0) throw new Error(`${label} cannot be empty`);
  if (format === 'utf8') return CryptoJS.enc.Utf8.parse(raw);
  if (format === 'hex') return bytesToWordArray(bytesFromHex(raw));
  if (format === 'base64') return CryptoJS.enc.Base64.parse(raw);
  throw new Error(`Unknown ${label} format: ${format}`);
}

type CipherMode = typeof CryptoJS.mode.CBC;

function modeFor(name: string): CipherMode {
  const map: Record<string, CipherMode> = {
    cbc: CryptoJS.mode.CBC,
    ecb: CryptoJS.mode.ECB,
    cfb: CryptoJS.mode.CFB,
    ofb: CryptoJS.mode.OFB,
    ctr: CryptoJS.mode.CTR,
  };
  const mode = map[name];
  if (!mode) throw new Error(`Unsupported mode: ${name}`);
  return mode;
}

interface CipherCfg {
  mode: CipherMode;
  padding: typeof CryptoJS.pad.Pkcs7;
  iv?: CryptoJS.lib.WordArray;
}

/**
 * Decryption ops accept ciphertext as raw bytes, hex, or base64 (transparently
 * detected). The order matters here — hex strings ([0-9a-f]+) are also valid
 * Base64, so we have to check hex first.
 */
function parseCiphertext(input: Uint8Array): Uint8Array {
  const text = toText(input).trim();
  const hexCleaned = text.replace(/0x/gi, '').replace(/[\s:,_-]/g, '');
  if (hexCleaned.length > 0 && hexCleaned.length % 2 === 0 && /^[0-9a-fA-F]+$/.test(hexCleaned)) {
    return bytesFromHex(text);
  }
  if (/^[A-Za-z0-9+/_-]+={0,2}$/.test(text) && text.length % 4 === 0) {
    const padded = text.replace(/-/g, '+').replace(/_/g, '/');
    const decoded = atob(padded);
    const out = new Uint8Array(decoded.length);
    for (let i = 0; i < decoded.length; i++) out[i] = decoded.charCodeAt(i);
    return out;
  }
  return input;
}

const COMMON_ARGS = [
  { name: 'key', label: 'Key', kind: { type: 'string' as const, default: '' } },
  {
    name: 'keyFormat',
    label: 'Key format',
    kind: {
      type: 'select' as const,
      options: [
        { value: 'utf8', label: 'UTF-8 text' },
        { value: 'hex', label: 'Hex' },
        { value: 'base64', label: 'Base64' },
      ],
      default: 'utf8',
    },
  },
  { name: 'iv', label: 'IV / Nonce', kind: { type: 'string' as const, default: '' } },
  {
    name: 'ivFormat',
    label: 'IV format',
    kind: {
      type: 'select' as const,
      options: [
        { value: 'utf8', label: 'UTF-8 text' },
        { value: 'hex', label: 'Hex' },
        { value: 'base64', label: 'Base64' },
      ],
      default: 'utf8',
    },
  },
  {
    name: 'mode',
    label: 'Mode',
    kind: {
      type: 'select' as const,
      options: [
        { value: 'cbc', label: 'CBC' },
        { value: 'ecb', label: 'ECB' },
        { value: 'cfb', label: 'CFB' },
        { value: 'ofb', label: 'OFB' },
        { value: 'ctr', label: 'CTR' },
      ],
      default: 'cbc',
    },
  },
];

export const aesEncrypt: OpDefinition = {
  id: 'aes-encrypt',
  name: 'AES Encrypt',
  description: 'AES-128/192/256 encryption (CBC / ECB / CFB / OFB / CTR). Output is hex.',
  category: 'Crypto',
  args: COMMON_ARGS,
  run: (input, args) => {
    const key = parseKeyOrIv(String(args.key ?? ''), String(args.keyFormat ?? 'utf8'), 'Key');
    const mode = modeFor(String(args.mode ?? 'cbc'));
    const iv = mode === CryptoJS.mode.ECB
      ? undefined
      : parseKeyOrIv(String(args.iv ?? ''), String(args.ivFormat ?? 'utf8'), 'IV');
    const cfg: CipherCfg = { mode, padding: CryptoJS.pad.Pkcs7 };
    if (iv) cfg.iv = iv;
    const result = CryptoJS.AES.encrypt(bytesToWordArray(input), key, cfg);
    return bytesToHex(wordArrayToBytes(result.ciphertext));
  },
};

export const aesDecrypt: OpDefinition = {
  id: 'aes-decrypt',
  name: 'AES Decrypt',
  description:
    'AES-128/192/256 decryption. Input must be hex, Base64, or raw bytes (auto-detected).',
  category: 'Crypto',
  args: COMMON_ARGS,
  run: (input, args) => {
    const key = parseKeyOrIv(String(args.key ?? ''), String(args.keyFormat ?? 'utf8'), 'Key');
    const mode = modeFor(String(args.mode ?? 'cbc'));
    const iv = mode === CryptoJS.mode.ECB
      ? undefined
      : parseKeyOrIv(String(args.iv ?? ''), String(args.ivFormat ?? 'utf8'), 'IV');
    const ctBytes = parseCiphertext(input);
    const cfg: CipherCfg = { mode, padding: CryptoJS.pad.Pkcs7 };
    if (iv) cfg.iv = iv;
    const params = CryptoJS.lib.CipherParams.create({ ciphertext: bytesToWordArray(ctBytes) });
    const result = CryptoJS.AES.decrypt(params, key, cfg);
    return wordArrayToBytes(result);
  },
};

export const desEncrypt: OpDefinition = {
  id: 'des-encrypt',
  name: 'DES / 3DES Encrypt',
  description: 'Single-DES (8-byte key) or Triple-DES (16/24-byte key) encryption.',
  category: 'Crypto',
  args: [
    ...COMMON_ARGS,
    {
      name: 'algo',
      label: 'Algorithm',
      kind: {
        type: 'select',
        options: [
          { value: 'des', label: 'DES' },
          { value: 'tripledes', label: '3DES' },
        ],
        default: 'tripledes',
      },
    },
  ],
  run: (input, args) => {
    const key = parseKeyOrIv(String(args.key ?? ''), String(args.keyFormat ?? 'utf8'), 'Key');
    const mode = modeFor(String(args.mode ?? 'cbc'));
    const iv = mode === CryptoJS.mode.ECB
      ? undefined
      : parseKeyOrIv(String(args.iv ?? ''), String(args.ivFormat ?? 'utf8'), 'IV');
    const cfg: CipherCfg = { mode, padding: CryptoJS.pad.Pkcs7 };
    if (iv) cfg.iv = iv;
    const algo = String(args.algo ?? 'tripledes');
    const cipher = algo === 'des' ? CryptoJS.DES : CryptoJS.TripleDES;
    const result = cipher.encrypt(bytesToWordArray(input), key, cfg);
    return bytesToHex(wordArrayToBytes(result.ciphertext));
  },
};

export const desDecrypt: OpDefinition = {
  id: 'des-decrypt',
  name: 'DES / 3DES Decrypt',
  description: 'Single-DES or Triple-DES decryption.',
  category: 'Crypto',
  args: [
    ...COMMON_ARGS,
    {
      name: 'algo',
      label: 'Algorithm',
      kind: {
        type: 'select',
        options: [
          { value: 'des', label: 'DES' },
          { value: 'tripledes', label: '3DES' },
        ],
        default: 'tripledes',
      },
    },
  ],
  run: (input, args) => {
    const key = parseKeyOrIv(String(args.key ?? ''), String(args.keyFormat ?? 'utf8'), 'Key');
    const mode = modeFor(String(args.mode ?? 'cbc'));
    const iv = mode === CryptoJS.mode.ECB
      ? undefined
      : parseKeyOrIv(String(args.iv ?? ''), String(args.ivFormat ?? 'utf8'), 'IV');
    const ctBytes = parseCiphertext(input);
    const cfg: CipherCfg = { mode, padding: CryptoJS.pad.Pkcs7 };
    if (iv) cfg.iv = iv;
    const algo = String(args.algo ?? 'tripledes');
    const cipher = algo === 'des' ? CryptoJS.DES : CryptoJS.TripleDES;
    const params = CryptoJS.lib.CipherParams.create({ ciphertext: bytesToWordArray(ctBytes) });
    const result = cipher.decrypt(params, key, cfg);
    return wordArrayToBytes(result);
  },
};

export const rc4: OpDefinition = {
  id: 'rc4',
  name: 'RC4',
  description: 'RC4 stream cipher. Self-inverse — same op for encryption and decryption.',
  category: 'Crypto',
  args: [
    { name: 'key', label: 'Key', kind: { type: 'string', default: '' } },
    {
      name: 'keyFormat',
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
  run: (input, args) => {
    const key = parseKeyOrIv(String(args.key ?? ''), String(args.keyFormat ?? 'utf8'), 'Key');
    const cfg: CipherCfg = { mode: CryptoJS.mode.ECB, padding: CryptoJS.pad.NoPadding };
    const result = CryptoJS.RC4.encrypt(bytesToWordArray(input), key, cfg);
    return wordArrayToBytes(result.ciphertext);
  },
};
