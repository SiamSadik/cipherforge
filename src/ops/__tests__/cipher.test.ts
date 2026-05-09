import { describe, expect, it } from 'vitest';
import { runPipeline } from '../pipeline';
import { toText } from '../util';

async function run(opId: string, input: string, args: Record<string, string | number | boolean> = {}): Promise<string> {
  const result = await runPipeline(input, [{ uid: '1', opId, args, enabled: true }]);
  if (result.steps[0].error) throw new Error(result.steps[0].error);
  return toText(result.finalOutput);
}

describe('classical ciphers', () => {
  it('Caesar shift=3 of "ABC XYZ" is "DEF ABC"', async () => {
    expect(await run('caesar', 'ABC XYZ', { shift: 3 })).toBe('DEF ABC');
  });

  it('ROT13 is self-inverse', async () => {
    const sample = 'Hello, World!';
    expect(await run('rot13', await run('rot13', sample))).toBe(sample);
  });

  it('ROT47 is self-inverse', async () => {
    const sample = 'Hello, World! 1234';
    expect(await run('rot47', await run('rot47', sample))).toBe(sample);
  });

  it('Atbash maps A->Z and is self-inverse', async () => {
    expect(await run('atbash', 'AZ')).toBe('ZA');
    expect(await run('atbash', await run('atbash', 'Hello'))).toBe('Hello');
  });

  it('Vigenère encrypt/decrypt round-trips', async () => {
    const sample = 'Attack at dawn!';
    const ct = await run('vigenere-encrypt', sample, { key: 'LEMON' });
    expect(ct).toBe('Lxfopv ef rnhr!');
    expect(await run('vigenere-decrypt', ct, { key: 'LEMON' })).toBe(sample);
  });

  it('XOR with same key round-trips', async () => {
    const sample = 'top secret payload';
    const ct = await run('xor', sample, { key: 'k', format: 'utf8' });
    expect(await run('xor', ct, { key: 'k', format: 'utf8' })).toBe(sample);
  });

  it('Affine encrypt/decrypt round-trip', async () => {
    const sample = 'AFFINECIPHER';
    const ct = await run('affine-encrypt', sample, { a: 5, b: 8 });
    expect(await run('affine-decrypt', ct, { a: 5, b: 8 })).toBe(sample);
  });

  it('Rail Fence encrypt/decrypt round-trip', async () => {
    const sample = 'WEAREDISCOVEREDFLEEATONCE';
    const ct = await run('railfence-encrypt', sample, { rails: 3 });
    expect(ct).toBe('WECRLTEERDSOEEFEAOCAIVDEN');
    expect(await run('railfence-decrypt', ct, { rails: 3 })).toBe(sample);
  });

  it('A1Z26 round-trips', async () => {
    const enc = await run('a1z26-encode', 'HELLO WORLD');
    expect(enc).toBe('8-5-12-12-15 23-15-18-12-4');
    expect(await run('a1z26-decode', enc)).toBe('HELLO WORLD');
  });

  it("Bacon's cipher round-trips", async () => {
    const enc = await run('bacon-encode', 'HELLO');
    expect(await run('bacon-decode', enc)).toBe('HELLO');
  });

  it('Polybius round-trips (I/J merged)', async () => {
    const enc = await run('polybius-encode', 'HELLO');
    expect(await run('polybius-decode', enc)).toBe('HELLO');
  });
});

describe('hashes', () => {
  it('SHA-256 of "hello" matches known value', async () => {
    expect(await run('sha256', 'hello')).toBe(
      '2cf24dba5fb0a30e26e83b2ac5b9e29e1b161e5c1fa7425e73043362938b9824',
    );
  });

  it('MD5 of "hello" matches known value', async () => {
    expect(await run('md5', 'hello')).toBe('5d41402abc4b2a76b9719d911017c592');
  });

  it('CRC-32 of "123456789" matches known value', async () => {
    expect(await run('crc32', '123456789')).toBe('cbf43926');
  });

  it('HMAC-SHA256 of empty string with key "key" matches', async () => {
    const out = await run('hmac', '', { key: 'key', algo: 'sha256' });
    expect(out).toBe('5d5d139563c95b5967b9bd9a8c9b233a9dedb45072794cd232dc1b74832607d0');
  });

  it('Hash identifier recognises common formats', async () => {
    const md5out = await run('hash-identify', 'd41d8cd98f00b204e9800998ecf8427e');
    expect(md5out).toMatch(/MD5/);
    const sha256out = await run(
      'hash-identify',
      '2cf24dba5fb0a30e26e83b2ac5b9e29e1b161e5c1fa7425e73043362938b9824',
    );
    expect(sha256out).toMatch(/SHA-256/);
    const bcryptOut = await run(
      'hash-identify',
      '$2a$12$R9h/cIPz0gi.URNNX3kh2OPST9/PgBkqquzi.Ss7KIUgO2t0jWMUW',
    );
    expect(bcryptOut).toMatch(/bcrypt/);
  });
});
