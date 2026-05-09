# CipherForge

Decoder · Deobfuscator · Decrypter — a CyberChef-style web app **and** matching CLI, all running on a single shared operation library.

> Everything runs **client-side**. Inputs never leave your browser. Bring suspicious blobs, JWTs, obfuscated JS, mystery hex strings, base64 payloads — and chain operations into a "recipe" until they make sense.

## Features

**60+ operations across 8 categories:**

| Category | Operations |
|---|---|
| **Encoding** | Base64 (standard / URL-safe), Base32, Base58, Base85 (Ascii85), Hex (with separators), URL, HTML entities, Unicode escapes (`\u`, `\x`, `\u{}`), Quoted-Printable, Binary, Decimal, Octal, Morse, JWT decode |
| **Cipher** | Caesar (with brute-force), ROT13, ROT47, Atbash, Vigenère (encrypt + decrypt), XOR (UTF-8 / hex / base64 keys, 1-byte brute force), Affine, Rail Fence, A1Z26, Bacon, Polybius square |
| **Crypto** | AES (CBC, ECB, CFB, OFB, CTR; UTF-8 / hex / base64 keys; PKCS#7), DES & Triple-DES, RC4 |
| **Hash** | MD5, SHA-1, SHA-224, SHA-256, SHA-384, SHA-512, SHA-3 (224/256/384/512), RIPEMD-160, CRC-32, HMAC, "Hash All" fingerprint, Hash format identifier |
| **JavaScript** | [`webcrack`](https://github.com/j4k0xb/webcrack) deobfuscator, JS-Beautify, eval/Function unwrapper, JS string-literal decoder |
| **Compression** | Gzip / gunzip, Deflate / Inflate, Zlib compress / inflate |
| **Binary** | FLOSS-style string extraction (ASCII + UTF-16LE with min-length and entropy filters), file fingerprint (magic bytes, entropy, hex dump) |
| **Format** | Pretty-print JSON, minify JSON, strip whitespace, upper-case, lower-case, reverse text |

**UI features:**

- Drag-and-drop chainable recipe with per-step enable / disable / reorder.
- Live preview — re-runs the entire pipeline on every input or argument change.
- Magic auto-detect: scores all decoder operations against your input and suggests the best next step (entropy + format heuristics + per-op `detect()`).
- File upload + automatic binary mode with hex dump.
- Copy / download output. Recipes and inputs persist across reloads in `localStorage`.

**CLI features:**

- Run any single operation: `cipherforge <op> [--arg=value]`
- Chain operations: `cipherforge --pipe "from-base64; gunzip; js-beautify"`
- `cipherforge magic` to suggest the next op
- `cipherforge --list` to enumerate all operations
- Reads stdin or `--input file.bin`; writes to stdout (`--binary` for raw bytes)

## Quickstart

### Web

```bash
git clone https://github.com/SiamSadik/cipherforge.git
cd cipherforge
npm install
npm run dev          # http://localhost:5173
npm test             # 39 round-trip tests across all categories
npm run build        # production bundle in dist/
```

### CLI

```bash
# Single op
echo SGVsbG8sIENpcGhlckZvcmdlIQ== | npx tsx cli/cipherforge.ts from-base64

# Chained pipeline
echo "Wm9pIQ==" | npx tsx cli/cipherforge.ts --pipe "from-base64; reverse"

# Magic auto-detect
cat unknown.bin | npx tsx cli/cipherforge.ts magic

# List every operation
npx tsx cli/cipherforge.ts --list
```

## Why a "recipe"?

Almost every real-world decoding problem is a **chain** of small invertible steps. A captured token might be base64 → gzip → utf-8 JSON. An obfuscated payload might be hex → XOR → minified JS → webcrack. CipherForge mirrors CyberChef's recipe model: each step transforms a buffer in, produces a buffer out, and the next step picks up where the last one left off.

## Architecture

- **Operation library** (`src/ops/*`): pure functions over `Uint8Array`. Each op is an `OpDefinition` with id, args, run function, and an optional `detect()` heuristic. Ops are auto-registered via `src/ops/registry.ts`.
- **Pipeline** (`src/ops/pipeline.ts`): runs a recipe step-by-step, capturing per-step output, error, and timing.
- **Magic** (`src/ops/magic.ts`): scores each op's `detect()` against the current input and returns ranked suggestions.
- **UI** (`src/components/*`): React + Tailwind. Operation catalog, recipe editor with drag-drop, dual input/output panes (text + hex), magic panel.
- **CLI** (`cli/cipherforge.ts`): argv parser that builds the same recipe object the UI uses, then calls `runPipeline`. **Zero duplicated logic.**

## Adding a new operation

```ts
// src/ops/encoding/my_codec.ts
import type { OpDefinition } from '../types';

export const myEncode: OpDefinition = {
  id: 'my-encode',
  name: 'My Encode',
  description: 'Convert input into the My-Codec format.',
  category: 'Encoding',
  args: [
    { name: 'lowercase', label: 'Lowercase', kind: { type: 'boolean', default: false } },
  ],
  run: (input, args) => doSomething(input, Boolean(args.lowercase)),
  detect: (input) => /* return a 0..1 score */ 0,
};
```

Then add it to the relevant block of `src/ops/registry.ts` and it's automatically available in the catalog, magic, and CLI.

## Inspirations

- [CyberChef](https://github.com/gchq/CyberChef) — recipe model, magic auto-detect.
- [webcrack](https://github.com/j4k0xb/webcrack) and [synchrony](https://github.com/relative/synchrony) — JavaScript deobfuscation.
- [FLARE FLOSS](https://github.com/mandiant/flare-floss) — string extraction approach.
- [hash-identifier](https://github.com/blackploit/hash-identifier) and [hashID](https://github.com/psypanda/hashID) — hash recognition heuristics.
- [dCode](https://www.dcode.fr) — classical cipher coverage.

## Scope (and non-scope)

CipherForge is a **defensive** analysis tool. It is **not** intended to:

- Crack passwords or hashes (use [Hashcat](https://hashcat.net/hashcat/) or [John the Ripper](https://www.openwall.com/john/) for that).
- Decrypt files locked by ransomware (use the [No More Ransom Project](https://www.nomoreransom.org/)).
- Run untrusted code (the eval-unpack op extracts the **string** passed to eval — it never executes it).

If you need GPU-class crypto-breaking, native binary deobfuscation (Ghidra, IDA), or commercial decompilers, those tools remain the right choice. CipherForge focuses on the long tail of "I have a blob of data and I just want to see what's inside."

## License

MIT
