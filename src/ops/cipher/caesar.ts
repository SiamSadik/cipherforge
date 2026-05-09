import type { OpDefinition } from '../types';
import { toText } from '../util';

function shiftChar(ch: string, shift: number): string {
  const code = ch.charCodeAt(0);
  if (code >= 65 && code <= 90) {
    return String.fromCharCode(((code - 65 + shift + 26) % 26) + 65);
  }
  if (code >= 97 && code <= 122) {
    return String.fromCharCode(((code - 97 + shift + 26) % 26) + 97);
  }
  return ch;
}

function applyShift(text: string, shift: number): string {
  let out = '';
  for (const ch of text) out += shiftChar(ch, shift);
  return out;
}

export const caesar: OpDefinition = {
  id: 'caesar',
  name: 'Caesar / ROT-n',
  description: 'Shift each letter by N positions in the alphabet. ROT13 is shift=13.',
  category: 'Cipher',
  args: [
    { name: 'shift', label: 'Shift', kind: { type: 'number', default: 13, min: -25, max: 25, step: 1 } },
  ],
  run: (input, args) => applyShift(toText(input), Number(args.shift ?? 13)),
};

export const rot13: OpDefinition = {
  id: 'rot13',
  name: 'ROT13',
  description: 'Rotate each letter by 13. Self-inverse.',
  category: 'Cipher',
  run: (input) => applyShift(toText(input), 13),
};

export const rot47: OpDefinition = {
  id: 'rot47',
  name: 'ROT47',
  description: 'Rotate every printable ASCII character by 47 positions. Self-inverse.',
  category: 'Cipher',
  run: (input) => {
    let out = '';
    for (const ch of toText(input)) {
      const code = ch.charCodeAt(0);
      if (code >= 33 && code <= 126) {
        out += String.fromCharCode(33 + ((code - 33 + 47) % 94));
      } else {
        out += ch;
      }
    }
    return out;
  },
};

export const atbash: OpDefinition = {
  id: 'atbash',
  name: 'Atbash',
  description: 'Mirror the alphabet (A↔Z, B↔Y, ...). Self-inverse.',
  category: 'Cipher',
  run: (input) => {
    let out = '';
    for (const ch of toText(input)) {
      const code = ch.charCodeAt(0);
      if (code >= 65 && code <= 90) out += String.fromCharCode(155 - code);
      else if (code >= 97 && code <= 122) out += String.fromCharCode(219 - code);
      else out += ch;
    }
    return out;
  },
};

export const caesarBruteForce: OpDefinition = {
  id: 'caesar-brute',
  name: 'Caesar Brute Force',
  description: 'Print all 26 possible Caesar shifts so you can pick the right one.',
  category: 'Cipher',
  run: (input) => {
    const text = toText(input);
    const lines: string[] = [];
    for (let s = 0; s < 26; s++) {
      lines.push(`shift=${s.toString().padStart(2, ' ')}  ${applyShift(text, s)}`);
    }
    return lines.join('\n');
  },
};
