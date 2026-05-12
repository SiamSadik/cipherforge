import type { OpDefinition } from '../types';
import { isPrintableAscii, toBytes } from '../util';

export const hexdump: OpDefinition = {
  id: 'hexdump',
  name: 'Hex Dump (canonical)',
  description:
    'Render the input as a `hexdump -C`-style canonical dump: offset, 16 bytes hex, ASCII gutter.',
  category: 'Format',
  args: [
    { name: 'width', label: 'Bytes per line', kind: { type: 'number', default: 16, min: 4, max: 64 } },
  ],
  run: (input, args) => {
    const bytes = toBytes(input);
    const width = Math.max(4, Math.min(64, Number(args.width ?? 16)));
    const lines: string[] = [];
    for (let off = 0; off < bytes.length; off += width) {
      const slice = bytes.slice(off, off + width);
      const hex: string[] = [];
      let ascii = '';
      for (let i = 0; i < width; i++) {
        if (i < slice.length) {
          hex.push(slice[i].toString(16).padStart(2, '0'));
          ascii += isPrintableAscii(slice[i]) && slice[i] !== 0x09 && slice[i] !== 0x0a && slice[i] !== 0x0d ? String.fromCharCode(slice[i]) : '.';
        } else {
          hex.push('  ');
          ascii += ' ';
        }
        // Insert a gap halfway through for readability.
        if (i === Math.floor(width / 2) - 1) hex.push('');
      }
      lines.push(`${off.toString(16).padStart(8, '0')}  ${hex.join(' ')}  |${ascii}|`);
    }
    if (lines.length === 0) return '';
    lines.push(bytes.length.toString(16).padStart(8, '0'));
    return lines.join('\n');
  },
};
