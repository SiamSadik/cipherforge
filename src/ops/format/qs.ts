import type { OpDefinition } from '../types';
import { toText } from '../util';

export const parseQueryString: OpDefinition = {
  id: 'parse-query',
  name: 'Parse Query String',
  description:
    'Parse a "?key=value&…" query string (or just "key=value&…" without the leading ?) into pretty JSON.',
  category: 'Format',
  run: (input) => {
    const raw = toText(input).trim();
    const sliced = raw.startsWith('?') ? raw.slice(1) : raw.startsWith('#') ? raw.slice(1) : raw;
    const params = new URLSearchParams(sliced);
    const out: Record<string, string | string[]> = {};
    for (const [k, v] of params.entries()) {
      if (out[k] === undefined) out[k] = v;
      else if (Array.isArray(out[k])) (out[k] as string[]).push(v);
      else out[k] = [out[k] as string, v];
    }
    return JSON.stringify(out, null, 2);
  },
};
