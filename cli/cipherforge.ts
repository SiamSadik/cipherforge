#!/usr/bin/env node
/**
 * CipherForge CLI — share the same operation library as the web app.
 *
 * Examples:
 *   cipherforge from-base64 < secret.txt
 *   cipherforge to-hex --separator=space < image.png
 *   cipherforge --pipe "from-base64;gunzip;js-beautify" < blob.txt
 *   cipherforge --list
 *   cipherforge magic < unknown.txt
 */

import { readFile, readdir, stat, mkdir, writeFile } from 'node:fs/promises';
import { join, basename, relative, dirname } from 'node:path';
import { ALL_OPS, getOp, opsByCategory, CATEGORY_ORDER } from '../src/ops/registry';
import { runPipeline } from '../src/ops/pipeline';
import { suggestNextOp } from '../src/ops/magic';
import type { ArgValue } from '../src/ops/types';

interface Parsed {
  command: 'run' | 'list' | 'help' | 'magic' | 'batch';
  pipe: { opId: string; args: Record<string, ArgValue> }[];
  inputFile?: string;
  inputDir?: string;
  outputDir?: string;
  filterGlob?: string;
  recursive: boolean;
  outputBinary: boolean;
  strict: boolean;
}

function parseArgs(argv: string[]): Parsed {
  const args = argv.slice(2);
  const out: Parsed = {
    command: 'run',
    pipe: [],
    outputBinary: false,
    strict: false,
    recursive: false,
  };
  const remaining: string[] = [];
  for (let i = 0; i < args.length; i++) {
    const a = args[i];
    if (a === '--list' || a === '-l') {
      out.command = 'list';
    } else if (a === '--help' || a === '-h') {
      out.command = 'help';
    } else if (a === '--pipe' || a === '-p') {
      const expr = args[++i];
      out.pipe = expr
        .split(';')
        .map((s) => s.trim())
        .filter(Boolean)
        .map((s) => parseStep(s));
    } else if (a === '--input' || a === '-i') {
      out.inputFile = args[++i];
    } else if (a === '--input-dir') {
      out.inputDir = args[++i];
      out.command = 'batch';
    } else if (a === '--output-dir') {
      out.outputDir = args[++i];
    } else if (a === '--filter') {
      out.filterGlob = args[++i];
    } else if (a === '--recursive' || a === '-r') {
      out.recursive = true;
    } else if (a === '--binary' || a === '-b') {
      out.outputBinary = true;
    } else if (a === '--strict') {
      out.strict = true;
    } else {
      remaining.push(a);
    }
  }
  if (out.command === 'run' && out.pipe.length === 0 && remaining.length > 0) {
    if (remaining[0] === 'magic') {
      out.command = 'magic';
    } else {
      out.pipe = [parseStep(remaining.join(' '))];
    }
  }
  return out;
}

function parseStep(expr: string): { opId: string; args: Record<string, ArgValue> } {
  const tokens = expr.split(/\s+/);
  const opId = tokens.shift()!;
  const args: Record<string, ArgValue> = {};
  for (const t of tokens) {
    const m = t.match(/^--([^=]+)(?:=(.*))?$/);
    if (!m) continue;
    const name = m[1];
    const raw = m[2] ?? 'true';
    if (raw === 'true') args[name] = true;
    else if (raw === 'false') args[name] = false;
    else if (/^-?\d+(\.\d+)?$/.test(raw)) args[name] = Number(raw);
    else args[name] = raw;
  }
  return { opId, args };
}

async function readStdin(): Promise<Uint8Array> {
  const chunks: Buffer[] = [];
  for await (const chunk of process.stdin) {
    chunks.push(typeof chunk === 'string' ? Buffer.from(chunk) : chunk);
  }
  return new Uint8Array(Buffer.concat(chunks));
}

function listOps(): void {
  const groups = opsByCategory();
  for (const cat of CATEGORY_ORDER) {
    const ops = groups[cat];
    if (ops.length === 0) continue;
    process.stdout.write(`\n=== ${cat} ===\n`);
    for (const op of ops) {
      process.stdout.write(`  ${op.id.padEnd(28)}  ${op.name}\n`);
    }
  }
  process.stdout.write(`\n${ALL_OPS.length} operations total. Run 'cipherforge --help' for usage.\n`);
}

function showHelp(): void {
  process.stdout.write(`CipherForge — decoder · deobfuscator · decrypter\n\n`);
  process.stdout.write(`Usage:\n`);
  process.stdout.write(`  cipherforge <op> [--arg=value]... < input          Run a single op on stdin\n`);
  process.stdout.write(`  cipherforge --pipe "op1; op2 --key=foo; op3"        Chain ops, separated by ';'\n`);
  process.stdout.write(`  cipherforge --input file.bin <op>                  Read input from a file instead of stdin\n`);
  process.stdout.write(`  cipherforge magic                                  Suggest ops to run on the input\n`);
  process.stdout.write(`  cipherforge --list                                 List every available operation\n`);
  process.stdout.write(`  cipherforge --binary <op>                          Write raw bytes to stdout (no UTF-8 decoding)\n`);
  process.stdout.write(`  cipherforge --strict <op>...                       Exit non-zero if any step fails (default: warn + continue)\n`);
  process.stdout.write(`  cipherforge --input-dir DIR --output-dir DIR ...    Batch-mode: run the pipe on every file in DIR\n`);
  process.stdout.write(`  cipherforge --filter "*.js" --recursive ...        Limit batch-mode files (glob) and recurse into sub-dirs\n`);
  process.stdout.write(`\nExamples:\n`);
  process.stdout.write(`  echo SGVsbG8= | cipherforge from-base64\n`);
  process.stdout.write(`  echo "Wm9pIQ==" | cipherforge --pipe "from-base64; reverse"\n`);
  process.stdout.write(`  cat suspicious.js.gz | cipherforge --pipe "gunzip; js-beautify"\n`);
  process.stdout.write(`  cipherforge --input-dir ./script --output-dir ./decoded --filter '*.js' \\\n`);
  process.stdout.write(`             --pipe "webcrack; js-obfuscator-io-strings; js-strip-anti-debug; js-beautify"\n`);
}

async function magic(input: Uint8Array): Promise<void> {
  const cands = await suggestNextOp(input);
  if (cands.length === 0) {
    process.stdout.write('No suggestions — input may already be plain text.\n');
    return;
  }
  process.stdout.write('Magic suggestions:\n');
  for (const c of cands) {
    process.stdout.write(
      `  ${(c.confidence * 100).toFixed(0).padStart(3)}%  ${c.op.id.padEnd(20)} ${c.op.name}\n`,
    );
    if (c.preview) process.stdout.write(`        preview: ${c.preview}\n`);
  }
}

async function main(): Promise<void> {
  const parsed = parseArgs(process.argv);

  if (parsed.command === 'help') {
    showHelp();
    return;
  }
  if (parsed.command === 'list') {
    listOps();
    return;
  }

  if (parsed.command === 'batch') {
    await runBatch(parsed);
    return;
  }

  const input = parsed.inputFile
    ? new Uint8Array(await readFile(parsed.inputFile))
    : await readStdin();

  if (parsed.command === 'magic') {
    await magic(input);
    return;
  }

  for (const step of parsed.pipe) {
    if (!getOp(step.opId)) {
      process.stderr.write(`Unknown operation: ${step.opId}\n`);
      process.exit(2);
    }
  }

  const recipe = parsed.pipe.map((s, i) => ({
    uid: String(i),
    opId: s.opId,
    args: s.args,
    enabled: true,
  }));
  const result = await runPipeline(input, recipe);
  // By default each failed step is treated as a no-op: its `current` buffer is
  // passed through unchanged so later steps can still make progress (the same
  // contract Universal Decode relies on). We surface the failures on stderr so
  // they're visible. Pass --strict to revert to fail-fast behaviour.
  let failed = 0;
  for (const step of result.steps) {
    if (step.error) {
      failed++;
      process.stderr.write(`warning: ${step.opId} failed: ${step.error}\n`);
    }
  }
  if (parsed.strict && failed > 0) {
    process.exit(1);
  }
  // If every step failed, treat the run as failed even without --strict.
  if (failed > 0 && failed === result.steps.length) {
    process.exit(1);
  }

  if (parsed.outputBinary) {
    process.stdout.write(Buffer.from(result.finalOutput));
  } else {
    process.stdout.write(new TextDecoder().decode(result.finalOutput));
    if (process.stdout.isTTY) process.stdout.write('\n');
  }
}

/**
 * Batch mode: run the same pipe over every file in `--input-dir` and write
 * results to `--output-dir`. We deliberately keep this independent of the
 * single-file path so its semantics (per-file error isolation, per-file
 * timing summary, output naming) stay obvious.
 */
async function runBatch(parsed: Parsed): Promise<void> {
  if (!parsed.inputDir) {
    process.stderr.write('--input-dir is required for batch mode\n');
    process.exit(2);
  }
  if (!parsed.outputDir) {
    process.stderr.write('--output-dir is required for batch mode\n');
    process.exit(2);
  }
  if (parsed.pipe.length === 0) {
    process.stderr.write('Batch mode requires a pipeline (use --pipe "op1; op2; ...")\n');
    process.exit(2);
  }
  for (const step of parsed.pipe) {
    if (!getOp(step.opId)) {
      process.stderr.write(`Unknown operation: ${step.opId}\n`);
      process.exit(2);
    }
  }
  const files = await collectFiles(parsed.inputDir, parsed.recursive, parsed.filterGlob);
  if (files.length === 0) {
    process.stderr.write(`No files matched in ${parsed.inputDir}\n`);
    process.exit(2);
  }
  await mkdir(parsed.outputDir, { recursive: true });
  process.stderr.write(`Batch: ${files.length} file(s) -> ${parsed.outputDir}\n`);

  const recipe = parsed.pipe.map((s, i) => ({
    uid: String(i),
    opId: s.opId,
    args: s.args,
    enabled: true,
  }));

  let okCount = 0;
  let failCount = 0;
  let warnCount = 0;
  const t0 = Date.now();
  for (const inPath of files) {
    const rel = relative(parsed.inputDir, inPath);
    const outPath = join(parsed.outputDir, rel);
    await mkdir(dirname(outPath), { recursive: true });
    const fileT0 = Date.now();
    try {
      const input = new Uint8Array(await readFile(inPath));
      const result = await runPipeline(input, recipe);
      const failed = result.steps.filter((s) => s.error);
      if (parsed.strict && failed.length > 0) {
        for (const f of failed) {
          process.stderr.write(`  ${rel}: ${f.opId} failed: ${f.error}\n`);
        }
        failCount++;
        continue;
      }
      if (failed.length > 0) {
        warnCount++;
        for (const f of failed) {
          process.stderr.write(`  ${rel}: warn ${f.opId}: ${f.error}\n`);
        }
      }
      await writeFile(outPath, Buffer.from(result.finalOutput));
      const elapsedMs = Date.now() - fileT0;
      const outSize = result.finalOutput.length;
      const ratio = input.length > 0 ? (input.length / Math.max(outSize, 1)).toFixed(1) : '?';
      process.stderr.write(
        `  ${rel}: ${input.length} -> ${outSize} (${ratio}x) in ${elapsedMs}ms\n`,
      );
      okCount++;
    } catch (err) {
      failCount++;
      process.stderr.write(
        `  ${rel}: ERROR ${err instanceof Error ? err.message : String(err)}\n`,
      );
    }
  }
  const totalMs = Date.now() - t0;
  process.stderr.write(
    `Batch done: ${okCount} ok, ${warnCount} with warnings, ${failCount} failed in ${totalMs}ms\n`,
  );
  if (failCount > 0) process.exit(1);
}

async function collectFiles(
  root: string,
  recursive: boolean,
  filterGlob: string | undefined,
): Promise<string[]> {
  const matcher = filterGlob ? compileGlob(filterGlob) : null;
  const out: string[] = [];
  async function walk(dir: string): Promise<void> {
    const entries = await readdir(dir);
    for (const name of entries) {
      const full = join(dir, name);
      const st = await stat(full);
      if (st.isDirectory()) {
        if (recursive) await walk(full);
        continue;
      }
      if (!st.isFile()) continue;
      if (matcher && !matcher(basename(full))) continue;
      out.push(full);
    }
  }
  await walk(root);
  out.sort();
  return out;
}

function compileGlob(glob: string): (name: string) => boolean {
  // Tiny glob support: `*`, `?`, and literal chars. Sufficient for the
  // 90% case (`*.js`, `*.txt`, `dashboard.*`). We escape regex metas and
  // expand `*` -> `.*`, `?` -> `.`.
  const re = new RegExp(
    '^' +
      glob.replace(/[.+^${}()|[\]\\]/g, '\\$&').replace(/\*/g, '.*').replace(/\?/g, '.') +
      '$',
  );
  return (name) => re.test(name);
}

main().catch((err) => {
  process.stderr.write(`${err instanceof Error ? err.stack ?? err.message : String(err)}\n`);
  process.exit(1);
});
