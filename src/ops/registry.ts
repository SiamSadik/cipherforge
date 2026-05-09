import { fromBase32, toBase32 } from './encoding/base32';
import { fromBase58, toBase58 } from './encoding/base58';
import { fromBase64, toBase64 } from './encoding/base64';
import { fromBase85, toBase85 } from './encoding/base85';
import { fromHex, toHex } from './encoding/hex';
import { htmlEntitiesDecode, htmlEntitiesEncode } from './encoding/html';
import { decodeJwt } from './encoding/jwt';
import { fromMorse, toMorse } from './encoding/morse';
import {
  fromBinary,
  fromDecimal,
  fromOctal,
  toBinary,
  toDecimal,
  toOctal,
} from './encoding/numeric';
import { fromQuotedPrintable, toQuotedPrintable } from './encoding/quoted-printable';
import { unicodeEscape, unicodeUnescape } from './encoding/unicode';
import { urlDecode, urlEncode } from './encoding/url';
import { a1z26Decode, a1z26Encode } from './cipher/a1z26';
import { affineDecrypt, affineEncrypt } from './cipher/affine';
import { baconDecode, baconEncode } from './cipher/bacon';
import { atbash, caesar, caesarBruteForce, rot13, rot47 } from './cipher/caesar';
import { polybiusDecode, polybiusEncode } from './cipher/polybius';
import { railFenceDecrypt, railFenceEncrypt } from './cipher/railfence';
import { vigenereDecrypt, vigenereEncrypt } from './cipher/vigenere';
import { xor, xorBruteSingleByte } from './cipher/xor';
import { aesDecrypt, aesEncrypt, desDecrypt, desEncrypt, rc4 } from './crypto/aes';
import {
  crc32,
  fingerprintAll,
  hmac,
  md5,
  ripemd160,
  sha1,
  sha224,
  sha256,
  sha384,
  sha3_256,
  sha3_512,
  sha512,
} from './hash/hashes';
import { hashIdentify } from './hash/identifier';
import {
  beautify,
  escapeStringsToText,
  evalUnpack,
  webcrackDeobfuscate,
} from './javascript/deobfuscate';
import { extractStrings, fileInspect } from './binary/strings';
import {
  deflate,
  gunzip,
  gzipCompress,
  inflate,
  zlibCompress,
  zlibInflate,
} from './compression/gzip';
import {
  jsonFormat,
  jsonMinify,
  lower,
  removeNullBytes,
  reverseText,
  stripWhitespace,
  upper,
} from './format/json';
import type { OpCategory, OpDefinition } from './types';

export const ALL_OPS: OpDefinition[] = [
  // Encoding
  toBase64,
  fromBase64,
  toBase32,
  fromBase32,
  toBase58,
  fromBase58,
  toBase85,
  fromBase85,
  toHex,
  fromHex,
  urlEncode,
  urlDecode,
  htmlEntitiesEncode,
  htmlEntitiesDecode,
  unicodeEscape,
  unicodeUnescape,
  toBinary,
  fromBinary,
  toDecimal,
  fromDecimal,
  toOctal,
  fromOctal,
  toQuotedPrintable,
  fromQuotedPrintable,
  toMorse,
  fromMorse,
  decodeJwt,

  // Ciphers
  caesar,
  rot13,
  rot47,
  atbash,
  caesarBruteForce,
  vigenereEncrypt,
  vigenereDecrypt,
  xor,
  xorBruteSingleByte,
  affineEncrypt,
  affineDecrypt,
  railFenceEncrypt,
  railFenceDecrypt,
  baconEncode,
  baconDecode,
  a1z26Encode,
  a1z26Decode,
  polybiusEncode,
  polybiusDecode,

  // Crypto
  aesEncrypt,
  aesDecrypt,
  desEncrypt,
  desDecrypt,
  rc4,

  // Hash
  md5,
  sha1,
  sha224,
  sha256,
  sha384,
  sha512,
  sha3_256,
  sha3_512,
  ripemd160,
  hmac,
  crc32,
  fingerprintAll,
  hashIdentify,

  // JavaScript
  beautify,
  webcrackDeobfuscate,
  evalUnpack,
  escapeStringsToText,

  // Binary
  fileInspect,
  extractStrings,

  // Compression
  gzipCompress,
  gunzip,
  deflate,
  inflate,
  zlibCompress,
  zlibInflate,

  // Format
  jsonFormat,
  jsonMinify,
  reverseText,
  upper,
  lower,
  stripWhitespace,
  removeNullBytes,
];

const OP_BY_ID = new Map(ALL_OPS.map((op) => [op.id, op] as const));

export function getOp(id: string): OpDefinition | undefined {
  return OP_BY_ID.get(id);
}

export const CATEGORY_ORDER: OpCategory[] = [
  'Encoding',
  'Cipher',
  'Crypto',
  'Hash',
  'JavaScript',
  'Compression',
  'Binary',
  'Format',
];

export function opsByCategory(): Record<OpCategory, OpDefinition[]> {
  const out = {} as Record<OpCategory, OpDefinition[]>;
  for (const cat of CATEGORY_ORDER) out[cat] = [];
  for (const op of ALL_OPS) out[op.category].push(op);
  return out;
}
