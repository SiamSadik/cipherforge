import type { OpDefinition } from '../types';
import { toBytes, toText } from '../util';

export const toDecimalUnicode: OpDefinition = {
  id: 'to-decimal-unicode',
  name: 'To Unicode Code Points',
  description: 'List the Unicode code points (decimal, U+ hex, name) of each character.',
  category: 'Format',
  run: (input) => {
    const text = toText(input);
    const lines: string[] = [];
    let i = 0;
    for (const ch of text) {
      const cp = ch.codePointAt(0)!;
      lines.push(`${i.toString().padStart(4, ' ')}  ${cp.toString().padStart(6, ' ')}  U+${cp.toString(16).toUpperCase().padStart(4, '0')}  ${JSON.stringify(ch)}`);
      i++;
    }
    return lines.join('\n');
  },
};

export const fromDecimalCodePoints: OpDefinition = {
  id: 'from-decimal-unicode',
  name: 'From Unicode Code Points',
  description: 'Parse a list of Unicode code points (decimal or U+ hex) back into a string.',
  category: 'Format',
  run: (input) => {
    const text = toText(input);
    const tokens = text.match(/(?:U\+)?[0-9a-fA-F]+/g) ?? [];
    let out = '';
    for (const tok of tokens) {
      const isHex = tok.toUpperCase().startsWith('U+') || /[a-fA-F]/.test(tok);
      const cp = parseInt(tok.replace(/^U\+/i, ''), isHex ? 16 : 10);
      if (Number.isFinite(cp) && cp >= 0 && cp <= 0x10ffff) out += String.fromCodePoint(cp);
    }
    return toBytes(out);
  },
};
