import type { OpDefinition } from '../types';
import { toText } from '../util';

const TABLE: Record<string, string> = {
  A: '.-',
  B: '-...',
  C: '-.-.',
  D: '-..',
  E: '.',
  F: '..-.',
  G: '--.',
  H: '....',
  I: '..',
  J: '.---',
  K: '-.-',
  L: '.-..',
  M: '--',
  N: '-.',
  O: '---',
  P: '.--.',
  Q: '--.-',
  R: '.-.',
  S: '...',
  T: '-',
  U: '..-',
  V: '...-',
  W: '.--',
  X: '-..-',
  Y: '-.--',
  Z: '--..',
  '0': '-----',
  '1': '.----',
  '2': '..---',
  '3': '...--',
  '4': '....-',
  '5': '.....',
  '6': '-....',
  '7': '--...',
  '8': '---..',
  '9': '----.',
  '.': '.-.-.-',
  ',': '--..--',
  '?': '..--..',
  "'": '.----.',
  '!': '-.-.--',
  '/': '-..-.',
  '(': '-.--.',
  ')': '-.--.-',
  '&': '.-...',
  ':': '---...',
  ';': '-.-.-.',
  '=': '-...-',
  '+': '.-.-.',
  '-': '-....-',
  _: '..--.-',
  '"': '.-..-.',
  $: '...-..-',
  '@': '.--.-.',
};

const REVERSE: Record<string, string> = Object.fromEntries(
  Object.entries(TABLE).map(([k, v]) => [v, k]),
);

export const toMorse: OpDefinition = {
  id: 'to-morse',
  name: 'To Morse Code',
  description: 'Encode text as Morse code. Letters separated by space, words by " / ".',
  category: 'Encoding',
  run: (input) => {
    const text = toText(input).toUpperCase();
    return text
      .split(/(\s+)/)
      .map((segment) => {
        if (/^\s+$/.test(segment)) return '/';
        return segment
          .split('')
          .map((c) => TABLE[c] ?? '')
          .filter(Boolean)
          .join(' ');
      })
      .join(' ');
  },
};

export const fromMorse: OpDefinition = {
  id: 'from-morse',
  name: 'From Morse Code',
  description: 'Decode Morse code. Letters separated by space, words by " / ".',
  category: 'Encoding',
  run: (input) =>
    toText(input)
      .replace(/[•·]/g, '.')
      .replace(/[—–]/g, '-')
      .split('/')
      .map((word) =>
        word
          .trim()
          .split(/\s+/)
          .map((sym) => REVERSE[sym] ?? '')
          .join(''),
      )
      .join(' '),
};
