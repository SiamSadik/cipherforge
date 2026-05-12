import type { OpDefinition } from '../types';
import { toText } from '../util';

/**
 * P.A.C.K.E.R. unpacker (Dean Edwards style):
 *   eval(function(p,a,c,k,e,d){ ... }('payload', radix, count, 'word|word|...'.split('|'), 0, {}))
 *
 * The packer replaces every keyword in the payload with a base-`a` index,
 * then ships a small `e(c)` function that maps the index back to the keyword.
 * We reverse the mapping statically — no `eval`, no code execution.
 */
export const packerUnpack: OpDefinition = {
  id: 'packer-unpack',
  name: 'Unpack P.A.C.K.E.R.',
  description:
    'Reverse Dean Edwards-style P.A.C.K.E.R. obfuscation (eval(function(p,a,c,k,e,d){...}…)).',
  category: 'JavaScript',
  run: (input) => {
    const code = toText(input).trim();
    const unpacked = unpack(code);
    if (unpacked === null) throw new Error('Input does not look like P.A.C.K.E.R. output');
    return unpacked;
  },
  detect: (bytes) => {
    const slice = new TextDecoder().decode(bytes.slice(0, 4096));
    return /eval\s*\(\s*function\s*\(\s*p\s*,\s*a\s*,\s*c\s*,\s*k\s*,\s*e\s*,\s*[dr]?\s*\)/.test(
      slice,
    )
      ? 0.95
      : 0;
  },
};

function unpack(code: string): string | null {
  // Match the payload + parameters tuple at the end of the eval call.
  // Format: }('payload', 62, 47, 'word|word|...'.split('|'), 0, {}))
  const re =
    /\}\s*\(\s*(['"`])([\s\S]*?)\1\s*,\s*(\d+)\s*,\s*(\d+)\s*,\s*(['"`])([\s\S]*?)\5\s*\.\s*split\s*\(\s*(['"`])\|\7\s*\)/;
  const m = code.match(re);
  if (!m) return null;
  // The captured payload is the *raw text* between the quote chars; the
  // original P.A.C.K.E.R. wraps it in a string literal whose escapes (`\'`,
  // `\"`, `\\`, `\n`, `\xHH`, `\uHHHH`) belong to the source-encoding, not
  // the unpacked program. Unescape them before keyword substitution so the
  // result is real JS rather than `alert(\'hello\')`.
  const payload = unescapeJsLiteral(m[2]);
  const radix = parseInt(m[3], 10);
  const count = parseInt(m[4], 10);
  const keywords = unescapeJsLiteral(m[6]).split('|');
  if (keywords.length < count) return null;

  // Replace every word boundary token with the matching keyword.
  return payload.replace(/\b\w+\b/g, (token) => {
    const idx = decodeRadix(token, radix);
    if (idx === null || idx >= keywords.length) return token;
    return keywords[idx] || token;
  });
}

function unescapeJsLiteral(s: string): string {
  return s
    .replace(/\\u\{([0-9a-fA-F]+)\}/g, (_, h) => String.fromCodePoint(parseInt(h, 16)))
    .replace(/\\u([0-9a-fA-F]{4})/g, (_, h) => String.fromCharCode(parseInt(h, 16)))
    .replace(/\\x([0-9a-fA-F]{2})/g, (_, h) => String.fromCharCode(parseInt(h, 16)))
    .replace(/\\([nrtbfv0\\'"`])/g, (_, c) => {
      const map: Record<string, string> = {
        n: '\n',
        r: '\r',
        t: '\t',
        b: '\b',
        f: '\f',
        v: '\v',
        '0': '\0',
        '\\': '\\',
        "'": "'",
        '"': '"',
        '`': '`',
      };
      return map[c] ?? c;
    });
}

function decodeRadix(token: string, radix: number): number | null {
  // PACKER uses a custom alphabet for radix 36..62: 0-9, a-z, A-Z (offset by case).
  // We mirror p.a.c.k.e.r.'s base62 routine.
  if (radix <= 36) {
    const n = parseInt(token, radix);
    return Number.isFinite(n) ? n : null;
  }
  let n = 0;
  for (const ch of token) {
    let v: number;
    if (ch >= '0' && ch <= '9') v = ch.charCodeAt(0) - 48;
    else if (ch >= 'a' && ch <= 'z') v = ch.charCodeAt(0) - 97 + 10;
    else if (ch >= 'A' && ch <= 'Z') v = ch.charCodeAt(0) - 65 + 36;
    else return null;
    if (v >= radix) return null;
    n = n * radix + v;
  }
  return n;
}
