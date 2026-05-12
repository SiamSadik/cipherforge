import type { OpDefinition } from '../types';
import { toText } from '../util';

export const parseUrl: OpDefinition = {
  id: 'parse-url',
  name: 'Parse URL',
  description: 'Split a URL into scheme, host, port, path, query (decoded), and hash components.',
  category: 'Format',
  run: (input) => {
    const text = toText(input).trim();
    let url: URL;
    try {
      url = new URL(text);
    } catch (err) {
      throw new Error(`Not a valid URL: ${(err as Error).message}`, { cause: err });
    }
    const params: Record<string, string | string[]> = {};
    for (const [k, v] of url.searchParams.entries()) {
      if (params[k] === undefined) params[k] = v;
      else if (Array.isArray(params[k])) (params[k] as string[]).push(v);
      else params[k] = [params[k] as string, v];
    }
    const out = {
      href: url.href,
      scheme: url.protocol.replace(/:$/, ''),
      username: url.username || null,
      password: url.password || null,
      host: url.host,
      hostname: url.hostname,
      port: url.port || null,
      path: url.pathname,
      query: params,
      hash: url.hash || null,
    };
    return JSON.stringify(out, null, 2);
  },
};
