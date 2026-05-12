import type { OpDefinition } from './types';
import { suggestNextOp } from './magic';
import { printableRatio, toText } from './util';

/**
 * Universal Decode — runs the full magic auto-chain plus a battery of
 * "obvious" unwraps in a fixed order until the output stabilises.
 *
 * Difference vs. the Magic auto-chain in the side panel:
 *   • Magic only fires detector-driven ops; Universal also tries every
 *     unwrap-style op (eval(atob), webcrack, JSFuck, AAencode, JJencode,
 *     PACKER, fromCharCode, …) opportunistically.
 *   • Universal returns the *last* output it managed to make sense of.
 */
export const universalDecode: OpDefinition = {
  id: 'universal-decode',
  name: 'Universal Decode',
  description:
    'Throw the kitchen sink at the input \u2014 base/url/hex decoders, JSFuck/AAencode/JJencode/PACKER unpackers, eval(atob) unwrap, JS beautify, gunzip \u2014 looped until stable.',
  category: 'Format',
  args: [
    { name: 'maxIterations', label: 'Max passes', kind: { type: 'number', default: 12, min: 1, max: 32 } },
  ],
  run: async (input, args) => {
    const max = Math.min(32, Math.max(1, Number(args.maxIterations ?? 12)));
    const { ALL_OPS } = await import('./registry');
    const { parse } = await import('@babel/parser');

    // Ops we'll try opportunistically each iteration. Order matters — we run
    // the cheapest ones first.
    const opportunistic = [
      'eval-atob-unwrap',
      'js-from-char-code',
      'js-string-literal-decode',
      'jsfuck-decode',
      'aaencode-decode',
      'jjencode-decode',
      'packer-unpack',
      'webcrack',
      'js-bensb-obfuscator-io',
      'js-obfuscator-io-strings',
      'js-synchrony',
      'js-strip-anti-debug',
      'js-constant-fold',
      'js-smart-rename',
      'js-dead-code-elim',
      'js-beautify',
    ];

    /** Return true if `text` parses as JS. */
    const parsesAsJs = (text: string): boolean => {
      try {
        parse(text, {
          sourceType: 'unambiguous',
          allowReturnOutsideFunction: true,
          errorRecovery: false,
        });
        return true;
      } catch {
        return false;
      }
    };

    let cur: Uint8Array | string = input;
    const trace: string[] = [];
    const seen = new Set<string>();

    // Track the "best" output seen so far so a later regression doesn't lose it.
    // Heuristics for "better": shorter (parseable JS) wins, then fewer `_0x` identifiers, then higher printable ratio.
    type Snapshot = {
      cur: Uint8Array | string;
      trace: string[];
      score: number;
    };
    const scoreOf = (text: string, bytes: Uint8Array): number => {
      const _0xCount = (text.match(/_0x[0-9a-fA-F]+/g) ?? []).length;
      const printable = printableRatio(bytes);
      // Lower size is better; fewer _0x is much better; higher printable is better.
      // Encode as a single number so we can compare snapshots.
      return -text.length - _0xCount * 50 + printable * 1000;
    };
    let best: Snapshot = {
      cur: input,
      trace: [],
      score: scoreOf(toText(input), typeof input === 'string' ? new TextEncoder().encode(input) : input),
    };

    for (let iter = 0; iter < max; iter++) {
      const before: string = typeof cur === 'string' ? cur : toText(cur);
      const beforeBytes: Uint8Array =
        typeof cur === 'string' ? new TextEncoder().encode(cur) : cur;
      const beforeKey = canonical(before);
      if (seen.has(beforeKey)) break;
      seen.add(beforeKey);

      // If the input is currently valid JS, reject any step whose output is
      // *not* valid JS — e.g. unicode-unescape on a JS file blindly turns
      // `'\u0022'` inside a string literal into a real `"`, corrupting the
      // surrounding source. This guard keeps the chain on a "still valid JS"
      // track once it gets there.
      const beforeIsJs = parsesAsJs(before);
      const isStepValid = (outText: string): boolean =>
        beforeIsJs ? parsesAsJs(outText) : true;

      // 1) Magic-detected ops first (covers base64/hex/gzip/jwt/etc).
      const cands = await suggestNextOp(beforeBytes);
      let madeProgress = false;
      if (cands.length > 0 && cands[0].confidence >= 0.5) {
        const op = cands[0].op;
        try {
          const out: string | Uint8Array = await Promise.resolve(
            op.run(beforeBytes, defaultArgs(op)),
          );
          const outText = typeof out === 'string' ? out : toText(out);
          if (canonical(outText) !== beforeKey && isStepValid(outText)) {
            cur = out;
            trace.push(`\u2192 ${op.name}`);
            madeProgress = true;
            const outBytes2 = typeof out === 'string' ? new TextEncoder().encode(out) : out;
            const sc = scoreOf(outText, outBytes2);
            if (sc > best.score) best = { cur: out, trace: trace.slice(), score: sc };
            continue;
          }
        } catch {
          // ignore and fall through
        }
      }

      // 2) Try opportunistic JS unwraps.
      for (const opId of opportunistic) {
        const op = ALL_OPS.find((o) => o.id === opId);
        if (!op) continue;
        try {
          const out: string | Uint8Array = await Promise.resolve(
            op.run(beforeBytes, defaultArgs(op)),
          );
          const outText = typeof out === 'string' ? out : toText(out);
          if (
            outText &&
            canonical(outText) !== beforeKey &&
            outText.length > 0 &&
            isStepValid(outText)
          ) {
            // Only accept if the output looks "more useful" (fewer non-printables,
            // or shorter and still printable).
            const outBytes = typeof out === 'string' ? new TextEncoder().encode(out) : out;
            const beforeScore = printableRatio(beforeBytes);
            const afterScore = printableRatio(outBytes);
            if (afterScore >= beforeScore - 0.05) {
              cur = out;
              trace.push(`\u2192 ${op.name}`);
              madeProgress = true;
              const sc = scoreOf(outText, outBytes);
              if (sc > best.score) best = { cur: out, trace: trace.slice(), score: sc };
              break;
            }
          }
        } catch {
          // op didn't apply; try the next.
        }
      }

      if (!madeProgress) break;
    }

    // We have the BEST snapshot from the structural decode loop above.
    // Now run a final cosmetic pass: constant-fold, smart-rename, dead-code-elim,
    // and beautify. These don't change behavior; they make the output readable
    // and strip skeleton code the structural decoders left behind. Only apply
    // each one if it (a) succeeds without throwing and (b) keeps the output
    // parseable as JS.
    let cleanedCur = best.cur;
    const cleanedTrace = best.trace.slice();
    const cleanupOps = [
      'js-strip-anti-debug',
      'js-constant-fold',
      'js-smart-rename',
      'js-dead-code-elim',
      'js-beautify',
    ];
    for (const opId of cleanupOps) {
      const op = ALL_OPS.find((o) => o.id === opId);
      if (!op) continue;
      const beforeBytes2: Uint8Array =
        typeof cleanedCur === 'string' ? new TextEncoder().encode(cleanedCur) : cleanedCur;
      const beforeText2 = typeof cleanedCur === 'string' ? cleanedCur : toText(cleanedCur);
      const beforeWasJs = parsesAsJs(beforeText2);
      try {
        const out = await Promise.resolve(op.run(beforeBytes2, defaultArgs(op)));
        const outText = typeof out === 'string' ? out : toText(out);
        if (
          canonical(outText) !== canonical(beforeText2) &&
          (!beforeWasJs || parsesAsJs(outText))
        ) {
          cleanedCur = out;
          cleanedTrace.push(`\u2192 ${op.name}`);
        }
      } catch {
        // op didn't apply, leave cleanedCur as is
      }
    }

    const finalText = typeof cleanedCur === 'string' ? cleanedCur : toText(cleanedCur);
    if (cleanedTrace.length === 0) {
      return finalText;
    }
    return `// Universal Decode pipeline (${cleanedTrace.length} step${cleanedTrace.length === 1 ? '' : 's'}):\n//   ${cleanedTrace.join('\n//   ')}\n\n${finalText}`;
  },
};

/** Normalise text so that pure whitespace/comment shuffling doesn't count as
 *  "progress" in the loop. */
function canonical(s: string): string {
  return s.replace(/\s+/g, ' ').trim();
}

function defaultArgs(op: OpDefinition): Record<string, string | number | boolean> {
  const out: Record<string, string | number | boolean> = {};
  for (const arg of op.args ?? []) {
    if (arg.kind.type === 'select') out[arg.name] = arg.kind.default ?? arg.kind.options[0]?.value ?? '';
    else if (arg.kind.default !== undefined) out[arg.name] = arg.kind.default;
  }
  return out;
}
