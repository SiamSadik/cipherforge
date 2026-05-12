import { describe, expect, it } from 'vitest';
import { runPipeline } from '../pipeline';
import { toText } from '../util';

async function run(opId: string, input: string, args: Record<string, string | number | boolean> = {}): Promise<string> {
  const result = await runPipeline(input, [{ uid: '1', opId, args, enabled: true }]);
  if (result.steps[0].error) throw new Error(result.steps[0].error);
  return toText(result.finalOutput);
}

describe('javascript helpers', () => {
  it('beautifies minified JavaScript', async () => {
    const minified = 'function add(a,b){return a+b}console.log(add(1,2))';
    const beautified = await run('js-beautify', minified, { indent: 2 });
    expect(beautified).toMatch(/function add\(a, b\) {/);
    expect(beautified).toMatch(/return a \+ b/);
  });

  it('decodes JS string literals', async () => {
    expect(await run('js-string-literal-decode', '"hello\\nworld"')).toBe('hello\nworld');
    expect(await run('js-string-literal-decode', "'\\x41\\u0042'")).toBe('AB');
  });

  it('refuses to mangle JS source masquerading as a string literal', async () => {
    // Bug found in test corpus: input was full JS source; the op was applying
    // global \" → " replacements over the whole source, corrupting strings
    // that legitimately contain escaped quotes. It must throw on non-literals
    // so chained pipelines (Universal Decode) skip it instead of breaking the
    // syntax of the surrounding code.
    const source = 'const arr = ["a\\"", "b"]; console.log(arr[0]);';
    await expect(run('js-string-literal-decode', source)).rejects.toThrow(/string literal/i);
  });

  it('unwraps eval("...") payloads', async () => {
    expect(await run('eval-unpack', 'eval("alert(1)")')).toBe('alert(1)');
    expect(await run('eval-unpack', "eval('var x=1; console.log(x);')")).toBe('var x=1; console.log(x);');
  });
});
