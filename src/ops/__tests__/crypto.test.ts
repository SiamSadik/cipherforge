import { describe, expect, it } from 'vitest';
import { runPipeline } from '../pipeline';
import { toText } from '../util';
import type { ArgValue } from '../types';

interface Step {
  opId: string;
  args?: Record<string, ArgValue>;
}

async function runChain(input: string | Uint8Array, ...steps: Step[]): Promise<Uint8Array> {
  const recipe = steps.map((s, i) => ({
    uid: String(i),
    opId: s.opId,
    args: s.args ?? {},
    enabled: true,
  }));
  const result = await runPipeline(input, recipe);
  for (const step of result.steps) {
    if (step.error) throw new Error(`${step.opId}: ${step.error}`);
  }
  return result.finalOutput;
}

describe('symmetric crypto round-trips', () => {
  it('AES-CBC encrypt + decrypt round-trips', async () => {
    const sample = 'top secret message — rendezvous at midnight';
    const args = {
      key: '0123456789abcdef',
      keyFormat: 'utf8',
      iv: 'abcdef0123456789',
      ivFormat: 'utf8',
      mode: 'cbc',
    };
    const out = await runChain(
      sample,
      { opId: 'aes-encrypt', args },
      { opId: 'aes-decrypt', args },
    );
    expect(toText(out)).toBe(sample);
  });

  it('AES-ECB ignores IV and round-trips', async () => {
    const sample = 'block-aligned 32-byte message!!';
    const args = {
      key: '0123456789abcdef',
      keyFormat: 'utf8',
      iv: '',
      ivFormat: 'utf8',
      mode: 'ecb',
    };
    const out = await runChain(
      sample,
      { opId: 'aes-encrypt', args },
      { opId: 'aes-decrypt', args },
    );
    expect(toText(out)).toBe(sample);
  });

  it('Triple-DES round-trips', async () => {
    const sample = 'older but still works';
    const args = {
      key: '0123456789abcdef01234567',
      keyFormat: 'utf8',
      iv: '12345678',
      ivFormat: 'utf8',
      mode: 'cbc',
      algo: 'tripledes',
    };
    const out = await runChain(
      sample,
      { opId: 'des-encrypt', args },
      { opId: 'des-decrypt', args },
    );
    expect(toText(out)).toBe(sample);
  });

  it('RC4 is self-inverse', async () => {
    const sample = 'stream cipher';
    const args = { key: 'Wiki', keyFormat: 'utf8' };
    const out = await runChain(sample, { opId: 'rc4', args }, { opId: 'rc4', args });
    expect(toText(out)).toBe(sample);
  });
});
