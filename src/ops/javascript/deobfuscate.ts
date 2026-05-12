import * as JsBeautify from 'js-beautify';
import type { OpDefinition } from '../types';
import { toText } from '../util';

// webcrack pulls in Babel + node-builtin shims that are heavy and can crash
// during initial module evaluation in some browsers. Lazy-load it only when
// the user actually runs the op so the rest of the app stays snappy.
type WebcrackResult = { code: string };
type WebcrackFn = (
  code: string,
  options: { jsx: boolean; unminify: boolean; deobfuscate: boolean; unpack: boolean; mangle: boolean },
) => Promise<WebcrackResult>;

let webcrackPromise: Promise<WebcrackFn> | null = null;
async function loadWebcrack(): Promise<WebcrackFn> {
  if (!webcrackPromise) {
    webcrackPromise = import('webcrack').then((mod) => mod.webcrack as unknown as WebcrackFn);
  }
  return webcrackPromise;
}

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
    const webcrack = await loadWebcrack();
    // On very large or pathological obfuscator.io inputs webcrack can throw
    // mid-transform with Babel scope errors like:
    //   - "Duplicate declaration 'W'"
    //   - "Couldn't find a Program"
    //   - "Unexpected node ..."
    // These are bugs/limitations in webcrack 2.16's renamer — the surrounding
    // pipeline is still valuable, so we silence them and return the input
    // unchanged. Callers (Universal Decode, --pipe) can then fall through to
    // other deobfuscators (ben-sb, synchrony) on the original input.
    try {
      const result = await webcrack(code, {
        jsx: Boolean(args.jsx ?? true),
        unminify: Boolean(args.unminify ?? true),
        deobfuscate: Boolean(args.deobfuscate ?? true),
        unpack: Boolean(args.unpack ?? false),
        mangle: false,
      });
      return result.code;
    } catch (err) {
      const msg = (err as Error).message ?? String(err);
      if (
        msg.includes('Duplicate declaration') ||
        msg.includes("Couldn't find a Program") ||
        msg.includes('Unexpected node') ||
        msg.includes('Maximum call stack') ||
        msg.includes('out of memory')
      ) {
        return code;
      }
      throw new Error(`webcrack failed: ${msg}`, { cause: err });
    }
  },
  detect: (input) => {
    // Detect the obfuscator.io / javascript-obfuscator output signature.
    // We sample BOTH the head and the tail because:
    //   - the decoder shims & call sites (`_0x[0-9a-f]+(...)`) can sit at the
    //     start (shim-first layout) or at the end (string-array-first layout).
    //   - the string array can be a single long array literal at the head OR
    //     wrapped in a function returning it.
    // 32 KB from each end is enough to fingerprint a 3 MB bundle.
    if (input.length < 200) return 0;
    const head = new TextDecoder().decode(input.slice(0, 32_768));
    const tail =
      input.length > 32_768
        ? new TextDecoder().decode(input.slice(Math.max(0, input.length - 32_768)))
        : '';
    const sample = head + '\n' + tail;
    const hexIds = (sample.match(/_0x[0-9a-f]{4,}/g) ?? []).length;
    const hexCalls = (sample.match(/_0x[0-9a-f]{4,}\s*\(/g) ?? []).length;
    const hasShuffle = /\.push\s*\(\s*[a-zA-Z_$]+\s*\.shift\s*\(\s*\)\s*\)/.test(sample);
    const hasStringArray = /function\s+_0x[0-9a-f]+\s*\(\s*\)\s*\{[^}]{0,400}\[(?:"[^"]{2,12}"|'[^']{2,12}')\s*,/.test(
      sample,
    );
    // A typical obfuscator.io output has both the string-array literal *and*
    // the rotation loop. Strong combo signal:
    if (hexIds >= 30 && (hasShuffle || hasStringArray)) return 0.9;
    // Many call-sites (the body is full of decoder-shim invocations) is also
    // a clear signal even if the head sample didn't show the array literal.
    if (hexCalls >= 20) return 0.8;
    if (hexIds >= 10) return 0.55;
    if (hexIds >= 3 && hasShuffle) return 0.5;
    return 0;
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
    if (!lit) {
      // The input is NOT a single string literal — it's likely JS source code.
      // Doing a global regex unescape over JS source corrupts strings that
      // contain `\"` etc. (it removes the backslash and breaks the syntax).
      // Throw so chained pipelines like Universal Decode skip this op.
      throw new Error(
        'Decode JS String Literal expects a single string literal as input ' +
          '(e.g. "\\u0048\\u0069"). For JS source code use Webcrack or JS Beautify.',
      );
    }
    const body = lit[2];
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
