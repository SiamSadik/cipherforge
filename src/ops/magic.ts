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

export interface MagicChainStep {
  opId: string;
  opName: string;
  preview: string;
  /** Score (0..1) of how readable the output became. */
  score: number;
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

/**
 * Recursively chain decoders: apply the best detected op, score the result,
 * and recurse until no detector fires above threshold or readability stops
 * improving. Returns the chain of steps that led from `input` to the final
 * (most-readable) output.
 */
export async function recursiveMagic(input: Uint8Array, maxDepth = 6): Promise<MagicChainStep[]> {
  const chain: MagicChainStep[] = [];
  let cur = input;
  const seen = new Set<string>(); // avoid cycles via a fingerprint of content

  for (let depth = 0; depth < maxDepth; depth++) {
    // Score every detector. Prefer strong detectors (compression / format
    // sniffers) over weaker ones so that "the bytes start with 1F 8B" beats
    // "looks vaguely Base32".
    const fingerprint = quickFingerprint(cur);
    if (seen.has(fingerprint)) break;
    seen.add(fingerprint);

    const cands = await suggestNextOp(cur);
    if (cands.length === 0) break;

    // Continue when ANY of:
    //   • A detector fires confidently (binary signature, JWT shape, …).
    //   • Running the candidate makes output more readable.
    //   • This is the first step (we trust the user clicked Auto-chain on something they want decoded).
    // For deeper steps we require either a strong hit OR a readability gain.
    const lastScore = printableRatio(cur);
    const best = cands[0];
    const strongHit = best.confidence >= 0.5;
    const improves = (best.postScore ?? 0) > lastScore + 0.1;
    if (depth > 0 && !strongHit && !improves) break;
    if (depth === 0 && best.confidence < 0.3 && !improves) break;

    let out: Uint8Array;
    try {
      const raw = await Promise.resolve(best.op.run(cur, defaultArgs(best.op)));
      out = typeof raw === 'string' ? new TextEncoder().encode(raw) : raw;
    } catch {
      break;
    }
    chain.push({
      opId: best.op.id,
      opName: best.op.name,
      preview: new TextDecoder().decode(out.slice(0, 120)),
      score: printableRatio(out),
    });
    cur = out;
  }
  return chain;
}

function quickFingerprint(bytes: Uint8Array): string {
  // Cheap content fingerprint — first 8 bytes + length. Enough to detect that
  // we've come back to a buffer we already processed.
  const head = Array.from(bytes.slice(0, 8))
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('');
  return `${bytes.length}:${head}`;
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
