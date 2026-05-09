import type { OpDefinition } from '../types';
import { isPrintableAscii, shannonEntropy, toText, bytesToHex } from '../util';

export const extractStrings: OpDefinition = {
  id: 'strings',
  name: 'Extract Strings',
  description:
    'Extract printable strings from binary data, like the Unix `strings` utility. Finds both ASCII and UTF-16LE runs.',
  category: 'Binary',
  args: [
    { name: 'min', label: 'Minimum length', kind: { type: 'number', default: 4, min: 2, max: 64 } },
    {
      name: 'utf16',
      label: 'Also scan UTF-16LE',
      kind: { type: 'boolean', default: true },
    },
  ],
  run: (input, args) => {
    const min = Math.max(2, Number(args.min ?? 4) | 0);
    const utf16 = Boolean(args.utf16 ?? true);
    const lines: string[] = [];

    // ASCII runs
    let buf: number[] = [];
    let start = 0;
    const flushAscii = (i: number) => {
      if (buf.length >= min) {
        lines.push(`0x${start.toString(16).padStart(8, '0')}  A  ${String.fromCharCode(...buf)}`);
      }
      buf = [];
      start = i + 1;
    };
    for (let i = 0; i < input.length; i++) {
      const b = input[i];
      if (isPrintableAscii(b) && b !== 0x09 && b !== 0x0a && b !== 0x0d) {
        if (buf.length === 0) start = i;
        buf.push(b);
      } else {
        flushAscii(i);
      }
    }
    flushAscii(input.length);

    // UTF-16LE runs (printable ASCII char followed by 0x00).
    if (utf16) {
      let wbuf: number[] = [];
      let wstart = 0;
      const flushW = (i: number) => {
        if (wbuf.length >= min) {
          lines.push(`0x${wstart.toString(16).padStart(8, '0')}  W  ${String.fromCharCode(...wbuf)}`);
        }
        wbuf = [];
        wstart = i + 2;
      };
      for (let i = 0; i + 1 < input.length; i += 2) {
        const b1 = input[i];
        const b2 = input[i + 1];
        if (b2 === 0 && isPrintableAscii(b1) && b1 !== 0x09 && b1 !== 0x0a && b1 !== 0x0d) {
          if (wbuf.length === 0) wstart = i;
          wbuf.push(b1);
        } else {
          flushW(i);
        }
      }
      flushW(input.length);
    }

    if (lines.length === 0) return '(no strings found at min length ' + min + ')';
    return lines.join('\n');
  },
};

export const fileInspect: OpDefinition = {
  id: 'file-inspect',
  name: 'File Inspect',
  description:
    'Show length, Shannon entropy, magic bytes and an ASCII-tagged hex dump of the start of the input.',
  category: 'Binary',
  args: [
    { name: 'limit', label: 'Hex dump bytes', kind: { type: 'number', default: 256, min: 16, max: 4096 } },
  ],
  run: (input, args) => {
    const limit = Math.max(16, Math.min(4096, Number(args.limit ?? 256) | 0));
    const sigs: { name: string; bytes: number[] }[] = [
      { name: 'PNG', bytes: [0x89, 0x50, 0x4e, 0x47] },
      { name: 'JPEG', bytes: [0xff, 0xd8, 0xff] },
      { name: 'GIF', bytes: [0x47, 0x49, 0x46, 0x38] },
      { name: 'PDF', bytes: [0x25, 0x50, 0x44, 0x46] },
      { name: 'ZIP / JAR / DOCX', bytes: [0x50, 0x4b, 0x03, 0x04] },
      { name: 'GZIP', bytes: [0x1f, 0x8b] },
      { name: 'ELF', bytes: [0x7f, 0x45, 0x4c, 0x46] },
      { name: 'PE / DOS', bytes: [0x4d, 0x5a] },
      { name: 'Mach-O 32', bytes: [0xfe, 0xed, 0xfa, 0xce] },
      { name: 'Mach-O 64', bytes: [0xfe, 0xed, 0xfa, 0xcf] },
      { name: 'Mach-O FAT', bytes: [0xca, 0xfe, 0xba, 0xbe] },
      { name: 'WebAssembly', bytes: [0x00, 0x61, 0x73, 0x6d] },
      { name: 'BZip2', bytes: [0x42, 0x5a, 0x68] },
      { name: '7-Zip', bytes: [0x37, 0x7a, 0xbc, 0xaf] },
      { name: 'RAR', bytes: [0x52, 0x61, 0x72, 0x21] },
    ];
    const matches = sigs
      .filter((s) => s.bytes.every((b, i) => input[i] === b))
      .map((s) => s.name);

    const hexDump: string[] = [];
    for (let i = 0; i < Math.min(limit, input.length); i += 16) {
      const slice = input.slice(i, i + 16);
      const hex = bytesToHex(slice, ' ').padEnd(48, ' ');
      const ascii = Array.from(slice)
        .map((b) => (isPrintableAscii(b) && b !== 0x09 && b !== 0x0a && b !== 0x0d ? String.fromCharCode(b) : '.'))
        .join('');
      hexDump.push(`${i.toString(16).padStart(8, '0')}  ${hex}  |${ascii}|`);
    }

    const lines = [
      `Length:        ${input.length} bytes`,
      `Entropy:       ${shannonEntropy(input).toFixed(3)} / 8.000 bits per byte`,
      `Magic bytes:   ${matches.length ? matches.join(', ') : '(no known signature)'}`,
      `First bytes:   ${bytesToHex(input.slice(0, 16), ' ')}`,
      // eslint-disable-next-line no-control-regex
      `UTF-8 preview: ${toText(input.slice(0, 80)).replace(/[\x00-\x1f]/g, '·')}${
        input.length > 80 ? '...' : ''
      }`,
      '',
      'Hex dump:',
      ...hexDump,
    ];
    return lines.join('\n');
  },
};
