import * as pako from 'pako';
import type { OpDefinition } from '../types';

export const gzipCompress: OpDefinition = {
  id: 'gzip',
  name: 'Gzip',
  description: 'Gzip-compress the input.',
  category: 'Compression',
  run: (input) => pako.gzip(input),
};

export const gunzip: OpDefinition = {
  id: 'gunzip',
  name: 'Gunzip',
  description: 'Decompress a gzip stream.',
  category: 'Compression',
  run: (input) => pako.ungzip(input),
  detect: (input) => (input.length >= 3 && input[0] === 0x1f && input[1] === 0x8b ? 0.9 : 0),
};

export const deflate: OpDefinition = {
  id: 'deflate',
  name: 'Deflate (raw)',
  description: 'Raw DEFLATE-compress (no zlib header).',
  category: 'Compression',
  run: (input) => pako.deflateRaw(input),
};

export const inflate: OpDefinition = {
  id: 'inflate',
  name: 'Inflate (raw)',
  description: 'Decompress raw DEFLATE data (no zlib header).',
  category: 'Compression',
  run: (input) => pako.inflateRaw(input),
};

export const zlibCompress: OpDefinition = {
  id: 'zlib-compress',
  name: 'Zlib Compress',
  description: 'Zlib-compress with a 2-byte header (RFC 1950).',
  category: 'Compression',
  run: (input) => pako.deflate(input),
};

export const zlibInflate: OpDefinition = {
  id: 'zlib-inflate',
  name: 'Zlib Inflate',
  description: 'Decompress a zlib stream (RFC 1950).',
  category: 'Compression',
  run: (input) => pako.inflate(input),
  detect: (input) => {
    if (input.length < 2) return 0;
    const cmf = input[0];
    const flg = input[1];
    return ((cmf & 0x0f) === 0x08 && ((cmf << 8) | flg) % 31 === 0) ? 0.7 : 0;
  },
};
