/**
 * Core types for CipherForge operations.
 *
 * An operation transforms a Buffer (Uint8Array) into another Buffer using a
 * set of configurable arguments. The pipeline ("recipe") is just an ordered
 * list of operation invocations; each invocation produces an intermediate
 * buffer that is fed to the next operation.
 */

export type ArgValue = string | number | boolean;

export type ArgKind =
  | { type: 'string'; default?: string; placeholder?: string; multiline?: boolean }
  | { type: 'number'; default?: number; min?: number; max?: number; step?: number }
  | { type: 'boolean'; default?: boolean }
  | { type: 'select'; options: { value: string; label: string }[]; default?: string };

export interface ArgSpec {
  name: string;
  label: string;
  kind: ArgKind;
  description?: string;
}

export type OpCategory =
  | 'Encoding'
  | 'Cipher'
  | 'Crypto'
  | 'Hash'
  | 'JavaScript'
  | 'Binary'
  | 'Compression'
  | 'Format';

export interface OpDefinition {
  id: string;
  name: string;
  description: string;
  category: OpCategory;
  args?: ArgSpec[];
  /**
   * The transformation function. Returns either a new Buffer or a string
   * (which is encoded as UTF-8). May throw to signal an error; the UI will
   * surface the error message next to the operation.
   */
  run: (input: Uint8Array, args: Record<string, ArgValue>) => Promise<Uint8Array | string> | Uint8Array | string;
  /** Optional confidence scorer (0..1) for the Magic auto-detect. */
  detect?: (input: Uint8Array) => number;
}

export interface RecipeStep {
  /** Stable client-side id, generated when added to the recipe. */
  uid: string;
  opId: string;
  args: Record<string, ArgValue>;
  /** When false, this step is skipped during execution. */
  enabled: boolean;
}

export interface StepResult {
  uid: string;
  opId: string;
  output: Uint8Array;
  durationMs: number;
  error?: string;
}

export interface PipelineResult {
  steps: StepResult[];
  finalOutput: Uint8Array;
  totalMs: number;
}
