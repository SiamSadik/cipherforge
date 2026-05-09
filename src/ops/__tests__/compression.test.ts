import { describe, expect, it } from 'vitest';
import { runPipeline } from '../pipeline';
import { toText } from '../util';

async function chain(input: string | Uint8Array, ...steps: string[]): Promise<Uint8Array> {
  const recipe = steps.map((opId, i) => ({ uid: String(i), opId, args: {}, enabled: true }));
  const result = await runPipeline(input, recipe);
  for (const step of result.steps) {
    if (step.error) throw new Error(`${step.opId}: ${step.error}`);
  }
  return result.finalOutput;
}

describe('compression', () => {
  const sample = 'The quick brown fox jumps over the lazy dog. '.repeat(50);

  it('gzip compresses and ungzip round-trips', async () => {
    const compressed = await chain(sample, 'gzip');
    expect(compressed.length).toBeLessThan(sample.length);
    const decompressed = await chain(compressed, 'gunzip');
    expect(toText(decompressed)).toBe(sample);
  });

  it('deflate / inflate round-trips', async () => {
    const compressed = await chain(sample, 'deflate');
    const decompressed = await chain(compressed, 'inflate');
    expect(toText(decompressed)).toBe(sample);
  });

  it('zlib compress / inflate round-trips', async () => {
    const compressed = await chain(sample, 'zlib-compress');
    const decompressed = await chain(compressed, 'zlib-inflate');
    expect(toText(decompressed)).toBe(sample);
  });
});
