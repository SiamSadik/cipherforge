import type { OpDefinition } from '../types';
import { toText } from '../util';

export const jsonFormat: OpDefinition = {
  id: 'json-format',
  name: 'JSON Pretty Print',
  description: 'Parse and re-emit JSON with consistent indentation.',
  category: 'Format',
  args: [{ name: 'indent', label: 'Indent', kind: { type: 'number', default: 2, min: 0, max: 8 } }],
  run: (input, args) => {
    const v = JSON.parse(toText(input));
    return JSON.stringify(v, null, Number(args.indent ?? 2));
  },
};

export const jsonMinify: OpDefinition = {
  id: 'json-minify',
  name: 'JSON Minify',
  description: 'Re-emit JSON without any whitespace.',
  category: 'Format',
  run: (input) => JSON.stringify(JSON.parse(toText(input))),
};

export const reverseText: OpDefinition = {
  id: 'reverse',
  name: 'Reverse',
  description: 'Reverse the input string (preserves Unicode code points).',
  category: 'Format',
  run: (input) => Array.from(toText(input)).reverse().join(''),
};

export const upper: OpDefinition = {
  id: 'upper',
  name: 'To Upper Case',
  description: 'Uppercase every letter.',
  category: 'Format',
  run: (input) => toText(input).toUpperCase(),
};

export const lower: OpDefinition = {
  id: 'lower',
  name: 'To Lower Case',
  description: 'Lowercase every letter.',
  category: 'Format',
  run: (input) => toText(input).toLowerCase(),
};

export const stripWhitespace: OpDefinition = {
  id: 'strip-whitespace',
  name: 'Strip Whitespace',
  description: 'Remove all whitespace characters.',
  category: 'Format',
  run: (input) => toText(input).replace(/\s+/g, ''),
};

export const removeNullBytes: OpDefinition = {
  id: 'strip-null',
  name: 'Strip Null Bytes',
  description: 'Remove all 0x00 bytes — useful when widening UTF-16 to UTF-8.',
  category: 'Format',
  run: (input) => {
    const out: number[] = [];
    for (const b of input) if (b !== 0) out.push(b);
    return new Uint8Array(out);
  },
};
