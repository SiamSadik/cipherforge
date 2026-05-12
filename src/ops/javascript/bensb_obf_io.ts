import type { OpDefinition } from '../types';
import { toText } from '../util';

/**
 * Deobfuscator for scripts produced by Obfuscator.io / javascript-obfuscator,
 * implemented by Ben Symons (@ben-sb). Complements `webcrack` — webcrack is
 * better at *string-array* recovery on some samples; ben-sb's is better at
 * proxy-function inlining, constant propagation, and dead-branch removal.
 *
 * Source: https://github.com/ben-sb/obfuscator-io-deobfuscator (Apache-2.0)
 *
 * Internally it runs ~13 passes:
 *   UnusedVariableRemover, ConstantPropagator, ReassignmentRemover,
 *   DeadBranchRemover, ObjectPacker, ProxyFunctionInliner,
 *   ExpressionSimplifier, SequenceSplitter, ControlFlowRecoverer,
 *   PropertySimplifier, AntiTamperRemover, ObjectSimplifier, StringRevealer.
 *
 * It does NOT execute untrusted code (pure AST transforms).
 *
 * The library writes verbose pass logs to console.log; we silence them
 * during the call so they don't leak into the user's output.
 */
export const benSbObfIo: OpDefinition = {
  id: 'js-bensb-obfuscator-io',
  name: 'JS Deobfuscate (ben-sb obfuscator.io)',
  description:
    "Ben Symons's deobfuscator-io — runs 13 AST passes (proxy-fn inline, dead-branch removal, constant prop, control-flow recovery, anti-tamper removal). Complements webcrack.",
  category: 'JavaScript',
  args: [],
  run: async (input) => {
    const code = toText(input);
    const mod = (await import('obfuscator-io-deobfuscator')) as unknown as {
      deobfuscate: (source: string, config?: unknown) => Promise<string> | string;
    };
    // ben-sb's `proxyFunctionInlining` pass has a known bug where it inlines
    // the body of a proxy function but FAILS to substitute the parameter when
    // the parameter appears as a *computed* MemberExpression property
    // (e.g. `obj[param]`). The result is references to a now-undefined
    // parameter name. This breaks runtime semantics. We disable that one pass;
    // smart-rename + constant-fold + the other 12 ben-sb passes still cover
    // the same ground correctly.
    //
    // See:
    //   node_modules/obfuscator-io-deobfuscator/src/deobfuscator/transformations/
    //     proxyFunctions/proxyFunction.ts:107  — the !MemberExpression+'property'
    //     filter excludes *computed* properties incorrectly.
    const safeConfig = {
      silent: true,
      objectSimplification: { isEnabled: true, unsafeReplace: true },
      objectPacking: { isEnabled: true },
      proxyFunctionInlining: { isEnabled: false },
      stringRevealing: { isEnabled: true },
      expressionSimplification: { isEnabled: true },
      constantPropagation: { isEnabled: true },
      reassignmentRemoval: { isEnabled: true },
      sequenceSplitting: { isEnabled: true },
      controlFlowRecovery: { isEnabled: true },
      deadBranchRemoval: { isEnabled: true },
      antiTamperRemoval: { isEnabled: true },
      unusedVariableRemoval: { isEnabled: true },
      propertySimplification: { isEnabled: true },
    };
    // The library logs progress via console.log and dumps Babel scope errors
    // via console.error / console.warn on pathological inputs (the deobfuscator
    // recovers and returns the original code in that case). Silence all of
    // them for the duration of the call so the deobfuscated output stays
    // clean and the pipeline doesn't spam stderr with babel internals.
    const origLog = console.log;
    const origWarn = console.warn;
    const origErr = console.error;
    console.log = () => {};
    console.warn = () => {};
    console.error = () => {};
    try {
      const result = await mod.deobfuscate(code, safeConfig);
      const text = typeof result === 'string' ? result : String(result);
      // ben-sb's renaming/inlining can produce syntactically invalid output on
      // heavy real-world bundles (duplicate `let` declarations, malformed
      // for-of nodes). It surfaces as a stderr log inside the library but
      // returns the broken text anyway. Do a parser sanity check; if the
      // output won't parse, fall back to the original input so the rest of
      // the pipeline (smart-rename, beautify) can still make progress.
      const { parse } = await import('@babel/parser');
      try {
        parse(text, {
          sourceType: 'unambiguous',
          allowReturnOutsideFunction: true,
          errorRecovery: false,
        });
        return text;
      } catch {
        return code;
      }
    } catch (err) {
      // ben-sb's parser is configured for `sourceType: 'script'`. Inputs that
      // are ES modules (top-level `import`/`export`/`import.meta`) or have
      // syntax it can't parse will throw. We treat these as "not applicable"
      // and pass the input through unchanged so a chained pipeline (e.g.
      // webcrack → ben-sb → smart-rename → beautify) keeps making progress
      // instead of aborting on the first ineligible file.
      const msg = (err as Error).message ?? '';
      const isUnsupported =
        /import|export|sourceType|may appear only|Unexpected token|Property left of/i.test(
          msg
        );
      if (isUnsupported) {
        return code;
      }
      throw new Error(`ben-sb obf-io failed: ${msg}`, { cause: err });
    } finally {
      console.log = origLog;
      console.warn = origWarn;
      console.error = origErr;
    }
  },
};
