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

import { readFile } from 'node:fs/promises';
import { ALL_OPS, getOp, opsByCategory, CATEGORY_ORDER } from '../src/ops/registry';
import { runPipeline } from '../src/ops/pipeline';
import { suggestNextOp } from '../src/ops/magic';
import type { ArgValue } from '../src/ops/types';

interface Parsed {
  command: 'run' | 'list' | 'help' | 'magic';
  pipe: { opId: string; args: Record<string, ArgValue> }[];
  inputFile?: string;
  outputBinary: boolean;
}

function parseArgs(argv: string[]): Parsed {
  const args = argv.slice(2);
  const out: Parsed = { command: 'run', pipe: [], outputBinary: false };
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
    } else if (a === '--binary' || a === '-b') {
      out.outputBinary = true;
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
  process.stdout.write(`\nExamples:\n`);
  process.stdout.write(`  echo SGVsbG8= | cipherforge from-base64\n`);
  process.stdout.write(`  echo "Wm9pIQ==" | cipherforge --pipe "from-base64; reverse"\n`);
  process.stdout.write(`  cat suspicious.js.gz | cipherforge --pipe "gunzip; js-beautify"\n`);
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
  for (const step of result.steps) {
    if (step.error) {
      process.stderr.write(`error in ${step.opId}: ${step.error}\n`);
      process.exit(1);
    }
  }

  if (parsed.outputBinary) {
    process.stdout.write(Buffer.from(result.finalOutput));
  } else {
    process.stdout.write(new TextDecoder().decode(result.finalOutput));
    if (process.stdout.isTTY) process.stdout.write('\n');
  }
}

main().catch((err) => {
  process.stderr.write(`${err instanceof Error ? err.stack ?? err.message : String(err)}\n`);
  process.exit(1);
});
