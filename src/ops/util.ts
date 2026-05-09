/**
 * Shared helpers used across operations.
 *
 * In particular, every op deals with Uint8Array <-> string conversion. We
 * centralize that here so we treat encodings consistently.
 */

const utf8Encoder = new TextEncoder();
const utf8Decoder = new TextDecoder('utf-8', { fatal: false });

export function toBytes(input: Uint8Array | string): Uint8Array {
  if (typeof input === 'string') return utf8Encoder.encode(input);
  return input;
}

export function toText(input: Uint8Array | string): string {
  if (typeof input === 'string') return input;
  return utf8Decoder.decode(input);
}

export function bytesEqual(a: Uint8Array, b: Uint8Array): boolean {
  if (a.length !== b.length) return false;
  for (let i = 0; i < a.length; i++) {
    if (a[i] !== b[i]) return false;
  }
  return true;
}

export function concatBytes(...chunks: Uint8Array[]): Uint8Array {
  const len = chunks.reduce((acc, c) => acc + c.length, 0);
  const out = new Uint8Array(len);
  let offset = 0;
  for (const c of chunks) {
    out.set(c, offset);
    offset += c.length;
  }
  return out;
}

export function isPrintableAscii(byte: number): boolean {
  return byte === 0x09 || byte === 0x0a || byte === 0x0d || (byte >= 0x20 && byte <= 0x7e);
}

export function printableRatio(input: Uint8Array): number {
  if (input.length === 0) return 0;
  let printable = 0;
  for (const b of input) {
    if (isPrintableAscii(b)) printable++;
  }
  return printable / input.length;
}

/**
 * Shannon entropy of the byte stream. Useful for detecting compressed /
 * encrypted blobs (~7.5 - 8 bits) versus plain text (~4 - 5).
 */
export function shannonEntropy(input: Uint8Array): number {
  if (input.length === 0) return 0;
  const counts = new Uint32Array(256);
  for (const b of input) counts[b]++;
  let h = 0;
  for (const c of counts) {
    if (c === 0) continue;
    const p = c / input.length;
    h -= p * Math.log2(p);
  }
  return h;
}

export function bytesFromHex(hex: string): Uint8Array {
  const cleaned = hex.replace(/0x/gi, '').replace(/[\s,;:_-]/g, '');
  if (cleaned.length % 2 !== 0) {
    throw new Error('Hex input must have an even number of characters');
  }
  if (!/^[0-9a-fA-F]*$/.test(cleaned)) {
    throw new Error('Hex input contains non-hex characters');
  }
  const out = new Uint8Array(cleaned.length / 2);
  for (let i = 0; i < cleaned.length; i += 2) {
    out[i / 2] = parseInt(cleaned.substring(i, i + 2), 16);
  }
  return out;
}

export function bytesToHex(input: Uint8Array, separator = ''): string {
  const parts: string[] = new Array(input.length);
  for (let i = 0; i < input.length; i++) {
    parts[i] = input[i].toString(16).padStart(2, '0');
  }
  return parts.join(separator);
}
