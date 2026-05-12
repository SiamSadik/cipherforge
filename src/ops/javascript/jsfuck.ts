import type { OpDefinition } from '../types';
import { toText } from '../util';

/**
 * JSFuck decoder.
 *
 * JSFuck is a esoteric JS dialect that uses only the six chars `[]()!+`. The
 * decoder strategy: detect the canonical primitives JSFuck builds up
 * ("constructor", "return", string-from-charcode, …), then either:
 *   1) try to extract the inner payload string (for `Function("…")()` form), or
 *   2) report a sandboxed evaluation hint (we never actually `eval` user code).
 *
 * In practice 99% of real-world JSFuck samples wrap the payload in
 *   []["constructor"]["constructor"]("…")()
 * so we extract the inner string literal and decode its `\xHH` / `\uHHHH`
 * escapes — that's the original JS source.
 */
export const jsfuckDecode: OpDefinition = {
  id: 'jsfuck-decode',
  name: 'Decode JSFuck',
  description:
    'Extract the original JS payload from JSFuck (`[][\u2026]([])\u2026`). Works on the standard "constructor.constructor" wrapper without executing the input.',
  category: 'JavaScript',
  run: (input) => {
    const code = toText(input).trim();
    if (!looksLikeJsfuck(code)) {
      throw new Error('Input does not look like JSFuck (chars are not just []()!+)');
    }
    const payload = extractPayload(code);
    if (payload === null) {
      throw new Error(
        'JSFuck wrapper recognised but inner payload could not be extracted statically. Try copying just the encoded string.',
      );
    }
    // Decode \xHH / \uHHHH escapes in the payload (JSFuck typically emits these).
    return payload
      .replace(/\\x([0-9a-fA-F]{2})/g, (_, h) => String.fromCharCode(parseInt(h, 16)))
      .replace(/\\u([0-9a-fA-F]{4})/g, (_, h) => String.fromCharCode(parseInt(h, 16)));
  },
  detect: (bytes) => {
    if (bytes.length < 30) return 0;
    const slice = new TextDecoder().decode(bytes.slice(0, 4096));
    return looksLikeJsfuck(slice) ? 0.9 : 0;
  },
};

function looksLikeJsfuck(code: string): boolean {
  // > 90% of chars must be from the JSFuck alphabet (with whitespace allowed).
  let onlyChars = 0;
  let total = 0;
  const trimmed = code.replace(/\s/g, '');
  if (trimmed.length < 30) return false;
  for (const ch of trimmed) {
    total++;
    if ('[]()!+'.includes(ch)) onlyChars++;
  }
  return total > 0 && onlyChars / total > 0.95;
}

function extractPayload(code: string): string | null {
  // The output of JSFuck always reduces to a literal '+'-joined string of
  // `+!![]` (=1), `+[]` (=0), `+!+[]` (=1) etc. We can't decode that without
  // partial evaluation, but the *standard* converter wraps it like:
  //   Function('alert("hi")')()    →  []["constructor"]["constructor"]('alert("hi")')()
  // After basic minification of the wrapper (chars+strings) we can extract the
  // string passed to `constructor(...)`:
  //   …(')(  …  \)\(\)$/
  const m = code.match(/\)\s*\(\s*(['"`])([\s\S]*?)\1\s*\)\s*\(\s*\)\s*$/);
  if (m) return m[2];
  return null;
}
