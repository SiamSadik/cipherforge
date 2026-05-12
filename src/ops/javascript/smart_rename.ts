import type { OpDefinition } from '../types';
import { toText } from '../util';

/**
 * Smart-rename pass.
 *
 * For every `_0x[a-f0-9]+` / `_0x[A-F0-9]+` / `$` + hex style identifier in
 * the input, propose a human-readable name based on:
 *
 *   1. The first string assigned to it (`var _0x123 = "https://api.x"`
 *      → `apiUrl`).
 *   2. The first call-expression callee (`function _0x123() { … }`
 *      → `f1`/`fn1`).
 *   3. Property access usage (`_0x123.userAgent` → `nav`).
 *   4. Sequential fallback: `var1, var2, str1, str2, fn1, fn2, …`.
 *
 * NOTE: this does NOT recover the *original* names — those are gone. It
 * gives readable names so the deobfuscated code reads more naturally.
 *
 * We use Babel's parser/traverse/generator (already in the bundle via
 * webcrack), with safety: rename is scope-aware so we don't accidentally
 * collide identifier names. If parsing fails we return the input unchanged.
 */
type ParseFn = (code: string, opts: object) => unknown;
type TraverseFn = (node: unknown, visitor: object) => void;
type GeneratorFn = (node: unknown, opts: object) => { code: string };
let babelLoader: Promise<{ parse: ParseFn; traverse: TraverseFn; generate: GeneratorFn }> | null =
  null;
async function loadBabel() {
  if (!babelLoader) {
    babelLoader = (async () => {
      const [parser, traverse, generator] = await Promise.all([
        import('@babel/parser'),
        import('@babel/traverse'),
        import('@babel/generator'),
      ]);
      const traverseFn =
        (traverse as unknown as { default?: TraverseFn }).default ??
        (traverse as unknown as TraverseFn);
      const generatorFn =
        (generator as unknown as { default?: GeneratorFn }).default ??
        (generator as unknown as GeneratorFn);
      return {
        parse: parser.parse as unknown as ParseFn,
        traverse: traverseFn,
        generate: generatorFn,
      };
    })();
  }
  return babelLoader;
}

const OBFUSCATED_NAME_RE = /^_?0x[0-9a-fA-F]+$|^_0x[A-Za-z0-9_]{2,}$/;

export const smartRename: OpDefinition = {
  id: 'js-smart-rename',
  name: 'JS Smart Rename',
  description:
    'Rename `_0xabc1234` style identifiers to readable names based on first string/value assigned. Does not recover original names \u2014 only proposes meaningful ones.',
  category: 'JavaScript',
  args: [
    {
      name: 'aggressive',
      label: 'Rename single-letter vars too',
      kind: { type: 'boolean', default: false },
    },
  ],
  run: async (input, args) => {
    const code = toText(input);
    const aggressive = Boolean(args.aggressive ?? false);
    try {
      // Iterate up to 3 times: each pass may reveal new context (e.g.
      // `_0xabc = new _0xdef()` becomes `myInst = new someClass()` once
      // `_0xdef` is renamed, which lets the next pass pick a better seed
      // for `_0xabc`).
      let cur = code;
      for (let i = 0; i < 3; i++) {
        const next = await renamePass(cur, aggressive);
        if (next === cur) break;
        cur = next;
      }
      return cur;
    } catch (err) {
      throw new Error(`Smart rename failed: ${(err as Error).message}`, { cause: err });
    }
  },
};

async function renamePass(code: string, aggressive: boolean): Promise<string> {
  const { parse, traverse, generate } = await loadBabel();
  const ast = parse(code, {
    sourceType: 'unambiguous',
    allowReturnOutsideFunction: true,
    allowAwaitOutsideFunction: true,
    plugins: ['jsx'],
    errorRecovery: true,
  });

  // Phase 1: figure out a *proposed* name for every binding that looks
  // obfuscated. Naming policy:
  //
  //   - if the first string literal it's bound to is URL-ish → "url" / "apiUrl"
  //   - if it's a known navigator / window / document property → that name
  //   - if it's a known prefix (chrome, browser, …) → preserve
  //   - else: bucket by inferred role: str/num/arr/obj/fn + counter
  //
  // We collect proposed names across the whole file then resolve collisions.

  type Hint = {
    role: 'str' | 'num' | 'arr' | 'obj' | 'fn' | 'unknown';
    seedName?: string;
    score: number; // higher = more confident
  };
  const hints = new Map<string, Hint>();

  function noteHint(name: string, h: Hint) {
    const cur = hints.get(name);
    if (!cur || h.score > cur.score) hints.set(name, h);
  }

  // Collect from parser-derived AST.
  // We walk and look at: VariableDeclarator, FunctionDeclaration, AssignmentExpression.
  const Node = (n: unknown) => n as { type: string; [k: string]: unknown };

  // Helper: process every parameter (Identifier / AssignmentPattern /
  // RestElement / ObjectPattern / ArrayPattern). When `body` is supplied we
  // also use it for usage-based name inference. `slotNames` (e.g. for
  // Promise constructors → ['resolve','reject']) wins over usage when set.
  function visitParams(params: unknown[], body: unknown, slotNames?: (string | undefined)[]) {
    for (let i = 0; i < params.length; i++) {
      const p = Node(params[i]);
      // Strip wrappers.
      let idNode: { type: string; name?: string } | null = null;
      if (p.type === 'Identifier') idNode = p as { type: string; name?: string };
      else if (p.type === 'AssignmentPattern') {
        const left = Node(p.left);
        if (left.type === 'Identifier') idNode = left as { type: string; name?: string };
      } else if (p.type === 'RestElement') {
        const arg = Node(p.argument);
        if (arg.type === 'Identifier') idNode = arg as { type: string; name?: string };
      } else if (p.type === 'ObjectPattern') {
        // Recursively handle: e.g. function foo({ bar: _0xabc }) {}
        visitObjectPattern(p);
      } else if (p.type === 'ArrayPattern') {
        const elements = (p.elements as unknown[]) || [];
        visitParams(elements.filter((e) => e !== null), body);
      }
      if (!idNode || idNode.type !== 'Identifier') continue;
      const name = idNode.name as string;
      if (!isObfuscatedName(name, aggressive)) continue;

      // Slot-based name (e.g. Promise resolve/reject) wins.
      const slot = slotNames?.[i];
      if (slot) {
        noteHint(name, { role: 'unknown', seedName: slot, score: 7 });
        continue;
      }
      const seedName = paramUsageHint(name, body);
      if (seedName) {
        noteHint(name, { role: 'unknown', seedName, score: 6 });
      } else {
        noteHint(name, { role: 'unknown', seedName: 'arg', score: 1 });
      }
    }
  }

  // Helper: walk an ObjectPattern (or LHS of a destructuring assignment) and
  // for each `{ key: _0xabc }` property, register a hint that `_0xabc` should
  // become `key`. This is the *highest-confidence* rename signal because
  // the source code literally tells us what name was intended.
  function visitObjectPattern(pattern: unknown) {
    const p = Node(pattern);
    const properties = (p.properties as unknown[]) || [];
    for (const prop of properties) {
      const propNode = Node(prop);
      if (propNode.type === 'RestElement') {
        const arg = Node(propNode.argument);
        if (arg.type === 'Identifier' && isObfuscatedName(arg.name as string, aggressive)) {
          noteHint(arg.name as string, { role: 'unknown', seedName: 'rest', score: 4 });
        }
        continue;
      }
      // ObjectProperty: { key: 'foo', value: Identifier '_0xabc' } or value: Pattern
      const key = propNode.key ? Node(propNode.key) : null;
      const value = propNode.value ? Node(propNode.value) : null;
      if (!key || !value) continue;
      let keyName: string | undefined;
      if (key.type === 'Identifier') keyName = key.name as string;
      else if (key.type === 'StringLiteral') keyName = String(key.value);
      if (!keyName) continue;
      if (value.type === 'Identifier' && isObfuscatedName(value.name as string, aggressive)) {
        // The property name itself is the perfect rename hint.
        noteHint(value.name as string, {
          role: 'unknown',
          seedName: keyName,
          score: 9, // highest confidence — the source literally names it
        });
      } else if (value.type === 'AssignmentPattern') {
        const left = Node(value.left);
        if (left.type === 'Identifier' && isObfuscatedName(left.name as string, aggressive)) {
          noteHint(left.name as string, { role: 'unknown', seedName: keyName, score: 9 });
        }
      } else if (value.type === 'ObjectPattern') {
        visitObjectPattern(value);
      } else if (value.type === 'ArrayPattern') {
        const elements = (value.elements as unknown[]) || [];
        visitParams(elements.filter((e) => e !== null), null);
      }
    }
  }

  // Slot-name inference for callback-style positional params.
  function callbackSlotNames(funcParent: unknown): (string | undefined)[] | undefined {
    if (!funcParent) return undefined;
    const parent = Node(funcParent);
    // new Promise((resolve, reject) => …)
    if (parent.type === 'NewExpression') {
      const callee = parent.callee as { type?: string; name?: string };
      if (callee?.type === 'Identifier' && callee.name === 'Promise') {
        return ['resolve', 'reject'];
      }
    }
    // Element in argument list of CallExpression — heuristic by callee.
    if (parent.type === 'CallExpression') {
      const callee = parent.callee as { type?: string; name?: string; property?: { name?: string } };
      const calleeName =
        callee?.type === 'Identifier'
          ? callee.name
          : callee?.type === 'MemberExpression'
            ? callee.property?.name
            : undefined;
      switch (calleeName) {
        case 'addEventListener':
          return ['evt'];
        case 'addListener':
          // chrome.runtime.onMessage.addListener — (message, sender, sendResponse)
          return ['msg', 'sender', 'sendResponse'];
        case 'sendMessage':
          // chrome.runtime.sendMessage(msg, response_cb) — response_cb's first arg = response
          return undefined;
        case 'forEach':
          return ['item', 'index', 'arr'];
        case 'map':
        case 'filter':
        case 'find':
        case 'some':
        case 'every':
          return ['item', 'index', 'arr'];
        case 'reduce':
          return ['acc', 'item', 'index', 'arr'];
        case 'sort':
          return ['a', 'b'];
        case 'then':
          return ['result'];
        case 'catch':
          return ['err'];
        case 'finally':
          return [];
        case 'setTimeout':
        case 'setInterval':
          return [];
      }
    }
    return undefined;
  }

  traverse(ast, {
    VariableDeclarator(path: { node: unknown }) {
      const node = Node(path.node);
      const id = Node(node.id);
      if (id.type === 'ObjectPattern') {
        visitObjectPattern(id);
        return;
      }
      if (id.type === 'ArrayPattern') {
        const elements = (id.elements as unknown[]) || [];
        visitParams(elements.filter((e) => e !== null), null);
        return;
      }
      if (id.type !== 'Identifier') return;
      const name = id.name as string;
      if (!isObfuscatedName(name, aggressive)) return;
      const init = node.init ? Node(node.init) : null;
      noteHint(name, hintFromExpr(name, init));
    },
    AssignmentExpression(path: { node: unknown }) {
      const node = Node(path.node);
      const left = Node(node.left);
      if (left.type === 'ObjectPattern') {
        visitObjectPattern(left);
        return;
      }
      if (left.type !== 'Identifier') return;
      const name = left.name as string;
      if (!isObfuscatedName(name, aggressive)) return;
      const right = node.right ? Node(node.right) : null;
      noteHint(name, hintFromExpr(name, right));
    },
    Function(path: { node: unknown; parent?: unknown }) {
      const node = Node(path.node);
      // Function name (only on FunctionDeclaration / named FunctionExpression).
      const id = node.id ? Node(node.id) : null;
      if (id && id.type === 'Identifier' && isObfuscatedName(id.name as string, aggressive)) {
        noteHint(id.name as string, { role: 'fn', score: 5 });
      }
      // Parameters — heuristically infer name from how each is used,
      // unless we recognise the parent as a callback site with known slots.
      const params = (node.params as unknown[]) || [];
      const body = node.body ? Node(node.body) : null;
      const slots = callbackSlotNames(path.parent);
      visitParams(params, body, slots);
    },
    CatchClause(path: { node: unknown }) {
      const node = Node(path.node);
      const param = node.param ? Node(node.param) : null;
      if (!param) return;
      if (param.type === 'Identifier' && isObfuscatedName(param.name as string, aggressive)) {
        const body = node.body ? Node(node.body) : null;
        const usageSeed = paramUsageHint(param.name as string, body);
        // If usage suggests something specific (e.g. param.message → str), use it; else `err`.
        const seed = usageSeed && usageSeed !== 'arg' ? 'err' : 'err';
        noteHint(param.name as string, { role: 'unknown', seedName: seed, score: 7 });
      } else if (param.type === 'ObjectPattern') {
        visitObjectPattern(param);
      }
    },
  });

  // Phase 2: turn hints into final names with collision resolution.
  const counters: Record<string, number> = {};
  const finalNames = new Map<string, string>();
  const used = new Set<string>();
  for (const [oldName, hint] of hints) {
    let base = hint.seedName ?? roleBase(hint.role);
    // Defensive: never use a still-obfuscated `_0x…` name as a base — fall
    // back to role. (Use the strict regex; we explicitly *do* want to allow
    // single-letter seeds like `n` / `i`.)
    if (OBFUSCATED_NAME_RE.test(base)) {
      base = roleBase(hint.role);
    }
    base = sanitizeIdentifier(base);
    counters[base] = (counters[base] ?? 0) + 1;
    let candidate = counters[base] === 1 ? base : `${base}${counters[base]}`;
    while (used.has(candidate)) {
      counters[base] = (counters[base] ?? 1) + 1;
      candidate = `${base}${counters[base]}`;
    }
    used.add(candidate);
    finalNames.set(oldName, candidate);
  }

  // Phase 3: rename via scope.rename so we don't break shadowing.
  traverse(ast, {
    Scope(path: {
      scope: {
        bindings: Record<string, unknown>;
        rename: (oldName: string, newName: string) => void;
      };
    }) {
      for (const [oldName, newName] of finalNames) {
        if (path.scope.bindings && path.scope.bindings[oldName]) {
          try {
            path.scope.rename(oldName, newName);
          } catch {
            // ignore rename failures
          }
        }
      }
    },
  });

  // Phase 4: clean up *unbound* `_0x…` references. These can be left over
  // by upstream deobfuscators (e.g. proxy-function inliners that delete a
  // function but forget to substitute its parameter back at the call site).
  // Such references would throw at runtime; we replace them with `undefined`
  // so the code is syntactically valid and the `||` fallbacks still work.
  traverse(ast, {
    Identifier(path: {
      node: { type: string; name: string };
      isReferencedIdentifier?: () => boolean;
      scope: { hasBinding: (name: string) => boolean };
      replaceWith: (n: unknown) => void;
      parentPath?: { node?: { type: string; property?: { name?: string }; computed?: boolean } };
    }) {
      const name = path.node.name;
      if (!OBFUSCATED_NAME_RE.test(name)) return;
      // Only rewrite *referenced* identifiers (skip object property keys,
      // function names, etc.).
      if (path.isReferencedIdentifier && !path.isReferencedIdentifier()) return;
      if (path.scope.hasBinding(name)) return;
      // Replace with `undefined`.
      path.replaceWith({ type: 'Identifier', name: 'undefined' });
    },
  });

  const out = generate(ast, { compact: false, jsescOption: { quotes: 'single' } });
  return out.code;
}

function isObfuscatedName(name: string, aggressive: boolean): boolean {
  if (OBFUSCATED_NAME_RE.test(name)) return true;
  if (aggressive && /^[a-zA-Z_]$/.test(name)) return true;
  if (aggressive && /^[a-zA-Z_]{2}$/.test(name)) return true;
  return false;
}

function hintFromExpr(_name: string, n: unknown): { role: 'str' | 'num' | 'arr' | 'obj' | 'fn' | 'unknown'; seedName?: string; score: number } {
  if (!n) return { role: 'unknown', score: 1 };
  const node = n as { type: string; [k: string]: unknown };
  switch (node.type) {
    case 'StringLiteral': {
      const v = String(node.value).trim();
      const seed = nameFromString(v);
      return { role: 'str', seedName: seed, score: seed === 'str' ? 4 : 8 };
    }
    case 'NumericLiteral':
      return { role: 'num', score: 3 };
    case 'ArrayExpression':
      return { role: 'arr', score: 3 };
    case 'ObjectExpression':
      return { role: 'obj', score: 3 };
    case 'FunctionExpression':
    case 'ArrowFunctionExpression':
      return { role: 'fn', score: 4 };
    case 'CallExpression': {
      // Look at the callee for a hint.
      const callee = node.callee as { type: string; name?: string; property?: { name?: string } };
      if (callee?.type === 'Identifier' && typeof callee.name === 'string' && !isObfuscatedName(callee.name, true)) {
        return { role: 'unknown', seedName: callee.name + 'Result', score: 5 };
      }
      if (callee?.type === 'MemberExpression' && callee.property?.name) {
        return { role: 'unknown', seedName: callee.property.name + 'Result', score: 4 };
      }
      return { role: 'unknown', score: 2 };
    }
    case 'NewExpression': {
      const callee = node.callee as { type: string; name?: string };
      if (callee?.type === 'Identifier' && typeof callee.name === 'string' && !isObfuscatedName(callee.name, true)) {
        return { role: 'unknown', seedName: callee.name.charAt(0).toLowerCase() + callee.name.slice(1), score: 6 };
      }
      return { role: 'obj', score: 3 };
    }
    case 'MemberExpression': {
      const property = node.property as { type: string; name?: string };
      if (property?.type === 'Identifier' && typeof property.name === 'string') {
        return { role: 'unknown', seedName: property.name, score: 5 };
      }
      return { role: 'unknown', score: 1 };
    }
    default:
      return { role: 'unknown', score: 1 };
  }
}

/**
 * Best-effort: scan function body, collect references to `name`, and pick a
 * descriptive seed from how it's used (called as a string method, used in
 * arithmetic, indexed, etc.).
 */
function paramUsageHint(name: string, body: unknown): string | null {
  if (!body) return null;
  type N = { type: string; [k: string]: unknown };
  const stack: unknown[] = [body];
  let stringy = 0;
  let numeric = 0;
  let arrayy = 0;
  let objecty = 0;
  let calledAsFn = 0;
  // Specific-method hits — these win if seen.
  const methodHits = new Set<string>();
  while (stack.length) {
    const cur = stack.pop();
    if (!cur || typeof cur !== 'object') continue;
    const node = cur as N;
    if (node.type === 'Identifier' && (node as N).name === name) continue;
    if (node.type === 'MemberExpression') {
      const obj = node.object as N;
      const prop = node.property as N | undefined;
      if (obj?.type === 'Identifier' && (obj as N).name === name) {
        if (prop?.type === 'Identifier') {
          const p = prop.name as string;
          methodHits.add(p);
          if (
            p === 'length' || p === 'split' || p === 'charAt' || p === 'substring' ||
            p === 'slice' || p === 'replace' || p === 'toLowerCase' || p === 'toUpperCase' ||
            p === 'trim' || p === 'startsWith' || p === 'endsWith' || p === 'includes' ||
            p === 'match' || p === 'indexOf'
          ) {
            stringy++;
          } else if (
            p === 'push' || p === 'pop' || p === 'shift' || p === 'unshift' ||
            p === 'forEach' || p === 'map' || p === 'filter' || p === 'reduce' ||
            p === 'find' || p === 'some' || p === 'every'
          ) {
            arrayy++;
          } else {
            // Plain property access (e.g. param.profile, param.url) — counts as object-like.
            objecty++;
          }
        }
        if (node.computed) arrayy++;
      }
    }
    if (node.type === 'BinaryExpression') {
      const op = node.operator as string;
      const left = node.left as N;
      const right = node.right as N;
      const involves = (n?: N) => n?.type === 'Identifier' && (n as N).name === name;
      if (involves(left) || involves(right)) {
        if (op === '+' || op === '-' || op === '*' || op === '/' || op === '%' || op === '<' || op === '>' || op === '<=' || op === '>=') {
          numeric++;
        }
      }
    }
    if (node.type === 'CallExpression') {
      const callee = node.callee as N;
      if (callee?.type === 'Identifier' && callee.name === name) calledAsFn++;
      // Number(name) / parseInt(name) / parseFloat(name)
      if (callee?.type === 'Identifier' && ['Number', 'parseInt', 'parseFloat'].includes(callee.name as string)) {
        const args = (node.arguments as N[]) || [];
        if (args[0] && args[0].type === 'Identifier' && (args[0] as N).name === name) {
          numeric++;
        }
      }
      // String-like: name.split(...), name.charAt(...) etc — already counted above.
    }
    if (node.type === 'ObjectExpression' || node.type === 'NewExpression') {
      const args = (node.arguments as N[]) || [];
      for (const a of args) {
        if (a?.type === 'Identifier' && (a as N).name === name) objecty++;
      }
    }

    // Recurse into all child nodes.
    for (const k of Object.keys(node)) {
      const v = (node as Record<string, unknown>)[k];
      if (Array.isArray(v)) for (const x of v) stack.push(x);
      else if (v && typeof v === 'object' && (v as N).type) stack.push(v);
    }
  }

  // Pick a name based on the strongest signal.
  if (calledAsFn > 0) return 'fn';
  if (stringy > 0 && stringy >= numeric && stringy >= arrayy) {
    if (methodHits.has('split')) return 'str';
    if (methodHits.has('match')) return 'str';
    return 'str';
  }
  if (numeric > 0 && numeric >= arrayy) return 'n';
  if (arrayy > 0) return 'arr';
  if (objecty > 0) return 'obj';
  return null;
}

function nameFromString(s: string): string {
  if (!s) return 'str';
  // URL?
  if (/^https?:\/\//.test(s)) {
    if (s.includes('/api/') || /\bapi\./.test(s)) return 'apiUrl';
    return 'url';
  }
  if (/^\/api\//.test(s)) return 'apiPath';
  if (/^[A-Z][A-Z0-9_]+$/.test(s)) return s.toLowerCase();
  // Looks like a class name or constant.
  if (/^[a-zA-Z_][a-zA-Z0-9_]*$/.test(s) && s.length <= 24) return s;
  if (/error|fail/i.test(s)) return 'errMsg';
  if (/success|ok/i.test(s)) return 'msg';
  return 'str';
}

function roleBase(role: 'str' | 'num' | 'arr' | 'obj' | 'fn' | 'unknown'): string {
  switch (role) {
    case 'str':
      return 'str';
    case 'num':
      return 'n';
    case 'arr':
      return 'arr';
    case 'obj':
      return 'o';
    case 'fn':
      return 'fn';
    case 'unknown':
    default:
      return 'v';
  }
}

function sanitizeIdentifier(s: string): string {
  let out = s.replace(/[^a-zA-Z0-9_$]/g, '');
  if (!out || /^[0-9]/.test(out)) out = 'v' + out;
  // Avoid clashing with reserved JS keywords.
  const reserved = new Set([
    'break', 'case', 'catch', 'class', 'const', 'continue', 'debugger', 'default',
    'delete', 'do', 'else', 'export', 'extends', 'finally', 'for', 'function', 'if',
    'import', 'in', 'instanceof', 'let', 'new', 'null', 'return', 'super', 'switch',
    'this', 'throw', 'true', 'false', 'try', 'typeof', 'var', 'void', 'while', 'with',
    'yield', 'enum', 'await', 'implements', 'interface', 'package', 'private',
    'protected', 'public', 'static',
  ]);
  if (reserved.has(out)) out = '_' + out;
  return out;
}
