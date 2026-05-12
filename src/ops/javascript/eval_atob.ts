import type { OpDefinition } from '../types';
import { toText } from '../util';

/**
 * Strip nested `eval(atob(...))` / `eval(unescape(...))` /
 * `eval(decodeURIComponent(...))` wrappers without ever executing code.
 *
 * Repeats until the wrapper no longer matches, so multi-layered packs unwrap
 * in a single op.
 */
export const evalAtobUnwrap: OpDefinition = {
  id: 'eval-atob-unwrap',
  name: 'Unwrap eval(atob/unescape/decodeURI)',
  description:
    'Repeatedly strip eval(atob(\u2026)) / eval(unescape(\u2026)) / eval(decodeURIComponent(\u2026)) wrappers without executing the code.',
  category: 'JavaScript',
  run: (input) => {
    let code = toText(input).trim();
    let changed = true;
    let safety = 0;
    while (changed && safety++ < 32) {
      changed = false;
      const next = unwrapOne(code);
      if (next !== null && next !== code) {
        code = next;
        changed = true;
      }
    }
    return code;
  },
  detect: (bytes) => {
    const slice = new TextDecoder().decode(bytes.slice(0, 4096));
    return /\beval\s*\(\s*(?:atob|unescape|decodeURIComponent|decodeURI)\s*\(/.test(slice) ? 0.9 : 0;
  },
};

function unwrapOne(code: string): string | null {
  // Match eval( DECODE( "..." ) ) — the literal can be single, double or backtick quoted.
  const m = code.match(
    /^\s*eval\s*\(\s*(atob|unescape|decodeURIComponent|decodeURI)\s*\(\s*(['"`])([\s\S]*?)\2\s*\)\s*\)\s*;?\s*$/,
  );
  if (m) {
    const fn = m[1];
    const literal = m[3];
    return applyDecoder(fn, literal);
  }
  return null;
}

function applyDecoder(fn: string, literal: string): string | null {
  switch (fn) {
    case 'atob':
      try {
        return atob(literal);
      } catch {
        return null;
      }
    case 'unescape':
      // Just \xHH / %HH unescaping.
      return literal
        .replace(/%([0-9a-fA-F]{2})/g, (_, h) => String.fromCharCode(parseInt(h, 16)))
        .replace(/\\x([0-9a-fA-F]{2})/g, (_, h) => String.fromCharCode(parseInt(h, 16)))
        .replace(/\\u([0-9a-fA-F]{4})/g, (_, h) => String.fromCharCode(parseInt(h, 16)));
    case 'decodeURIComponent':
    case 'decodeURI':
      try {
        return decodeURIComponent(literal);
      } catch {
        return null;
      }
    default:
      return null;
  }
}
