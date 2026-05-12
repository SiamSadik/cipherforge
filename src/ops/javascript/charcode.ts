import type { OpDefinition } from '../types';
import { toText } from '../util';

/**
 * Replace every `String.fromCharCode(N, N, N, ...)` (or `.fromCodePoint`) in
 * the input with the literal string it produces. This is one of the most
 * common JS obfuscation primitives ("char-code arrays").
 */
export const fromCharCodeUnwrap: OpDefinition = {
  id: 'js-from-char-code',
  name: 'Unwrap String.fromCharCode',
  description:
    'Replace every `String.fromCharCode(N, N, ...)` / `String.fromCodePoint(...)` call with its literal output.',
  category: 'JavaScript',
  run: (input) => {
    const code = toText(input);
    return code.replace(
      /String\s*\.\s*fromC(harCode|odePoint)\s*\(\s*([0-9xXa-fA-F,\s+]*?)\s*\)/g,
      (whole, _kind, args: string) => {
        try {
          const parts = args
            .split(',')
            .map((p) => p.trim())
            .filter(Boolean);
          if (parts.length === 0) return whole;
          const chars = parts.map((p) => {
            const n = p.startsWith('0x') || p.startsWith('0X') ? parseInt(p, 16) : parseInt(p, 10);
            if (!Number.isFinite(n)) throw new Error('NaN');
            return n;
          });
          return JSON.stringify(String.fromCodePoint(...chars));
        } catch {
          return whole;
        }
      },
    );
  },
  detect: (bytes) => {
    const slice = new TextDecoder().decode(bytes.slice(0, 4096));
    return /String\s*\.\s*fromCharCode\s*\(/.test(slice) ? 0.5 : 0;
  },
};
