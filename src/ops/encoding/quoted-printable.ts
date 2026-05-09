import type { OpDefinition } from '../types';
import { toText } from '../util';

export const toQuotedPrintable: OpDefinition = {
  id: 'to-quoted-printable',
  name: 'To Quoted-Printable',
  description: 'Encode bytes per RFC 2045 Quoted-Printable (used in MIME emails).',
  category: 'Encoding',
  run: (input) => {
    let out = '';
    let lineLen = 0;
    const flush = (chunk: string) => {
      if (lineLen + chunk.length > 75) {
        out += '=\r\n';
        lineLen = 0;
      }
      out += chunk;
      lineLen += chunk.length;
    };
    for (const b of input) {
      if ((b >= 33 && b <= 60) || (b >= 62 && b <= 126)) {
        flush(String.fromCharCode(b));
      } else if (b === 32 || b === 9) {
        flush(String.fromCharCode(b));
      } else if (b === 0x0d || b === 0x0a) {
        out += String.fromCharCode(b);
        lineLen = 0;
      } else {
        flush('=' + b.toString(16).toUpperCase().padStart(2, '0'));
      }
    }
    return out;
  },
};

export const fromQuotedPrintable: OpDefinition = {
  id: 'from-quoted-printable',
  name: 'From Quoted-Printable',
  description: 'Decode an RFC 2045 Quoted-Printable string.',
  category: 'Encoding',
  run: (input) => {
    const text = toText(input).replace(/=\r?\n/g, '');
    const bytes: number[] = [];
    let i = 0;
    while (i < text.length) {
      if (text[i] === '=' && i + 2 < text.length) {
        const hex = text.substring(i + 1, i + 3);
        const v = parseInt(hex, 16);
        if (Number.isNaN(v)) throw new Error(`Invalid QP escape "=${hex}"`);
        bytes.push(v);
        i += 3;
      } else {
        bytes.push(text.charCodeAt(i));
        i++;
      }
    }
    return new Uint8Array(bytes);
  },
};
