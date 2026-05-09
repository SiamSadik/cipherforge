import { describe, expect, it } from 'vitest';
import { runPipeline } from '../pipeline';
import { toText } from '../util';

async function run(opId: string, input: string, args: Record<string, string | number | boolean> = {}): Promise<string> {
  const result = await runPipeline(input, [{ uid: '1', opId, args, enabled: true }]);
  if (result.steps[0].error) throw new Error(result.steps[0].error);
  return toText(result.finalOutput);
}

describe('encoding round-trips', () => {
  const sample = 'The quick brown fox jumps over the lazy dog 1234567890!';

  it('Base64 round-trips', async () => {
    const encoded = await run('to-base64', sample);
    expect(encoded).toBe('VGhlIHF1aWNrIGJyb3duIGZveCBqdW1wcyBvdmVyIHRoZSBsYXp5IGRvZyAxMjM0NTY3ODkwIQ==');
    const decoded = await run('from-base64', encoded);
    expect(decoded).toBe(sample);
  });

  it('Base64 URL-safe round-trips', async () => {
    // 'subjects?' has special chars (+/) in standard alphabet, replaced by (-_) in URL alphabet.
    const standard = await run('to-base64', 'subjects?', { variant: 'standard', pad: true });
    expect(standard).toBe('c3ViamVjdHM/');
    const urlSafe = await run('to-base64', 'subjects?', { variant: 'url', pad: false });
    expect(urlSafe).toBe('c3ViamVjdHM_');
    const decoded = await run('from-base64', urlSafe, { variant: 'url' });
    expect(decoded).toBe('subjects?');
  });

  it('Base32 round-trips', async () => {
    const encoded = await run('to-base32', sample);
    const decoded = await run('from-base32', encoded);
    expect(decoded).toBe(sample);
  });

  it('Base58 round-trips', async () => {
    const encoded = await run('to-base58', 'hello');
    expect(encoded).toBe('Cn8eVZg');
    const decoded = await run('from-base58', encoded);
    expect(decoded).toBe('hello');
  });

  it('Base85 round-trips', async () => {
    const encoded = await run('to-base85', sample);
    const decoded = await run('from-base85', encoded);
    expect(decoded).toBe(sample);
  });

  it('Hex round-trips with separators', async () => {
    const encoded = await run('to-hex', 'ABC');
    expect(encoded).toBe('414243');
    const withColon = await run('to-hex', 'ABC', { separator: 'colon' });
    expect(withColon).toBe('41:42:43');
    const decoded = await run('from-hex', '0x41 0x42 0x43');
    expect(decoded).toBe('ABC');
  });

  it('URL encode/decode', async () => {
    const encoded = await run('url-encode', 'hello world & friends');
    expect(encoded).toBe('hello%20world%20%26%20friends');
    const decoded = await run('url-decode', 'hello+world%20%26%20friends');
    expect(decoded).toBe('hello world & friends');
  });

  it('HTML entities encode/decode', async () => {
    const encoded = await run('html-encode', '<a href="x">&amp;</a>');
    expect(encoded).toBe('&lt;a href=&quot;x&quot;&gt;&amp;amp;&lt;/a&gt;');
    const decoded = await run('html-decode', '&lt;a&gt;&copy;2025&hellip;&#65;&#x2603;');
    expect(decoded).toBe('<a>\u00a92025\u2026A\u2603');
  });

  it('Unicode escape round-trips', async () => {
    const encoded = await run('unicode-escape', '€\u00ff\u2603');
    expect(encoded).toBe('\\u20ac\\u00ff\\u2603');
    const decoded = await run('unicode-unescape', '\\u20ac\\xff\\u{2603}');
    expect(decoded).toBe('€\u00ff\u2603');
  });

  it('Binary / Decimal / Octal round-trips', async () => {
    expect(await run('to-binary', 'A')).toBe('01000001');
    expect(await run('from-binary', '01000001 01000010')).toBe('AB');
    expect(await run('to-decimal', 'AB')).toBe('65 66');
    expect(await run('from-decimal', '65, 66')).toBe('AB');
    expect(await run('to-octal', 'AB')).toBe('101 102');
    expect(await run('from-octal', '101 102')).toBe('AB');
  });

  it('Quoted-Printable round-trips', async () => {
    const encoded = await run('to-quoted-printable', 'caf\u00e9 = espresso');
    const decoded = await run('from-quoted-printable', encoded);
    expect(decoded).toBe('caf\u00e9 = espresso');
  });

  it('Morse code round-trips', async () => {
    const encoded = await run('to-morse', 'SOS HELP');
    expect(encoded).toBe('... --- ... / .... . .-.. .--.');
    const decoded = await run('from-morse', encoded);
    expect(decoded).toBe('SOS HELP');
  });

  it('JWT decode produces JSON', async () => {
    const jwt =
      'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJzdWIiOiIxMjM0NTY3ODkwIiwibmFtZSI6IkpvaG4gRG9lIiwiaWF0IjoxNTE2MjM5MDIyfQ.SflKxwRJSMeKKF2QT4fwpMeJf36POk6yJV_adQssw5c';
    const decoded = await run('jwt-decode', jwt);
    const parsed = JSON.parse(decoded);
    expect(parsed.header.alg).toBe('HS256');
    expect(parsed.payload.name).toBe('John Doe');
  });
});
