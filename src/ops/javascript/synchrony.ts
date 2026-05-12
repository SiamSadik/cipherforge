import type { OpDefinition } from '../types';
import { toText } from '../util';

/**
 * Synchrony deobfuscator (npm package: `deobfuscator`, by @relative).
 * Source: https://github.com/relative/synchrony — GPL-3.0.
 *
 * Pure-AST passes, no `eval`/`vm`/`isolated-vm`. Designed for older
 * obfuscator.io variants (push/shift array packing). On modern
 * obfuscator.io samples (the kind webcrack/ben-sb already crack) it can
 * fail with "Push/shift calculation failed" — we return the input
 * unchanged in that case so callers (Universal Decode) can fall through
 * to the next decoder. Net-positive: catches a class of obfuscation the
 * other tools miss.
 */
export const synchrony: OpDefinition = {
  id: 'js-synchrony',
  name: 'JS Deobfuscate (synchrony)',
  description:
    "@relative/synchrony deobfuscator — pure-AST passes (Simplify, MemberExpressionCleaner, LiteralMap, DeadCode, Demangle, StringDecoder, Desequence, ControlFlow). Best on push/shift-style obfuscator.io variants.",
  category: 'JavaScript',
  args: [],
  run: async (input) => {
    const code = toText(input);
    try {
      const mod = (await import('deobfuscator')) as unknown as {
        Deobfuscator?: new () => { deobfuscateSource: (s: string) => Promise<string> };
        default?: { Deobfuscator?: new () => { deobfuscateSource: (s: string) => Promise<string> } };
      };
      const Ctor = mod.Deobfuscator ?? mod.default?.Deobfuscator;
      if (!Ctor) throw new Error('Deobfuscator class not found');
      // Silence the library's verbose "Running X transformer" logs.
      const origLog = console.log;
      const origInfo = console.info;
      const origDebug = console.debug;
      console.log = () => {};
      console.info = () => {};
      console.debug = () => {};
      try {
        const inst = new Ctor();
        const result = await inst.deobfuscateSource(code);
        return typeof result === 'string' ? result : String(result);
      } finally {
        console.log = origLog;
        console.info = origInfo;
        console.debug = origDebug;
      }
    } catch (err) {
      // Synchrony's "Push/shift calculation failed" / "exceeds maxLoops" errors
      // mean the sample isn't a push/shift variant — return input unchanged so
      // the chain can continue.
      const msg = (err as Error).message ?? '';
      if (
        msg.includes('Push/shift') ||
        msg.includes('maxLoops') ||
        msg.includes('exceeds') ||
        msg.includes('not found')
      ) {
        return code;
      }
      throw new Error(`synchrony failed: ${msg}`, { cause: err });
    }
  },
};
