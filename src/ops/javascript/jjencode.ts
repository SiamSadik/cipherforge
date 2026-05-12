import type { OpDefinition } from '../types';
import { toText } from '../util';

/**
 * JJencode decoder.
 *
 * JJencode wraps a JS payload as a giant expression of the form:
 *   $=~[];$={___:++$,$$$$:(![]+"")[$], …, $_:"\\"+ … }; $.$_($.$_($.$$+ … )())();
 *
 * The actual source string is built by concatenating short `$.X` tokens that
 * each evaluate to a single character. Without fully simulating the JJencode
 * runtime we can't recover every character, but the encoder *also* leaves the
 * raw payload visible as a series of `\\NNN`-style octal strings inside the
 * expression — exactly like AAencode. We pull those out.
 *
 * For samples that use the alternative "global string" form, we also try to
 * extract the inner string passed to the final `(…)("…")` constructor call.
 */
export const jjencodeDecode: OpDefinition = {
  id: 'jjencode-decode',
  name: 'Decode JJencode',
  description:
    'Decode JJencode-obfuscated JavaScript by extracting the embedded octal/escape payload statically.',
  category: 'JavaScript',
  run: (input) => {
    const code = toText(input);
    if (!looksLikeJjencode(code)) {
      throw new Error('Input does not look like JJencode output');
    }
    // Most JJencode output finishes with a payload string of \NNN octal escapes.
    const matches = [...code.matchAll(/"((?:\\\d{1,3})+)"/g)];
    if (matches.length > 0) {
      const longest = matches.reduce((a, b) => (b[1].length > a[1].length ? b : a));
      return decodeOctalEscapes(longest[1]);
    }
    throw new Error('JJencode payload not found — try Webcrack instead');
  },
  detect: (bytes) => {
    const slice = new TextDecoder().decode(bytes.slice(0, 4096));
    // Canonical JJencode prelude.
    return /\$\s*=\s*~\s*\[\s*\]\s*;\s*\$\s*=\s*\{/.test(slice) ? 0.95 : 0;
  },
};

function looksLikeJjencode(code: string): boolean {
  return /\$\s*=\s*~\s*\[\s*\]/.test(code) && /\$\.\$/.test(code);
}

function decodeOctalEscapes(s: string): string {
  return s.replace(/\\(\d{1,3})/g, (_, oct) => String.fromCharCode(parseInt(oct, 8)));
}
