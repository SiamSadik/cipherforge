import * as JsBeautify from 'js-beautify';
import { webcrack } from 'webcrack';
import type { OpDefinition } from '../types';
import { toText } from '../util';

// js-beautify exposes a `js` function differently depending on bundler vs Node ESM.
// Try the named export first, then the default export, then the namespace itself.
type BeautifyFn = (code: string, opts: object) => string;
const namespace = JsBeautify as unknown as Record<string, unknown>;
const beautifyJs: BeautifyFn =
  typeof namespace.js === 'function'
    ? (namespace.js as BeautifyFn)
    : typeof namespace.default === 'function'
      ? (namespace.default as BeautifyFn)
      : typeof (namespace.default as Record<string, unknown> | undefined)?.js === 'function'
        ? ((namespace.default as Record<string, unknown>).js as BeautifyFn)
        : (() => {
            throw new Error('js-beautify does not expose a JS pretty-printer');
          })();

export const beautify: OpDefinition = {
  id: 'js-beautify',
  name: 'JavaScript Beautify',
  description: 'Pretty-print minified JavaScript using js-beautify.',
  category: 'JavaScript',
  args: [
    { name: 'indent', label: 'Indent (spaces)', kind: { type: 'number', default: 2, min: 1, max: 8 } },
  ],
  run: (input, args) =>
    beautifyJs(toText(input), {
      indent_size: Number(args.indent ?? 2),
      space_in_empty_paren: false,
      preserve_newlines: true,
      max_preserve_newlines: 2,
      end_with_newline: true,
      brace_style: 'preserve-inline',
      e4x: false,
      keep_array_indentation: false,
      jslint_happy: false,
    }),
};

export const webcrackDeobfuscate: OpDefinition = {
  id: 'webcrack',
  name: 'Webcrack (Deobfuscate JS)',
  description:
    'Run webcrack to deobfuscate obfuscator.io output, unminify and reverse simple bundlers. May take a few seconds on large inputs.',
  category: 'JavaScript',
  args: [
    {
      name: 'jsx',
      label: 'Detect JSX',
      kind: { type: 'boolean', default: true },
    },
    {
      name: 'unminify',
      label: 'Unminify',
      kind: { type: 'boolean', default: true },
    },
    {
      name: 'deobfuscate',
      label: 'Deobfuscate',
      kind: { type: 'boolean', default: true },
    },
    {
      name: 'unpack',
      label: 'Unpack bundles',
      kind: { type: 'boolean', default: false },
    },
  ],
  run: async (input, args) => {
    const code = toText(input);
    const result = await webcrack(code, {
      jsx: Boolean(args.jsx ?? true),
      unminify: Boolean(args.unminify ?? true),
      deobfuscate: Boolean(args.deobfuscate ?? true),
      unpack: Boolean(args.unpack ?? false),
      mangle: false,
    });
    return result.code;
  },
};

export const evalUnpack: OpDefinition = {
  id: 'eval-unpack',
  name: 'Unpack eval(...) wrapper',
  description:
    'Strip a single `eval(...)` wrapper from the input. Common in P.A.C.K.E.R.-style obfuscation. Does not actually execute code — pulls the literal string passed to eval.',
  category: 'JavaScript',
  run: (input) => {
    const text = toText(input).trim();
    // Try to extract the literal string passed to eval/Function.
    const evalMatch = text.match(/^\s*(?:eval|Function)\s*\(\s*([\s\S]+?)\s*\)\s*;?\s*$/);
    if (!evalMatch) {
      throw new Error('Input does not look like a single eval/Function wrapper');
    }
    const inner = evalMatch[1].trim();
    const stringLiteral = inner.match(/^(['"`])([\s\S]*)\1$/);
    if (stringLiteral) {
      // JSON-style unescape for double-quoted strings.
      try {
        return JSON.parse(`"${stringLiteral[2].replace(/"/g, '\\"').replace(/\\'/g, "'")}"`);
      } catch {
        return stringLiteral[2];
      }
    }
    return inner;
  },
};

export const escapeStringsToText: OpDefinition = {
  id: 'js-string-literal-decode',
  name: 'Decode JS String Literal',
  description:
    'Convert a JavaScript string literal (with \\n, \\xHH, \\uHHHH, etc.) into its actual string value.',
  category: 'JavaScript',
  run: (input) => {
    const raw = toText(input).trim();
    const lit = raw.match(/^(['"`])([\s\S]*)\1$/);
    const body = lit ? lit[2] : raw;
    return body
      .replace(/\\u\{([0-9a-fA-F]+)\}/g, (_, h) => String.fromCodePoint(parseInt(h, 16)))
      .replace(/\\u([0-9a-fA-F]{4})/g, (_, h) => String.fromCharCode(parseInt(h, 16)))
      .replace(/\\x([0-9a-fA-F]{2})/g, (_, h) => String.fromCharCode(parseInt(h, 16)))
      .replace(/\\([nrtbfv0\\'"`])/g, (_, c) => {
        const map: Record<string, string> = {
          n: '\n',
          r: '\r',
          t: '\t',
          b: '\b',
          f: '\f',
          v: '\v',
          '0': '\0',
          '\\': '\\',
          "'": "'",
          '"': '"',
          '`': '`',
        };
        return map[c] ?? c;
      });
  },
};
