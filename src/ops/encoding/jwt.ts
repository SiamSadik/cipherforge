import type { OpDefinition } from '../types';
import { toText } from '../util';

function b64urlDecode(input: string): string {
  const padded = input.replace(/-/g, '+').replace(/_/g, '/').padEnd(input.length + ((4 - (input.length % 4)) % 4), '=');
  if (typeof atob === 'function') {
    const raw = atob(padded);
    const bytes = new Uint8Array(raw.length);
    for (let i = 0; i < raw.length; i++) bytes[i] = raw.charCodeAt(i);
    return new TextDecoder('utf-8').decode(bytes);
  }
  throw new Error('atob is not available in this environment');
}

export const decodeJwt: OpDefinition = {
  id: 'jwt-decode',
  name: 'JWT Decode',
  description:
    'Split a JWT into header, payload and signature. Decodes the JSON parts and shows them as a pretty-printed report (the signature is left as raw Base64-URL).',
  category: 'Format',
  run: (input) => {
    const text = toText(input).trim();
    const parts = text.split('.');
    if (parts.length < 2 || parts.length > 3) {
      throw new Error('JWT must have 2 or 3 dot-separated parts');
    }
    const header = JSON.parse(b64urlDecode(parts[0]));
    const payload = JSON.parse(b64urlDecode(parts[1]));
    const sig = parts[2] ?? '';
    const report = {
      header,
      payload,
      signature: sig,
      meta: {
        alg: header?.alg,
        type: header?.typ,
        issuedAt: typeof payload?.iat === 'number' ? new Date(payload.iat * 1000).toISOString() : undefined,
        expiresAt: typeof payload?.exp === 'number' ? new Date(payload.exp * 1000).toISOString() : undefined,
        notBefore: typeof payload?.nbf === 'number' ? new Date(payload.nbf * 1000).toISOString() : undefined,
      },
    };
    return JSON.stringify(report, null, 2);
  },
  detect: (input) => {
    const text = toText(input).trim();
    return /^e[yJ][A-Za-z0-9_-]+\.[A-Za-z0-9_-]+(\.[A-Za-z0-9_-]+)?$/.test(text) ? 0.95 : 0;
  },
};
