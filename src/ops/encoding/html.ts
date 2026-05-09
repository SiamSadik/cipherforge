import type { OpDefinition } from '../types';
import { toText } from '../util';

const NAMED: Record<string, string> = {
  amp: '&',
  lt: '<',
  gt: '>',
  quot: '"',
  apos: "'",
  nbsp: '\u00a0',
  copy: '\u00a9',
  reg: '\u00ae',
  trade: '\u2122',
  hellip: '\u2026',
  mdash: '\u2014',
  ndash: '\u2013',
  lsquo: '\u2018',
  rsquo: '\u2019',
  ldquo: '\u201c',
  rdquo: '\u201d',
};

export const htmlEntitiesEncode: OpDefinition = {
  id: 'html-encode',
  name: 'HTML Entities Encode',
  description: 'Replace `<`, `>`, `&`, `"`, `\'` with HTML entities.',
  category: 'Encoding',
  args: [
    {
      name: 'mode',
      label: 'Mode',
      kind: {
        type: 'select',
        options: [
          { value: 'minimal', label: 'Minimal (& < > " \')' },
          { value: 'all-non-ascii', label: 'All non-ASCII as numeric' },
        ],
        default: 'minimal',
      },
    },
  ],
  run: (input, args) => {
    const text = toText(input);
    if (args.mode === 'all-non-ascii') {
      let out = '';
      for (const ch of text) {
        const code = ch.codePointAt(0)!;
        if (code > 126 || code < 32) out += `&#${code};`;
        else out += ch.replace(/[&<>"']/g, (c) => `&#${c.charCodeAt(0)};`);
      }
      return out;
    }
    return text
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#39;');
  },
};

export const htmlEntitiesDecode: OpDefinition = {
  id: 'html-decode',
  name: 'HTML Entities Decode',
  description: 'Convert HTML entities back to characters. Supports named, decimal and hex forms.',
  category: 'Encoding',
  run: (input) => {
    const text = toText(input);
    return text.replace(/&(#x?[0-9a-fA-F]+|[a-zA-Z]+);/g, (match, body: string) => {
      if (body.startsWith('#x') || body.startsWith('#X')) {
        return String.fromCodePoint(parseInt(body.substring(2), 16));
      }
      if (body.startsWith('#')) {
        return String.fromCodePoint(parseInt(body.substring(1), 10));
      }
      return NAMED[body.toLowerCase()] ?? match;
    });
  },
  detect: (input) => {
    const text = toText(input);
    return /&(?:[a-z]+|#x?[0-9a-fA-F]+);/.test(text) ? 0.5 : 0;
  },
};
