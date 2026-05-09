import type { OpDefinition } from '../types';
import { toText } from '../util';

function processVigenere(text: string, key: string, encrypt: boolean): string {
  const cleanedKey = key.replace(/[^a-zA-Z]/g, '');
  if (cleanedKey.length === 0) throw new Error('Key must contain at least one letter');
  let out = '';
  let keyIdx = 0;
  for (const ch of text) {
    const code = ch.charCodeAt(0);
    if (code >= 65 && code <= 90) {
      const k = cleanedKey.toUpperCase().charCodeAt(keyIdx % cleanedKey.length) - 65;
      const shift = encrypt ? k : 26 - k;
      out += String.fromCharCode(((code - 65 + shift) % 26) + 65);
      keyIdx++;
    } else if (code >= 97 && code <= 122) {
      const k = cleanedKey.toUpperCase().charCodeAt(keyIdx % cleanedKey.length) - 65;
      const shift = encrypt ? k : 26 - k;
      out += String.fromCharCode(((code - 97 + shift) % 26) + 97);
      keyIdx++;
    } else {
      out += ch;
    }
  }
  return out;
}

export const vigenereEncrypt: OpDefinition = {
  id: 'vigenere-encrypt',
  name: 'Vigenère Encrypt',
  description: 'Encrypt with a repeating-key polyalphabetic Vigenère cipher.',
  category: 'Cipher',
  args: [{ name: 'key', label: 'Key', kind: { type: 'string', default: 'KEY', placeholder: 'KEY' } }],
  run: (input, args) => processVigenere(toText(input), String(args.key ?? 'KEY'), true),
};

export const vigenereDecrypt: OpDefinition = {
  id: 'vigenere-decrypt',
  name: 'Vigenère Decrypt',
  description: 'Decrypt a repeating-key Vigenère ciphertext when you know the key.',
  category: 'Cipher',
  args: [{ name: 'key', label: 'Key', kind: { type: 'string', default: 'KEY' } }],
  run: (input, args) => processVigenere(toText(input), String(args.key ?? 'KEY'), false),
};
