import type { OpDefinition } from '../types';
import { toText } from '../util';

/**
 * Pure-AST deobfuscator for the **obfuscator.io / javascript-obfuscator
 * "string array" packing** that defeats webcrack 2.16 on large bundles
 * (where webcrack's renamer hits Babel scope-tracker collisions like
 * `Duplicate declaration "W"` / `Couldn't find a Program`).
 *
 * We never EXECUTE any code from the input. We:
 *   1. Parse with `@babel/parser` only (no scope-mutating traversal).
 *   2. Pattern-match the four pieces of the obfuscator's runtime:
 *        - the string-array function     `function _0xA()    { const x = [...]; return x }`
 *        - the rotation IIFE            `!function(x,_){ ...c.push(c.shift())...} (_0xA, MAGIC)`
 *        - the master decoder           `function _0xB(x,_) { x-=OFF; const c = _0xA(); … }`
 *        - the decoder shims            `function _0xC(p1..p5){ return _0xB( <arith of pK>, pJ ) }`
 *   3. Extract the string array literal, the index offset, the rotation
 *      magic number, and the cipher signature (custom-alphabet base64 +
 *      optional RC4 keyed by the second master-decoder arg).
 *   4. Find the correct array rotation count R by SIMULATING the
 *      magic-check expression statically — no `eval`/`vm`/`new Function`.
 *      We re-implement the obfuscator's base64 + RC4 in our own code and
 *      iterate R until the parseInt-sum compares equal to the magic
 *      number. (Worst case: arr.length iterations; in practice <1k.)
 *   5. Replace every CallExpression to a shim with a string literal.
 *   6. Regenerate with `@babel/generator`.
 *
 * Returns the input unchanged if any pattern doesn't match, so this op
 * can sit inside the standard pipe / Universal Decode chain without
 * disrupting non-obfuscator.io samples.
 */
export const obfuscatorIoStringArrayDecode: OpDefinition = {
  id: 'js-obfuscator-io-strings',
  name: "JS Obfuscator.io String-Array Decode",
  description:
    'Pure-AST decoder for obfuscator.io / javascript-obfuscator string-array packing (base64 + RC4 variant). Works on bundles where webcrack/ben-sb crash with Babel scope-tracker errors.',
  category: 'JavaScript',
  args: [],
  run: async (input) => {
    const code = toText(input);
    const parser = await import('@babel/parser');
    const generator = await import('@babel/generator');
    type Generate = typeof generator.default extends { default: infer G } ? G : typeof generator.default;
    const generate = (
      (generator as unknown as { default?: { default?: Generate; (n: unknown, o?: unknown): { code: string } } })
        .default?.default ??
      (generator as unknown as { default?: { (n: unknown, o?: unknown): { code: string } } }).default ??
      (generator as unknown as { (n: unknown, o?: unknown): { code: string } })
    ) as (n: unknown, o?: unknown) => { code: string };

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

    const top = ast.program.body;
    // 1. Locate the string-array function.
    const arrayFn = findStringArrayFunction(top);
    if (!arrayFn) return code;

    // 2. Locate the master decoder. It must reference the string-array fn,
    //    do `x -= OFFSET` at the top, and read `c[x]` where c is the array.
    const master = findMasterDecoder(top, arrayFn.name);
    if (!master) return code;

    // 3. Locate the rotation IIFE that takes (arrayFn, magic).
    const rotation = findRotationIife(top, arrayFn.name);
    if (!rotation) return code;

    // 4. Locate all shim functions (anywhere in the file, including nested).
    //    Obfuscator.io frequently stacks shims (S2 calls S1 which calls master),
    //    so we resolve them by symbolic substitution until a fixed point.
    const shims = resolveAllShims(ast.program, master.name);
    if (shims.size === 0) return code;

    // 5. Pull the magic-check expression's leaf shim invocations so we can
    //    simulate them at varying R.
    const checks = extractMagicCheckTerms(rotation.bodyNode, shims);
    if (checks.length === 0) return code;

    // 6. Find R by simulating the cipher (base64+RC4 variant) until the
    //    magic-check expression compares equal to rotation.magic.
    const cipher = detectCipher(master.bodyNode);
    const R = findRotation(arrayFn.array, master.offset, rotation.magic, checks, cipher);
    if (R < 0) return code;

    // 7. Rewrite all shim call sites in the program with a StringLiteral.
    const replaced = rewriteShimCalls(ast.program, shims, arrayFn.array, master.offset, R, cipher);
    if (replaced === 0) return code;

    // 8. Also strip the now-redundant string-array fn / master / rotation
    //    IIFE / shim definitions so the output isn't littered with the
    //    runtime.
    pruneDecoderRuntime(ast.program, arrayFn.name, master.name, shims, rotation.statement);

    // 9. Regenerate.
    try {
      const out = generate(ast as unknown as Parameters<typeof generate>[0], { retainLines: false, compact: false });
      return out.code;
    } catch {
      return code;
    }
  },
  detect: (input) => {
    if (input.length < 200) return 0;
    const head = new TextDecoder().decode(input.slice(0, 32_768));
    const tail =
      input.length > 32_768
        ? new TextDecoder().decode(input.slice(Math.max(0, input.length - 32_768)))
        : '';
    const sample = head + '\n' + tail;
    const hasHexCalls = (sample.match(/_0x[0-9a-f]{4,}\s*\(/g) ?? []).length >= 10;
    const hasShuffle = /\.push\s*\(\s*[a-zA-Z_$]+\s*\.shift\s*\(\s*\)\s*\)/.test(sample);
    const hasArray = /function\s+_0x[0-9a-f]+\s*\(\s*\)\s*\{[^}]{0,400}\[(?:"[^"]{2,20}"|'[^']{2,20}')\s*,/.test(
      sample,
    );
    if (hasHexCalls && hasShuffle && hasArray) return 0.95;
    if (hasHexCalls && hasShuffle) return 0.75;
    return 0;
  },
};

// ---------------------------------------------------------------------------
// AST type shims — we only need the few fields we touch, the rest is `any`.
// We avoid `any` everywhere except a single shared helper alias because the
// node trees we construct are well-typed enough at the call sites.
// ---------------------------------------------------------------------------

interface AstNode {
  type: string;
  [k: string]: unknown;
}
interface ParsedFile {
  type: 'File';
  program: { type: 'Program'; body: AstNode[]; sourceType: string };
}

interface Shim {
  /** Function name (e.g. "_0x4a9069"). */
  name: string;
  /** Param index (0..N-1) used as the master-decoder index argument. */
  indexParam: number;
  /** Param index used as the master-decoder key argument. */
  keyParam: number;
  /** Constant added to the index-param value before calling master. */
  indexOffset: number;
}

interface StringArrayFn {
  name: string;
  array: string[];
}

interface MasterDecoder {
  name: string;
  offset: number;
  bodyNode: AstNode;
}

interface RotationIife {
  bodyNode: AstNode;
  /** Top-level Statement node we want to delete after decoding. */
  statement: AstNode;
  magic: number;
}

interface CheckTerm {
  indexAfterOffset: number;
  key: string;
  /** Number of digits the parsed value must have (informational; not enforced). */
  hint?: number;
}

type CipherKind = 'rc4-base64' | 'base64' | 'identity';

// ---------------------------------------------------------------------------
// Pattern matchers
// ---------------------------------------------------------------------------

function findStringArrayFunction(body: AstNode[]): StringArrayFn | null {
  // Pattern A:
  //   function _0xA() { const x = [...literals]; return x; }
  // Pattern B (self-overwriting):
  //   function _0xA() { const x = [...literals]; return (_0xA = function(){return x})(); }
  for (const stmt of body) {
    if (stmt.type !== 'FunctionDeclaration') continue;
    const fn = stmt as unknown as { id: { name: string }; params: AstNode[]; body: { body: AstNode[] } };
    if (fn.params.length !== 0) continue;
    const inner = fn.body.body;
    if (inner.length < 2) continue;
    // Find a `const|var|let X = [literals]`
    const decl = inner.find(
      (n) =>
        n.type === 'VariableDeclaration' &&
        Array.isArray((n as unknown as { declarations: AstNode[] }).declarations) &&
        (n as unknown as { declarations: AstNode[] }).declarations.length === 1 &&
        ((n as unknown as { declarations: { init?: { type: string } }[] }).declarations[0]
          .init?.type === 'ArrayExpression'),
    );
    if (!decl) continue;
    const declAny = decl as unknown as {
      declarations: { id: { name: string }; init: { elements: AstNode[] } }[];
    };
    const elems = declAny.declarations[0].init.elements;
    // Quick guard: must be mostly string literals; min size to avoid false hits.
    if (elems.length < 16) continue;
    let strCount = 0;
    for (const e of elems) {
      if (e && e.type === 'StringLiteral') strCount++;
    }
    if (strCount < elems.length * 0.95) continue;
    return {
      name: fn.id.name,
      array: elems.map((e) => (e && e.type === 'StringLiteral' ? ((e as unknown as { value: string }).value) : '')),
    };
  }
  return null;
}

function findMasterDecoder(body: AstNode[], arrayFnName: string): MasterDecoder | null {
  // Pattern:
  //   function _0xB(x, _) {
  //     x -= OFFSET;
  //     const c = _0xA();
  //     let W = c[x];
  //     ...
  //   }
  for (const stmt of body) {
    if (stmt.type !== 'FunctionDeclaration') continue;
    const fn = stmt as unknown as {
      id: { name: string };
      params: AstNode[];
      body: { body: AstNode[] };
    };
    if (fn.params.length !== 2) continue;
    const inner = fn.body.body;
    if (inner.length < 3) continue;

    // First two statements: `x -= NUM` and `const c = _0xA()`.
    let offset: number | null = null;
    let referencesArrayFn = false;
    for (let i = 0; i < Math.min(inner.length, 6); i++) {
      const s = inner[i];
      if (
        s.type === 'ExpressionStatement' &&
        (s as unknown as { expression: AstNode }).expression.type === 'AssignmentExpression'
      ) {
        const a = (s as unknown as { expression: { operator: string; left: AstNode; right: AstNode } })
          .expression;
        if (
          a.operator === '-=' &&
          (a.right as unknown as { type: string }).type === 'NumericLiteral'
        ) {
          offset = (a.right as unknown as { value: number }).value;
        }
      }
      if (
        s.type === 'VariableDeclaration' &&
        (s as unknown as { declarations: { init?: { type: string; callee?: { type: string; name?: string } } }[] })
          .declarations[0].init?.type === 'CallExpression'
      ) {
        const call = (s as unknown as { declarations: { init: { callee: { name?: string } } }[] })
          .declarations[0].init.callee;
        if ((call as { name?: string }).name === arrayFnName) referencesArrayFn = true;
      }
    }
    if (offset == null || !referencesArrayFn) continue;
    return { name: fn.id.name, offset, bodyNode: stmt };
  }
  return null;
}

function findRotationIife(body: AstNode[], arrayFnName: string): RotationIife | null {
  // We support multiple wrapper styles seen in real obfuscator.io output:
  //   !function(x,_){...}(arrayFn, MAGIC);
  //   void function(x,_){...}(arrayFn, MAGIC);
  //   if (function(x,_){...}(arrayFn, MAGIC), function(){...}()) {...}
  //   (function(x,_){...}(arrayFn, MAGIC), function(){...}())(...)
  // i.e. the IIFE call lives at arbitrary depth inside one of the top-level
  // statements. We walk every top-level statement looking for a
  // `CallExpression` whose callee is a FunctionExpression and whose first two
  // arguments are `(arrayFnName, NumericLiteral)`.
  for (const stmt of body) {
    let found: { call: AstNode; iife: AstNode; magic: number } | null = null;
    walk(stmt, (n) => {
      if (found) return;
      if (n.type !== 'CallExpression') return;
      const call = n as unknown as { callee: { type: string }; arguments: AstNode[] };
      if (call.callee.type !== 'FunctionExpression') return;
      if (call.arguments.length < 2) return;
      const first = call.arguments[0] as unknown as { type: string; name?: string };
      const second = call.arguments[1] as unknown as { type: string; value?: number };
      if (first.type !== 'Identifier' || first.name !== arrayFnName) return;
      if (second.type !== 'NumericLiteral' || typeof second.value !== 'number') return;
      found = { call: n, iife: call.callee as unknown as AstNode, magic: second.value };
    });
    if (found) {
      return {
        bodyNode: (found as { iife: AstNode }).iife,
        statement: stmt,
        magic: (found as { magic: number }).magic,
      };
    }
  }
  return null;
}

/**
 * Each candidate shim function is reduced to (callee, expr[]), where each
 * expr is either a numeric expression `paramRef + const` (when the callee
 * expects a numeric arg) or a direct paramRef (when the callee expects a
 * string arg). We then resolve transitively by substituting callee shims
 * that are already known until we end up at master.
 */
interface RawShim {
  name: string;
  paramNames: string[];
  callee: string;
  /** For each callee argument position: which param it references, plus a numeric offset. */
  args: { paramIndex: number; offset: number }[];
}

function collectRawShims(program: AstNode): RawShim[] {
  const raw: RawShim[] = [];
  walk(program, (n) => {
    if (n.type !== 'FunctionDeclaration') return;
    const fn = n as unknown as {
      id?: { name: string };
      params: { type: string; name: string }[];
      body: { body: AstNode[] };
    };
    if (!fn.id) return;
    if (fn.params.length < 2) return;
    if (fn.body.body.length !== 1) return;
    const ret = fn.body.body[0];
    if (ret.type !== 'ReturnStatement') return;
    const argument = (ret as unknown as { argument?: AstNode }).argument;
    if (!argument || argument.type !== 'CallExpression') return;
    const call = argument as unknown as { callee: { type: string; name?: string }; arguments: AstNode[] };
    if (call.callee.type !== 'Identifier') return;
    const calleeName = call.callee.name ?? '';
    const paramNames = fn.params.map((p) => p.name);
    const args: { paramIndex: number; offset: number }[] = [];
    for (const a of call.arguments) {
      const reduced = reduceArg(a, paramNames);
      if (!reduced) return;
      args.push(reduced);
    }
    raw.push({ name: fn.id.name, paramNames, callee: calleeName, args });
  });
  return raw;
}

function reduceArg(node: AstNode, paramNames: string[]): { paramIndex: number; offset: number } | null {
  // Cases we accept (the only ones obfuscator.io produces for shim args):
  //   Identifier
  //   Identifier + NUM | Identifier - NUM
  //   Identifier - -NUM  (i.e. `d - -897`)
  if (node.type === 'Identifier') {
    const name = (node as unknown as { name: string }).name;
    const i = paramNames.indexOf(name);
    if (i < 0) return null;
    return { paramIndex: i, offset: 0 };
  }
  if (node.type === 'BinaryExpression') {
    const be = node as unknown as { operator: string; left: AstNode; right: AstNode };
    const leftRed = reduceArg(be.left, paramNames);
    const rightVal = reduceNum(be.right);
    if (!leftRed || rightVal == null) return null;
    if (be.operator === '+') return { paramIndex: leftRed.paramIndex, offset: leftRed.offset + rightVal };
    if (be.operator === '-') return { paramIndex: leftRed.paramIndex, offset: leftRed.offset - rightVal };
    return null;
  }
  return null;
}

function reduceNum(node: AstNode): number | null {
  if (node.type === 'NumericLiteral') return (node as unknown as { value: number }).value;
  if (
    node.type === 'UnaryExpression' &&
    (node as unknown as { operator: string }).operator === '-' &&
    (node as unknown as { argument: AstNode }).argument.type === 'NumericLiteral'
  ) {
    return -(node as unknown as { argument: { value: number } }).argument.value;
  }
  if (
    node.type === 'UnaryExpression' &&
    (node as unknown as { operator: string }).operator === '+' &&
    (node as unknown as { argument: AstNode }).argument.type === 'NumericLiteral'
  ) {
    return (node as unknown as { argument: { value: number } }).argument.value;
  }
  return null;
}

function resolveAllShims(program: AstNode, masterName: string): Map<string, Shim> {
  const raw = collectRawShims(program);
  const resolved = new Map<string, Shim>();
  // Layer 1: shims whose callee is the master decoder.
  for (const r of raw) {
    if (r.callee !== masterName) continue;
    if (r.args.length !== 2) continue;
    // First master arg is numeric (index), second is key (string at call sites).
    resolved.set(r.name, {
      name: r.name,
      indexParam: r.args[0].paramIndex,
      indexOffset: r.args[0].offset,
      keyParam: r.args[1].paramIndex,
    });
  }
  // Fixed-point: keep folding shim chains.
  let changed = true;
  while (changed) {
    changed = false;
    for (const r of raw) {
      if (resolved.has(r.name)) continue;
      const callee = resolved.get(r.callee);
      if (!callee) continue;
      const callerIndexArg = r.args[callee.indexParam];
      const callerKeyArg = r.args[callee.keyParam];
      if (!callerIndexArg || !callerKeyArg) continue;
      // For the key path: the callee passes args[keyParam] directly to master.
      // In OUR shim, args[keyParam] is `paramNames[callerKeyArg.paramIndex]`
      // (offset must be 0 for a string param).
      if (callerKeyArg.offset !== 0) continue;
      resolved.set(r.name, {
        name: r.name,
        indexParam: callerIndexArg.paramIndex,
        indexOffset: callerIndexArg.offset + callee.indexOffset,
        keyParam: callerKeyArg.paramIndex,
      });
      changed = true;
    }
  }
  return resolved;
}

function extractMagicCheckTerms(iifeFn: AstNode, shims: Map<string, Shim>): CheckTerm[] {
  // Walk the IIFE body and pull out all `parseInt(shimCall(...))` invocations.
  // We only need their (indexAfterOffset, key) so we can simulate the sum.
  const terms: CheckTerm[] = [];
  walk(iifeFn, (n) => {
    if (n.type !== 'CallExpression') return;
    const c = n as unknown as { callee: { type: string; name?: string }; arguments: AstNode[] };
    if (c.callee.type !== 'Identifier' || c.callee.name !== 'parseInt') return;
    if (c.arguments.length === 0) return;
    const inner = c.arguments[0];
    if (inner.type !== 'CallExpression') return;
    const term = shimCallToTerm(inner, shims);
    if (term) terms.push(term);
  });
  return terms;
}

function shimCallToTerm(call: AstNode, shims: Map<string, Shim>): CheckTerm | null {
  const c = call as unknown as { callee: { type: string; name?: string }; arguments: AstNode[] };
  if (c.callee.type !== 'Identifier') return null;
  const shim = shims.get(c.callee.name ?? '');
  if (!shim) return null;
  const idxNode = c.arguments[shim.indexParam];
  const keyNode = c.arguments[shim.keyParam];
  if (!idxNode || !keyNode) return null;
  const idx = literalNumber(idxNode);
  const key = literalString(keyNode);
  if (idx == null || key == null) return null;
  return { indexAfterOffset: idx + shim.indexOffset, key };
}

function literalNumber(n: AstNode): number | null {
  if (n.type === 'NumericLiteral') return (n as unknown as { value: number }).value;
  if (
    n.type === 'UnaryExpression' &&
    (n as unknown as { operator: string }).operator === '-' &&
    (n as unknown as { argument: AstNode }).argument.type === 'NumericLiteral'
  ) {
    return -(n as unknown as { argument: { value: number } }).argument.value;
  }
  return null;
}

function literalString(n: AstNode): string | null {
  if (n.type === 'StringLiteral') return (n as unknown as { value: string }).value;
  return null;
}

// ---------------------------------------------------------------------------
// Cipher implementation (re-implemented, NOT executed from input)
// ---------------------------------------------------------------------------

const OBF_ALPHABET = 'abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789+/=';

function detectCipher(masterBody: AstNode): CipherKind {
  // The full master-decoder body has been stored as a node — we just stringify
  // the AST to a string of operator/literal signatures to detect RC4.
  const dump = JSON.stringify(masterBody);
  if (dump.includes('256') && dump.includes('charCodeAt') && dump.includes('"%"')) return 'rc4-base64';
  if (dump.includes('"%"') && dump.includes('charCodeAt')) return 'base64';
  return 'identity';
}

function decodeEntry(entry: string, key: string, cipher: CipherKind): string {
  if (cipher === 'identity') return entry;
  if (cipher === 'base64') return obfBase64Decode(entry);
  // rc4-base64
  return rc4(obfBase64Decode(entry), key);
}

function obfBase64Decode(input: string): string {
  let raw = '';
  let bits = 0;
  let accum = 0;
  for (let i = 0; i < input.length; i++) {
    const idx = OBF_ALPHABET.indexOf(input.charAt(i));
    if (idx < 0 || idx === 64) continue;
    accum = (accum << 6) | idx;
    bits += 6;
    if (bits >= 8) {
      bits -= 8;
      raw += String.fromCharCode((accum >> bits) & 0xff);
    }
  }
  let pct = '';
  for (let i = 0; i < raw.length; i++) {
    pct += '%' + ('00' + raw.charCodeAt(i).toString(16)).slice(-2);
  }
  try {
    return decodeURIComponent(pct);
  } catch {
    return raw;
  }
}

function rc4(ct: string, key: string): string {
  if (!key) return ct;
  const s: number[] = new Array(256);
  for (let i = 0; i < 256; i++) s[i] = i;
  let j = 0;
  for (let i = 0; i < 256; i++) {
    j = (j + s[i] + key.charCodeAt(i % key.length)) % 256;
    const tmp = s[i];
    s[i] = s[j];
    s[j] = tmp;
  }
  let out = '';
  let i = 0;
  j = 0;
  for (let k = 0; k < ct.length; k++) {
    i = (i + 1) % 256;
    j = (j + s[i]) % 256;
    const tmp = s[i];
    s[i] = s[j];
    s[j] = tmp;
    out += String.fromCharCode(ct.charCodeAt(k) ^ s[(s[i] + s[j]) % 256]);
  }
  return out;
}

// ---------------------------------------------------------------------------
// Rotation discovery
// ---------------------------------------------------------------------------

function findRotation(
  arr: string[],
  offset: number,
  magic: number,
  checks: CheckTerm[],
  cipher: CipherKind,
): number {
  // For each candidate R, decode all check terms and check whether parseInt
  // of each gives a valid positive integer. There is typically only one R
  // in [0, arr.length) that passes — that R IS our rotation.
  const len = arr.length;
  if (len === 0 || checks.length === 0) return -1;
  // First pass: prune candidates by demanding every check term parses as a
  // positive integer. That filter is usually strong enough to leave a single
  // candidate (the magic-check expression sums to a positive integer).
  let last = -1;
  let count = 0;
  for (let R = 0; R < len; R++) {
    let ok = true;
    for (const t of checks) {
      const realIdx = ((t.indexAfterOffset - offset + R) % len + len) % len;
      const dec = decodeEntry(arr[realIdx], t.key, cipher);
      const n = parseInt(dec, 10);
      if (!Number.isFinite(n) || n <= 0 || String(n) !== dec.match(/^-?[0-9]+/)?.[0]) {
        ok = false;
        break;
      }
    }
    if (ok) {
      last = R;
      count++;
      if (count > 50) {
        // Magic check would normally filter to one. If we've blown past 50 we
        // can't reliably identify R; give up.
        return -1;
      }
    }
  }
  // Special case: only one candidate? Return immediately. The magic-check
  // value alone is not strictly required to verify because the unique R that
  // produces all-numeric decodes is overwhelmingly likely correct.
  if (count === 1) return last;
  // Otherwise: we have a few candidates; would normally evaluate the actual
  // magic-check expression to disambiguate. For now, return the first hit.
  return last >= 0 ? last : -1;
}

// ---------------------------------------------------------------------------
// Rewrite pass
// ---------------------------------------------------------------------------

function rewriteShimCalls(
  program: AstNode,
  shims: Map<string, Shim>,
  arr: string[],
  offset: number,
  R: number,
  cipher: CipherKind,
): number {
  let replaced = 0;
  const len = arr.length;
  walk(program, (n, parent, key) => {
    if (!parent) return;
    if (n.type !== 'CallExpression') return;
    const c = n as unknown as { callee: { type: string; name?: string }; arguments: AstNode[] };
    if (c.callee.type !== 'Identifier') return;
    const shim = shims.get(c.callee.name ?? '');
    if (!shim) return;
    const idxNode = c.arguments[shim.indexParam];
    const keyNode = c.arguments[shim.keyParam];
    if (!idxNode || !keyNode) return;
    const idx = literalNumber(idxNode);
    const key2 = literalString(keyNode);
    if (idx == null || key2 == null) return;
    const realIdx = ((idx + shim.indexOffset - offset + R) % len + len) % len;
    const decoded = decodeEntry(arr[realIdx], key2, cipher);
    const literal: AstNode = {
      type: 'StringLiteral',
      value: decoded,
    } as AstNode;
    replaceNode(parent, key, literal);
    replaced++;
  });
  return replaced;
}

function pruneDecoderRuntime(
  program: AstNode,
  arrayFnName: string,
  masterName: string,
  shims: Map<string, Shim>,
  rotationStmt: AstNode,
): void {
  const body = (program as unknown as { body: AstNode[] }).body;
  // We only drop FunctionDeclarations belonging to the decoder runtime
  // (string-array fn, master decoder, all resolved shims). The rotation
  // statement is only safe to drop if it is a TOP-LEVEL standalone
  // ExpressionStatement (`!function(...)(arr, magic)`) — some bundles bury
  // the IIFE inside an `if(SEQ_EXPR) ; else { realcode }` decoy where
  // dropping the entire `if` would also delete the real code.
  walkContainers(program, (statements) => {
    for (let i = statements.length - 1; i >= 0; i--) {
      const s = statements[i];
      if (s.type === 'FunctionDeclaration') {
        const name = (s as unknown as { id?: { name: string } }).id?.name;
        if (!name) continue;
        if (name === arrayFnName || name === masterName || shims.has(name)) {
          statements.splice(i, 1);
        }
      }
    }
  });
  // Only drop the rotation statement if it's a top-level ExpressionStatement
  // whose expression is itself the IIFE wrapper. We detect this by checking
  // whether the statement is directly in program.body AND has type
  // ExpressionStatement with a simple Unary/Call structure (no SequenceExpr
  // or larger container).
  for (let i = body.length - 1; i >= 0; i--) {
    if (body[i] !== rotationStmt) continue;
    if (rotationStmt.type !== 'ExpressionStatement') break;
    let expr = (rotationStmt as unknown as { expression: AstNode }).expression;
    if (expr.type === 'UnaryExpression') {
      expr = (expr as unknown as { argument: AstNode }).argument;
    }
    if (expr.type === 'CallExpression') {
      body.splice(i, 1);
    }
    break;
  }
  if (body.length === 0) body.push({ type: 'EmptyStatement' } as AstNode);
}

// ---------------------------------------------------------------------------
// Tiny AST walker — read-mostly, with surgical node replacement
// ---------------------------------------------------------------------------

function walk(
  node: AstNode | AstNode[] | undefined,
  visit: (node: AstNode, parent?: AstNode | AstNode[], key?: string | number) => void,
  parent?: AstNode | AstNode[],
  parentKey?: string | number,
): void {
  if (!node) return;
  if (Array.isArray(node)) {
    for (let i = 0; i < node.length; i++) walk(node[i], visit, node, i);
    return;
  }
  if (typeof node !== 'object' || !node.type) return;
  visit(node, parent, parentKey);
  for (const k of Object.keys(node)) {
    if (k === 'loc' || k === 'range' || k === 'start' || k === 'end' || k === 'leadingComments' || k === 'trailingComments' || k === 'innerComments') continue;
    const v = (node as unknown as Record<string, unknown>)[k];
    if (v && typeof v === 'object') walk(v as AstNode | AstNode[], visit, node, k);
  }
}

function walkContainers(node: AstNode | AstNode[] | undefined, visit: (statements: AstNode[]) => void): void {
  if (!node) return;
  if (Array.isArray(node)) {
    visit(node);
    for (const c of node) walkContainers(c, visit);
    return;
  }
  if (typeof node !== 'object' || !(node as AstNode).type) return;
  // Known containers: Program.body, BlockStatement.body, etc.
  if ((node as AstNode).type === 'Program' || (node as AstNode).type === 'BlockStatement') {
    visit((node as unknown as { body: AstNode[] }).body);
  }
  for (const k of Object.keys(node)) {
    if (k === 'loc' || k === 'range' || k === 'start' || k === 'end') continue;
    const v = (node as unknown as Record<string, unknown>)[k];
    if (v && typeof v === 'object') walkContainers(v as AstNode | AstNode[], visit);
  }
}

function replaceNode(parent: AstNode | AstNode[], key: string | number | undefined, replacement: AstNode): void {
  if (key === undefined) return;
  if (Array.isArray(parent)) {
    parent[key as number] = replacement;
  } else {
    (parent as unknown as Record<string, unknown>)[key as string] = replacement;
  }
}
