import type { OpDefinition } from '../types';
import { toText } from '../util';

export const unicodeEscape: OpDefinition = {
  id: 'unicode-escape',
  name: 'Unicode Escape (\\uXXXX)',
  description: 'Escape every character above 0x7F as a JavaScript-style \\uXXXX sequence.',
  category: 'Encoding',
  args: [
    {
      name: 'all',
      label: 'Escape every character',
      kind: { type: 'boolean', default: false },
    },
  ],
  run: (input, args) => {
    const text = toText(input);
    let out = '';
    for (const ch of text) {
      const code = ch.codePointAt(0)!;
      if (args.all || code > 126 || code < 32) {
        if (code > 0xffff) {
          out += `\\u{${code.toString(16)}}`;
        } else {
          out += `\\u${code.toString(16).padStart(4, '0')}`;
        }
      } else {
        out += ch;
      }
    }
    return out;
  },
};

export const unicodeUnescape: OpDefinition = {
  id: 'unicode-unescape',
  name: 'Unicode Unescape',
  description: 'Decode \\uXXXX, \\u{XXXXX} and \\xXX sequences into characters.',
  category: 'Encoding',
  run: (input) => {
    const text = toText(input);
    return text
      .replace(/\\u\{([0-9a-fA-F]{1,6})\}/g, (_, hex) =>
        String.fromCodePoint(parseInt(hex, 16)),
      )
      .replace(/\\u([0-9a-fA-F]{4})/g, (_, hex) => String.fromCharCode(parseInt(hex, 16)))
      .replace(/\\x([0-9a-fA-F]{2})/g, (_, hex) => String.fromCharCode(parseInt(hex, 16)));
  },
  detect: (input) => {
    const text = toText(input);
    return /\\u[0-9a-fA-F]{4}|\\x[0-9a-fA-F]{2}/.test(text) ? 0.5 : 0;
  },
};
