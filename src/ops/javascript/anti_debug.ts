import type { OpDefinition } from '../types';
import { toText } from '../util';

/**
 * Strip the boilerplate anti-debugger / self-defending stubs that
 * obfuscator.io / javascript-obfuscator inject at the top of every output.
 *
 * Targets two well-known shapes (pattern-matched, not behaviour-matched):
 *
 *  1. **Debug-protection stub** — a function whose body assembles or
 *     contains the literal `"debugger"` and feeds it into `Function(...)` /
 *     `.constructor(...)`, then schedules itself via `setInterval`. This is
 *     the "browser DevTools open? lock the tab in an infinite loop" stub.
 *
 *  2. **Self-defending stub** — a top-level call to a `function () { …
 *     .toString().search("(((.+)+)+)+$") … }()` IIFE (or one of its trivial
 *     wrappers). The regex is `obfuscator.io`'s canonical tamper canary.
 *
 * Both stubs sit OUTSIDE the application's real logic and only run for
 * their side effects, so dropping them keeps the program well-formed.
 *
 * The strip is purely AST-driven (`@babel/parser` + `@babel/generator`); we
 * never execute the input.
 */
export const stripAntiDebug: OpDefinition = {
  id: 'js-strip-anti-debug',
  name: 'JS Strip Anti-Debug Stubs',
  description:
    'Pattern-strip the obfuscator.io debug-protection (`debugger`/`Function`/`setInterval` recursion) and self-defending (`(((.+)+)+)+$`) stubs.',
  category: 'JavaScript',
  args: [],
  run: async (input) => {
    const code = toText(input);
    const parser = await import('@babel/parser');
    const generator = await import('@babel/generator');
    type Generate = (n: unknown, o?: unknown) => { code: string };
    const generate = (
      (generator as unknown as { default?: { default?: Generate } }).default?.default ??
      (generator as unknown as { default?: Generate }).default ??
      (generator as unknown as Generate)
    ) as Generate;

    let ast: ParsedFile;
    try {
      ast = parser.parse(code, {
        sourceType: 'unambiguous',
        allowReturnOutsideFunction: true,
        errorRecovery: true,
      }) as unknown as ParsedFile;
    } catch {
      return code;
    }

    const body = ast.program.body;

    // Pass 1: collect names of debug-protection functions. Heuristic: a
    // FunctionDeclaration whose body refers to `.constructor("debugger")` /
    // `Function("debugger")` / assembled `"debu" + "gger"` patterns.
    const debugFns = new Set<string>();
    for (const stmt of body) {
      if (stmt.type !== 'FunctionDeclaration') continue;
      const fn = stmt as unknown as { id?: { name: string } };
      if (!fn.id) continue;
      if (looksLikeDebugProtection(stmt)) debugFns.add(fn.id.name);
    }

    let removed = 0;
    for (let i = body.length - 1; i >= 0; i--) {
      const stmt = body[i];
      // (a) top-level FunctionDeclaration for a debug-protection stub.
      if (stmt.type === 'FunctionDeclaration') {
        const name = (stmt as unknown as { id?: { name: string } }).id?.name;
        if (name && debugFns.has(name)) {
          body.splice(i, 1);
          removed++;
          continue;
        }
      }
      // (b) self-defending IIFE: `(function(){ …(((.+)+)+)+$… })();` or its
      //     wrapped variants.
      if (stmt.type === 'ExpressionStatement' && isSelfDefendingExpression(stmt)) {
        body.splice(i, 1);
        removed++;
        continue;
      }
      // (c) `setInterval(debugFn, NUM)` / `setTimeout(debugFn, NUM)` call
      //     statements scheduled by the obfuscator's outer IIFE — drop the
      //     containing call if the callback is a known debug fn.
      if (stmt.type === 'ExpressionStatement' && isSetIntervalCallingDebugFn(stmt, debugFns)) {
        body.splice(i, 1);
        removed++;
        continue;
      }
      // (d) outer wrapper IIFE that ONLY calls setInterval/setTimeout on a
      //     debug-protection fn (very common shape:
      //     `!function(){ const x=window; x.setInterval(debugFn,4000); }();`).
      if (stmt.type === 'ExpressionStatement' && isDebugProtectionIife(stmt, debugFns)) {
        body.splice(i, 1);
        removed++;
        continue;
      }
    }
    if (removed === 0) return code;
    if (body.length === 0) body.push({ type: 'EmptyStatement' } as AstNode);
    try {
      const out = generate(ast as unknown as Parameters<typeof generate>[0], { compact: false });
      return out.code;
    } catch {
      return code;
    }
  },
  detect: (input) => {
    if (input.length < 200) return 0;
    const head = new TextDecoder().decode(input.slice(0, 32_768));
    const hasDebugger = head.includes('"debugger"');
    const hasSelfDef = head.includes('(((.+)+)+)+$');
    const hasCounter = head.includes('"counter"') || head.includes("'counter'");
    if (hasDebugger && hasSelfDef) return 0.85;
    if (hasDebugger && hasCounter) return 0.7;
    if (hasSelfDef) return 0.5;
    return 0;
  },
};

// ---------------------------------------------------------------------------
// AST helpers
// ---------------------------------------------------------------------------

interface AstNode {
  type: string;
  [k: string]: unknown;
}
interface ParsedFile {
  type: 'File';
  program: { type: 'Program'; body: AstNode[]; sourceType: string };
}

function walk(node: AstNode | AstNode[] | undefined, visit: (n: AstNode) => void): void {
  if (!node) return;
  if (Array.isArray(node)) {
    for (const c of node) walk(c, visit);
    return;
  }
  if (typeof node !== 'object' || !node.type) return;
  visit(node);
  for (const k of Object.keys(node)) {
    if (k === 'loc' || k === 'range' || k === 'start' || k === 'end') continue;
    const v = (node as unknown as Record<string, unknown>)[k];
    if (v && typeof v === 'object') walk(v as AstNode | AstNode[], visit);
  }
}

/**
 * Is this a "debug-protection" function declaration?
 *
 * The single most reliable signal is that the function body contains the
 * string `"debugger"` — either as one literal or assembled from the
 * `"debu"` + `"gger"` fragment pair that obfuscator.io emits when string
 * splitting is enabled. No legitimate code splits "debugger" into exactly
 * those two halves, so the pair alone is a smoking gun.
 */
function looksLikeDebugProtection(fnNode: AstNode): boolean {
  let hasDebugger = false;
  let hasDebuFragment = false;
  let hasGgerFragment = false;
  walk(fnNode, (n) => {
    if (n.type !== 'StringLiteral') return;
    const v = (n as unknown as { value: string }).value;
    if (v.includes('debugger')) hasDebugger = true;
    if (v === 'debu' || v === 'debug') hasDebuFragment = true;
    if (v === 'gger' || v === 'ugger') hasGgerFragment = true;
  });
  return hasDebugger || (hasDebuFragment && hasGgerFragment);
}

/**
 * `(function(){ … (((.+)+)+)+$ … })();` — the canonical self-defending IIFE.
 * We allow `!` / `void` wrappers and direct CallExpression of a
 * FunctionExpression. We require the IIFE body to be SMALL so we don't
 * delete a real application IIFE that just happens to contain the canary
 * regex as part of a nested anti-tamper check.
 */
function isSelfDefendingExpression(stmt: AstNode): boolean {
  const expr = (stmt as unknown as { expression: AstNode }).expression;
  if (!expr) return false;
  let inner: AstNode = expr;
  if (inner.type === 'UnaryExpression') {
    inner = (inner as unknown as { argument: AstNode }).argument;
  }
  if (inner.type !== 'CallExpression') return false;
  const call = inner as unknown as { callee: { type: string }; arguments: AstNode[] };
  if (call.callee.type !== 'FunctionExpression') return false;
  const fn = call.callee as unknown as { body?: { body?: AstNode[] } };
  const bodyStmts = fn.body?.body ?? [];
  // Canonical self-defending IIFEs are 1-5 statements. 8 is a safe ceiling.
  if (bodyStmts.length > 8) return false;
  let foundCanary = false;
  walk(inner, (n) => {
    if (foundCanary) return;
    if (n.type === 'StringLiteral') {
      const v = (n as unknown as { value: string }).value;
      if (v.includes('(((.+)+)+)+')) foundCanary = true;
    }
  });
  return foundCanary;
}

function isSetIntervalCallingDebugFn(stmt: AstNode, debugFns: Set<string>): boolean {
  const expr = (stmt as unknown as { expression: AstNode }).expression;
  if (!expr || expr.type !== 'CallExpression') return false;
  const call = expr as unknown as { callee: { type: string; name?: string; property?: { name?: string } }; arguments: AstNode[] };
  const calleeName =
    call.callee.type === 'Identifier'
      ? call.callee.name
      : call.callee.type === 'MemberExpression'
        ? call.callee.property?.name
        : undefined;
  if (calleeName !== 'setInterval' && calleeName !== 'setTimeout') return false;
  const first = call.arguments[0];
  if (!first || first.type !== 'Identifier') return false;
  return debugFns.has((first as unknown as { name: string }).name);
}

/**
 * `!function(){ … setInterval(debugFn, NN); }();` — the SCHEDULER IIFE that
 * obfuscator.io emits right after the debug-protection function. It has a
 * very tight, recognizable shape: it grabs a global (`window`/`globalThis`/
 * `Function("return this")()`) and schedules ONE setInterval / setTimeout on
 * a debug-protection function.
 *
 * We require the IIFE body to be SMALL — otherwise we risk eating a real
 * application IIFE that happens to call `setInterval(debugFn, ...)` somewhere
 * deep inside it (e.g. `hcaptcha.js` in the test corpus wraps the
 * scheduler-IIFE AND the real hcaptcha logic in one outer IIFE — we must
 * only remove the inner scheduler, not the outer container).
 */
function isDebugProtectionIife(stmt: AstNode, debugFns: Set<string>): boolean {
  const expr = (stmt as unknown as { expression: AstNode }).expression;
  if (!expr) return false;
  let inner: AstNode = expr;
  if (inner.type === 'UnaryExpression') {
    inner = (inner as unknown as { argument: AstNode }).argument;
  }
  if (inner.type !== 'CallExpression') return false;
  const call = inner as unknown as { callee: { type: string }; arguments: AstNode[] };
  if (call.callee.type !== 'FunctionExpression') return false;
  const fn = call.callee as unknown as { body?: { body?: AstNode[] } };
  const bodyStmts = fn.body?.body ?? [];
  // Cap on body size — real app IIFEs have many statements; scheduler IIFEs
  // are tiny (typically 2-6 statements: get window, try/catch fallback,
  // setInterval). 12 is a safe ceiling.
  if (bodyStmts.length > 12) return false;
  // Count call expressions inside; a scheduler IIFE should be call-light.
  let callCount = 0;
  let matched = false;
  walk(call.callee, (n) => {
    if (n.type === 'CallExpression') callCount++;
    if (matched) return;
    if (n.type !== 'CallExpression') return;
    const c = n as unknown as { callee: { type: string; name?: string; property?: { name?: string } }; arguments: AstNode[] };
    const nm =
      c.callee.type === 'Identifier'
        ? c.callee.name
        : c.callee.type === 'MemberExpression'
          ? c.callee.property?.name
          : undefined;
    if (nm !== 'setInterval' && nm !== 'setTimeout') return;
    const a0 = c.arguments[0];
    if (a0 && a0.type === 'Identifier' && debugFns.has((a0 as unknown as { name: string }).name)) {
      matched = true;
    }
  });
  // Reject if the IIFE is doing too much work to be a pure scheduler.
  if (callCount > 12) return false;
  return matched;
}
