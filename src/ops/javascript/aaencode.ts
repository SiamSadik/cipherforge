import type { OpDefinition } from '../types';
import { toText } from '../util';

/**
 * AAencode decoder.
 *
 * AAencode (by Yosuke HASEGAWA) encodes JS using the kaomoji alphabet
 * `ﾟωﾟノ= /｀ｍ´）ノ ~┻━┻ /'╮(╯_╰)╭ /…`. The structure is always:
 *
 *   ﾟωﾟﾉ= /…/┻━┻( c^_^o ) (ﾟДﾟ)[ﾟεﾟ]+ "<encoded payload>" (ﾟДﾟ)[ﾟoﾟ]
 *
 * After the leading aliases (which are the same in every encoding), the
 * actual payload is built by concatenating `(ﾟДﾟ)[ﾟεﾟ]+` followed by
 * digit-substitutions like `(ﾟｰﾟ)` (=4), `(c^_^o)` (=0), etc., then octal
 * escape sequences. The octal/quoted form of these maps to character codes.
 *
 * We don't try to fully simulate the obfuscator — instead we detect the
 * standard suffix `(ﾟДﾟ)[ﾟoﾟ]` and pull the canonical payload pattern
 * `\\<digits>` between the markers, decoding octal escapes back to chars.
 */
export const aaencodeDecode: OpDefinition = {
  id: 'aaencode-decode',
  name: 'Decode AAencode',
  description:
    'Decode AAencode (kaomoji-based JS obfuscator). Extracts the inner octal-escaped payload and converts it back to JS source.',
  category: 'JavaScript',
  run: (input) => {
    const code = toText(input);
    if (!looksLikeAAencode(code)) {
      throw new Error('Input does not look like AAencode output');
    }
    // The encoded string lives between the first `(ﾟДﾟ)[ﾟεﾟ]+` and the closing
    // `(ﾟДﾟ)[ﾟoﾟ]` accessor at the very end.
    const re = /\(ﾟДﾟ\)\s*\[\s*ﾟεﾟ\s*\]\s*\+\s*([\s\S]+?)\(ﾟДﾟ\)\s*\[\s*ﾟoﾟ\s*\]/;
    const m = code.match(re);
    if (!m) {
      throw new Error('AAencode payload not found between markers');
    }
    return decodeAAencodePayload(m[1]);
  },
  detect: (bytes) => {
    const slice = new TextDecoder().decode(bytes.slice(0, 4096));
    return /ﾟωﾟﾉ\s*=/.test(slice) || /\(ﾟДﾟ\)\s*\[\s*ﾟεﾟ\s*\]/.test(slice) ? 0.95 : 0;
  },
};

function looksLikeAAencode(code: string): boolean {
  return /ﾟωﾟ/.test(code) && /\(ﾟДﾟ\)/.test(code);
}

function decodeAAencodePayload(blob: string): string {
  // The blob is a concatenation like:
  //   (ﾟｰﾟ)+ (ﾟΘﾟ)+ '\\\\'+ ...  '\\145'+ '\\154'+ '\\145'+ ...
  // The actual character data lives in the quoted strings of the form
  // '\\NNN' (where NNN is octal). We pull every such string and convert.
  const out: string[] = [];
  // Match either '\\NNN' style octal or plain 'X' single chars.
  const tokenRe = /'\\\\(\d{1,3})'|"\\\\(\d{1,3})"|'(\\\d{1,3})'|"(\\\d{1,3})"/g;
  let m: RegExpExecArray | null;
  while ((m = tokenRe.exec(blob))) {
    const oct = m[1] ?? m[2] ?? (m[3]?.replace(/^\\/, '')) ?? (m[4]?.replace(/^\\/, ''));
    if (oct) out.push(String.fromCharCode(parseInt(oct, 8)));
  }
  if (out.length === 0) {
    // Fallback: maybe the payload uses (ﾟДﾟ)['_']( payload )(ﾟΘﾟ) style with a
    // plain string inside. Extract the longest single-quoted ASCII run.
    const fallback = blob.match(/"([^"\\]{4,})"|'([^'\\]{4,})'/);
    if (fallback) return fallback[1] ?? fallback[2] ?? '';
    throw new Error('No octal-escape characters found inside AAencode payload');
  }
  return out.join('');
}
