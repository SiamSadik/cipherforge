import type { OpDefinition } from '../types';
import { toText } from '../util';

/**
 * Constant-folding / expression-simplification pass.
 *
 *   'a' + 'b' + 'c'     → 'abc'
 *   'foo'.length        → 3
 *   !0, !1              → true / false
 *   !![],  !+[]         → true / false
 *   +[]                 → 0
 *   1 + 2               → 3
 *   true && expr        → expr
 *   false && expr       → false
 *   "abc"[0]            → 'a'
 *
 * Works in scope: only folds nodes whose value is statically computable
 * from literals. Never executes user-supplied function bodies.
 */
type ParseFn = (code: string, opts: object) => unknown;
type TraverseFn = (node: unknown, visitor: object) => void;
type GeneratorFn = (node: unknown, opts: object) => { code: string };
type TypesAPI = {
  stringLiteral: (value: string) => unknown;
  numericLiteral: (value: number) => unknown;
  booleanLiteral: (value: boolean) => unknown;
  nullLiteral: () => unknown;
  isStringLiteral: (n: unknown) => boolean;
  isNumericLiteral: (n: unknown) => boolean;
  isBooleanLiteral: (n: unknown) => boolean;
  isNullLiteral: (n: unknown) => boolean;
  isArrayExpression: (n: unknown) => boolean;
};

let babelLoader: Promise<{
  parse: ParseFn;
  traverse: TraverseFn;
  generate: GeneratorFn;
  types: TypesAPI;
}> | null = null;
async function loadBabel() {
  if (!babelLoader) {
    babelLoader = (async () => {
      const [parser, traverse, generator, types] = await Promise.all([
        import('@babel/parser'),
        import('@babel/traverse'),
        import('@babel/generator'),
        import('@babel/types'),
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
        types: types as unknown as TypesAPI,
      };
    })();
  }
  return babelLoader;
}

export const constantFold: OpDefinition = {
  id: 'js-constant-fold',
  name: 'JS Constant Folding',
  description:
    'Simplify literal expressions: string concat, !0/!1, +[], "x".length, true && a \u2014 all evaluated statically without running the code.',
  category: 'JavaScript',
  run: async (input) => {
    const code = toText(input);
    try {
      return await foldPass(code);
    } catch (err) {
      throw new Error(`Constant folding failed: ${(err as Error).message}`, { cause: err });
    }
  },
};

async function foldPass(code: string): Promise<string> {
  const { parse, traverse, generate, types: t } = await loadBabel();
  const ast = parse(code, {
    sourceType: 'unambiguous',
    allowReturnOutsideFunction: true,
    allowAwaitOutsideFunction: true,
    plugins: ['jsx'],
    errorRecovery: true,
  });

  type Path = { node: unknown; replaceWith: (n: unknown) => void };
  const Node = (n: unknown) => n as { type: string; [k: string]: unknown };

  function literal(value: unknown): unknown | null {
    if (typeof value === 'string') return t.stringLiteral(value);
    if (typeof value === 'number' && Number.isFinite(value)) return t.numericLiteral(value);
    if (typeof value === 'boolean') return t.booleanLiteral(value);
    if (value === null) return t.nullLiteral();
    return null;
  }

  function evalNode(n: unknown): { value: unknown; ok: boolean } {
    if (!n) return { value: undefined, ok: false };
    const node = Node(n);
    if (t.isStringLiteral(n)) return { value: node.value, ok: true };
    if (t.isNumericLiteral(n)) return { value: node.value, ok: true };
    if (t.isBooleanLiteral(n)) return { value: node.value, ok: true };
    if (t.isNullLiteral(n)) return { value: null, ok: true };
    if (t.isArrayExpression(n)) {
      const elements = node.elements as unknown[];
      if (elements.length === 0) return { value: [] as unknown[], ok: true };
    }
    return { value: undefined, ok: false };
  }

  // We loop until stable — folding can expose new fold opportunities.
  let changed = true;
  let safety = 0;
  while (changed && safety++ < 16) {
    changed = false;

    try {
      traverse(ast, {
      UnaryExpression(path: Path) {
        const node = Node(path.node);
        const { value, ok } = evalNode(node.argument);
        const op = node.operator as string;
        if (op === '!') {
          if (ok) {
            const v = literal(!value);
            if (v) {
              path.replaceWith(v);
              changed = true;
            }
          } else if ((node.argument as { type: string }).type === 'ArrayExpression') {
            const elements = (node.argument as { elements: unknown[] }).elements;
            const v = literal(elements.length === 0 ? true : false);
            if (v) {
              path.replaceWith(v);
              changed = true;
            }
          }
        } else if (op === '+') {
          if (ok && (typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean' || value === null)) {
            const num = Number(value);
            if (Number.isFinite(num)) {
              const v = literal(num);
              if (v) {
                path.replaceWith(v);
                changed = true;
              }
            }
          } else if ((node.argument as { type: string }).type === 'ArrayExpression') {
            const elements = (node.argument as { elements: unknown[] }).elements;
            if (elements.length === 0) {
              path.replaceWith(t.numericLiteral(0));
              changed = true;
            }
          }
        } else if (op === '-') {
          if (ok && typeof value === 'number') {
            path.replaceWith(t.numericLiteral(-value));
            changed = true;
          }
        } else if (op === 'void') {
          // Replace `void <literal>` with `undefined`-equivalent: keep `void 0`.
          // Skip — leaving as-is is fine.
        }
      },

      BinaryExpression(path: Path) {
        const node = Node(path.node);
        const op = node.operator as string;
        const left = evalNode(node.left);
        const right = evalNode(node.right);
        if (!left.ok || !right.ok) return;

        const lv = left.value as string | number | boolean | null;
        const rv = right.value as string | number | boolean | null;
        let result: unknown;
        try {
          switch (op) {
            case '+':
              result = (lv as string) + (rv as string);
              break;
            case '-':
              result = (lv as number) - (rv as number);
              break;
            case '*':
              result = (lv as number) * (rv as number);
              break;
            case '/':
              if (rv === 0 || rv === '0') return;
              result = (lv as number) / (rv as number);
              break;
            case '%':
              if (rv === 0 || rv === '0') return;
              result = (lv as number) % (rv as number);
              break;
            case '==':
              result = lv == rv;
              break;
            case '===':
              result = lv === rv;
              break;
            case '!=':
              result = lv != rv;
              break;
            case '!==':
              result = lv !== rv;
              break;
            case '<':
              result = (lv as number) < (rv as number);
              break;
            case '<=':
              result = (lv as number) <= (rv as number);
              break;
            case '>':
              result = (lv as number) > (rv as number);
              break;
            case '>=':
              result = (lv as number) >= (rv as number);
              break;
            case '&':
              result = (lv as number) & (rv as number);
              break;
            case '|':
              result = (lv as number) | (rv as number);
              break;
            case '^':
              result = (lv as number) ^ (rv as number);
              break;
            case '<<':
              result = (lv as number) << (rv as number);
              break;
            case '>>':
              result = (lv as number) >> (rv as number);
              break;
            case '>>>':
              result = (lv as number) >>> (rv as number);
              break;
            default:
              return;
          }
        } catch {
          return;
        }
        const v = literal(result);
        if (v) {
          path.replaceWith(v);
          changed = true;
        }
      },

      LogicalExpression(path: Path) {
        const node = Node(path.node);
        const op = node.operator as string;
        const left = evalNode(node.left);
        if (!left.ok) return;
        if (op === '&&') {
          if (!left.value) {
            path.replaceWith(node.left);
          } else {
            path.replaceWith(node.right);
          }
          changed = true;
        } else if (op === '||') {
          if (left.value) {
            path.replaceWith(node.left);
          } else {
            path.replaceWith(node.right);
          }
          changed = true;
        }
      },

      MemberExpression(path: Path) {
        const node = Node(path.node);
        if (node.computed && (node.property as { type: string }).type === 'StringLiteral') {
          // `x['y']` → `x.y`. Babel generator handles that automatically when
          // the string is a valid identifier; we still want to preserve it
          // through replacement.
        }
        // Fold "abc"[0] → 'a' or "abc".length → 3.
        if ((node.object as { type: string }).type === 'StringLiteral') {
          const str = (node.object as { value: string }).value;
          if (
            !node.computed &&
            (node.property as { type: string }).type === 'Identifier' &&
            (node.property as { name: string }).name === 'length'
          ) {
            path.replaceWith(t.numericLiteral(str.length));
            changed = true;
            return;
          }
          if (node.computed && (node.property as { type: string }).type === 'NumericLiteral') {
            const idx = (node.property as { value: number }).value;
            if (idx >= 0 && idx < str.length) {
              path.replaceWith(t.stringLiteral(str.charAt(idx)));
              changed = true;
            }
          }
        }
      },

      ConditionalExpression(path: Path) {
        const node = Node(path.node);
        const test = evalNode(node.test);
        if (!test.ok) return;
        path.replaceWith(test.value ? node.consequent : node.alternate);
        changed = true;
      },
    });
    } catch {
      // Babel scope rebuilds during folding can throw on edge cases (e.g.
      // duplicate var declarations in unreachable branches). Bail out and
      // emit whatever we've folded so far.
      break;
    }
  }

  const out = generate(ast, { compact: false, jsescOption: { quotes: 'single' } });
  return out.code;
}
