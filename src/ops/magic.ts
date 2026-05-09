import { getOp, ALL_OPS } from './registry';
import type { OpDefinition } from './types';
import { printableRatio, shannonEntropy } from './util';

export interface MagicCandidate {
  op: OpDefinition;
  confidence: number;
  /** Score after applying the op once (printable-ASCII ratio). */
  postScore?: number;
  /** Preview of what the output looks like. */
  preview?: string;
}

/**
 * Try to guess the right operation to apply next, à la CyberChef Magic.
 *
 * Strategy: for every op that exposes a `detect` heuristic, score the input.
 * Then for the top candidates, run the op and rank by how "more readable"
 * the output became.
 */
export async function suggestNextOp(input: Uint8Array): Promise<MagicCandidate[]> {
  const baseScore = printableRatio(input);
  const baseEntropy = shannonEntropy(input);
  const candidates = ALL_OPS.filter((op) => op.detect)
    .map((op) => ({ op, confidence: op.detect!(input) }))
    .filter((c) => c.confidence > 0)
    .sort((a, b) => b.confidence - a.confidence)
    .slice(0, 6);

  const results: MagicCandidate[] = [];
  for (const c of candidates) {
    try {
      const out = await Promise.resolve(c.op.run(input, defaultArgs(c.op)));
      const bytes = typeof out === 'string' ? new TextEncoder().encode(out) : out;
      const post = printableRatio(bytes);
      results.push({
        ...c,
        postScore: post,
        preview: new TextDecoder().decode(bytes.slice(0, 80)),
      });
    } catch {
      results.push(c);
    }
  }

  // Penalise ops that didn't actually improve readability.
  results.sort((a, b) => {
    const aScore = (a.postScore ?? 0) * 0.7 + a.confidence * 0.3;
    const bScore = (b.postScore ?? 0) * 0.7 + b.confidence * 0.3;
    return bScore - aScore;
  });

  // If the input looks like ordinary English prose (plain ASCII, low entropy,
  // contains spaces) we don't want to suggest random transforms.
  const hasSpaces = countSpaces(input) > 2;
  if (baseScore > 0.95 && baseEntropy < 4.5 && hasSpaces) return [];
  return results;
}

function countSpaces(input: Uint8Array): number {
  let n = 0;
  const len = Math.min(input.length, 4096);
  for (let i = 0; i < len; i++) if (input[i] === 0x20) n++;
  return n;
}

function defaultArgs(op: OpDefinition): Record<string, string | number | boolean> {
  const out: Record<string, string | number | boolean> = {};
  for (const arg of op.args ?? []) {
    if (arg.kind.type === 'select') out[arg.name] = arg.kind.default ?? arg.kind.options[0]?.value ?? '';
    else if (arg.kind.default !== undefined) out[arg.name] = arg.kind.default;
  }
  return out;
}

export { getOp };
