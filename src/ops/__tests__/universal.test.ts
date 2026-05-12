import { describe, expect, it } from 'vitest';
import { runPipeline } from '../pipeline';
import { toText } from '../util';

async function uni(input: string): Promise<string> {
  // Run via the pipeline so the registry is loaded the same way the app does.
  const result = await runPipeline(input, [
    { uid: '1', opId: 'universal-decode', args: { maxIterations: 12 }, enabled: true },
  ]);
  if (result.steps[0].error) throw new Error(result.steps[0].error);
  return toText(result.finalOutput);
}

describe('Universal Decode — JS-validity guard', () => {
  it('refuses a step that turns valid JS into invalid JS', async () => {
    // Input is parseable JS containing escape sequences inside string literals
    // (`\u0022`, `\x22`). Naïvely running unicode-unescape on the whole source
    // would replace those with literal `"`, corrupting the regex literal /
    // surrounding strings. The guard must reject that step so the final output
    // is still parseable.
    const src = 'const sentinel = "\\u0022plus\\x22"; console.log(sentinel);';
    const out = await uni(src);
    const { parse } = await import('@babel/parser');
    expect(() =>
      parse(out, {
        sourceType: 'unambiguous',
        allowReturnOutsideFunction: true,
        errorRecovery: false,
      }),
    ).not.toThrow();
  });

  it('peels eval(atob(...)) wrappers down to plain JS', async () => {
    // Common malware idiom: payload encoded as base64 inside an eval(atob()).
    // The Universal pipeline should detect base64, decode, then beautify.
    const inner = 'console.log("hello from inner");';
    const b64 = btoa(inner);
    const src = `eval(atob('${b64}'))`;
    const out = await uni(src);
    expect(out).toMatch(/hello from inner/);
  });
});
