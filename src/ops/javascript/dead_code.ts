import type { OpDefinition } from '../types';
import { toText } from '../util';

/**
 * Dead-code elimination — purely cosmetic.
 *
 * Removes statements that are statically unreachable per the JS spec:
 *   • Anything in a block after `return`, `throw`, `break`, or `continue`.
 *   • The body of `if (false) { ... }` (and the `then` branch of `if (true) { ... } else { dead }`).
 *
 * Does NOT remove side-effecting statements that are reachable but unused —
 * that would risk changing program behavior. Only deletes code that no JS
 * engine on Earth executes by spec.
 *
 * Why this is safe:
 *   - The JS spec defines control flow: a `return` exits the enclosing
 *     function, so any subsequent statement in the same block is unreachable.
 *   - V8/SpiderMonkey/JavaScriptCore never execute these statements.
 *   - Lint rules (ESLint `no-unreachable`) flag them as guaranteed dead.
 *
 * Common source: deobfuscators correctly disarm always-true / always-false
 * conditionals from obfuscator.io's "self-defending" mode but leave the
 * skeleton in place. This pass deletes that skeleton.
 */
type ParseFn = (code: string, opts: object) => unknown;
type TraverseFn = (node: unknown, visitor: object) => void;
type GeneratorFn = (node: unknown, opts: object) => { code: string };

let babelLoader: Promise<{
  parse: ParseFn;
  traverse: TraverseFn;
  generate: GeneratorFn;
}> | null = null;

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

export const deadCodeElim: OpDefinition = {
  id: 'js-dead-code-elim',
  name: 'JS Dead-Code Elimination',
  description:
    "Remove statements that are statically unreachable: anything after return/throw/break/continue, and bodies of if(false) / else of if(true). Cosmetic only — never changes program behavior.",
  category: 'JavaScript',
  run: async (input) => {
    const code = toText(input);
    try {
      return await runDeadCodePass(code);
    } catch (err) {
      throw new Error(`Dead-code elimination failed: ${(err as Error).message}`, {
        cause: err,
      });
    }
  },
};

async function runDeadCodePass(code: string): Promise<string> {
  const { parse, traverse, generate } = await loadBabel();
  const ast = parse(code, {
    sourceType: 'unambiguous',
    allowReturnOutsideFunction: true,
    allowAwaitOutsideFunction: true,
    plugins: ['jsx'],
    errorRecovery: true,
  });

  type Path = {
    node: unknown;
    parent: unknown;
    parentPath: Path | null;
    remove: () => void;
    replaceWith: (n: unknown) => void;
    skip: () => void;
  };

  // Loop until stable — removing dead code can expose new dead code.
  let changed = true;
  let safety = 0;
  while (changed && safety++ < 16) {
    changed = false;

    try {
      traverse(ast, {
        // After return/throw/break/continue, drop following statements.
        BlockStatement(path: Path) {
          const body = (path.node as { body: unknown[] }).body;
          let cutAt = -1;
          for (let i = 0; i < body.length; i++) {
            const t = (body[i] as { type: string }).type;
            if (
              t === 'ReturnStatement' ||
              t === 'ThrowStatement' ||
              t === 'BreakStatement' ||
              t === 'ContinueStatement'
            ) {
              cutAt = i + 1;
              break;
            }
          }
          if (cutAt > 0 && cutAt < body.length) {
            // Hoist any `var`/function declarations we'd be deleting,
            // since they're hoisted at parse time even when unreachable.
            const hoisted: unknown[] = [];
            for (let j = cutAt; j < body.length; j++) {
              const s = body[j] as Record<string, unknown> & { type: string };
              if (s.type === 'FunctionDeclaration') {
                hoisted.push(s);
              } else if (s.type === 'VariableDeclaration' && s.kind === 'var') {
                // Strip initializers — vars are hoisted as undefined, and
                // since they're unreachable they never get assigned.
                const decls = s.declarations as { id: unknown; init: unknown }[];
                const stripped = {
                  ...s,
                  declarations: decls.map((d) => ({ ...d, init: null })),
                };
                hoisted.push(stripped);
              }
            }
            (path.node as { body: unknown[] }).body = body.slice(0, cutAt).concat(hoisted);
            changed = true;
          }
        },

        // if (false) { dead } / if (true) { live } else { dead }
        IfStatement(path: Path) {
          const node = path.node as {
            test: { type: string; value?: unknown };
            consequent: unknown;
            alternate: unknown;
          };
          if (node.test.type === 'BooleanLiteral') {
            const v = node.test.value;
            if (v === true) {
              path.replaceWith(node.consequent);
              changed = true;
            } else if (v === false) {
              if (node.alternate) {
                path.replaceWith(node.alternate);
              } else {
                (path as Path).remove();
              }
              changed = true;
            }
          }
        },

        // while (false) { ... } / for (...; false; ...) { ... }
        WhileStatement(path: Path) {
          const node = path.node as { test: { type: string; value?: unknown } };
          if (node.test.type === 'BooleanLiteral' && node.test.value === false) {
            (path as Path).remove();
            changed = true;
          }
        },
      });
    } catch {
      // If the AST gets temporarily inconsistent (e.g. removing a node mid-
      // traverse), bail out and ship whatever we've cleaned so far.
      break;
    }
  }

  const out = generate(ast, { compact: false, jsescOption: { quotes: 'single' } });
  return out.code;
}
