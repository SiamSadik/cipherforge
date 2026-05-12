import type { OpDefinition } from '../types';
import { toBytes, toText } from '../util';

// PEM (RFC 7468). Base64-encoded DER bytes wrapped between BEGIN/END markers.

function bytesToBase64Standard(bytes: Uint8Array): string {
  let bin = '';
  for (let i = 0; i < bytes.length; i++) bin += String.fromCharCode(bytes[i]);
  return btoa(bin);
}

function base64ToBytesStandard(b64: string): Uint8Array {
  const bin = atob(b64);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

export const pemEncode: OpDefinition = {
  id: 'to-pem',
  name: 'To PEM',
  description:
    'Wrap the input as a Base64 PEM block (e.g. "-----BEGIN CERTIFICATE-----"). Useful when you have raw DER bytes that need to be loaded by tools that expect PEM.',
  category: 'Encoding',
  args: [
    {
      name: 'label',
      label: 'PEM label',
      kind: { type: 'string', default: 'CERTIFICATE', placeholder: 'CERTIFICATE' },
    },
  ],
  run: (input, args) => {
    const label = String(args.label || 'CERTIFICATE').toUpperCase();
    const bytes = toBytes(input);
    const b64 = bytesToBase64Standard(bytes);
    const lines: string[] = [];
    for (let i = 0; i < b64.length; i += 64) lines.push(b64.slice(i, i + 64));
    return `-----BEGIN ${label}-----\n${lines.join('\n')}\n-----END ${label}-----\n`;
  },
};

export const pemDecode: OpDefinition = {
  id: 'from-pem',
  name: 'From PEM',
  description:
    'Strip the BEGIN/END markers and return the raw DER bytes inside a PEM block. Accepts certificates, private keys, public keys, CSRs, etc.',
  category: 'Encoding',
  run: (input) => {
    const text = toText(input);
    const m = text.match(/-----BEGIN [^-]+-----([\s\S]+?)-----END [^-]+-----/);
    if (!m) throw new Error('No PEM block found (looking for "-----BEGIN ...-----" markers).');
    const body = m[1].replace(/\s+/g, '');
    return base64ToBytesStandard(body);
  },
  detect: (input) => (/-----BEGIN [^-]+-----/.test(toText(input)) ? 0.95 : 0),
};
