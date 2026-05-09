import bs58 from 'bs58';
import type { OpDefinition } from '../types';
import { toText } from '../util';

export const toBase58: OpDefinition = {
  id: 'to-base58',
  name: 'To Base58',
  description: 'Encode bytes as Base58 (Bitcoin alphabet).',
  category: 'Encoding',
  run: (input) => bs58.encode(input),
};

export const fromBase58: OpDefinition = {
  id: 'from-base58',
  name: 'From Base58',
  description: 'Decode a Base58 (Bitcoin alphabet) string.',
  category: 'Encoding',
  run: (input) => bs58.decode(toText(input).trim()),
};
