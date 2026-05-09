import { getOp } from './registry';
import type { PipelineResult, RecipeStep, StepResult } from './types';
import { toBytes } from './util';

/**
 * Execute a recipe end to end.
 *
 * Disabled steps are skipped but still appear in the result with their previous
 * input passed through, so the UI can render the running output without
 * destroying the user's intermediate state.
 */
export async function runPipeline(
  input: Uint8Array | string,
  recipe: RecipeStep[],
): Promise<PipelineResult> {
  const t0 = performance.now();
  let current = toBytes(input);
  const results: StepResult[] = [];
  for (const step of recipe) {
    const op = getOp(step.opId);
    if (!op) {
      results.push({
        uid: step.uid,
        opId: step.opId,
        output: current,
        durationMs: 0,
        error: `Unknown operation: ${step.opId}`,
      });
      continue;
    }
    if (!step.enabled) {
      results.push({ uid: step.uid, opId: step.opId, output: current, durationMs: 0 });
      continue;
    }
    const start = performance.now();
    try {
      const out = await op.run(current, step.args);
      const bytes = typeof out === 'string' ? new TextEncoder().encode(out) : out;
      results.push({
        uid: step.uid,
        opId: step.opId,
        output: bytes,
        durationMs: performance.now() - start,
      });
      current = bytes;
    } catch (err) {
      results.push({
        uid: step.uid,
        opId: step.opId,
        output: current,
        durationMs: performance.now() - start,
        error: err instanceof Error ? err.message : String(err),
      });
    }
  }
  return {
    steps: results,
    finalOutput: current,
    totalMs: performance.now() - t0,
  };
}
