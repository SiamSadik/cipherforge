import type { OpDefinition } from '../types';
import { toText } from '../util';

export const urlEncode: OpDefinition = {
  id: 'url-encode',
  name: 'URL Encode',
  description: 'Percent-encode bytes for use in URLs (RFC 3986).',
  category: 'Encoding',
  args: [
    {
      name: 'aggressive',
      label: 'Encode all characters',
      kind: { type: 'boolean', default: false },
    },
  ],
  run: (input, args) => {
    const text = toText(input);
    if (args.aggressive) {
      let out = '';
      for (const b of new TextEncoder().encode(text)) {
        out += '%' + b.toString(16).padStart(2, '0').toUpperCase();
      }
      return out;
    }
    return encodeURIComponent(text);
  },
};

export const urlDecode: OpDefinition = {
  id: 'url-decode',
  name: 'URL Decode',
  description: 'Percent-decode a URL-encoded string. Tolerates `+` as space (form-encoded).',
  category: 'Encoding',
  run: (input) => {
    const text = toText(input);
    try {
      return decodeURIComponent(text.replace(/\+/g, '%20'));
    } catch {
      // Fall back to a tolerant decoder that leaves invalid sequences alone.
      return text.replace(/\+/g, ' ').replace(/%([0-9a-fA-F]{2})/g, (_, hex) =>
        String.fromCharCode(parseInt(hex, 16)),
      );
    }
  },
  detect: (input) => {
    const text = toText(input);
    if (!/%[0-9a-fA-F]{2}/.test(text)) return 0;
    return 0.4;
  },
};
