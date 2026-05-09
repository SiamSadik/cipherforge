import type { OpDefinition } from '../types';
import { toText } from '../util';

export const railFenceEncrypt: OpDefinition = {
  id: 'railfence-encrypt',
  name: 'Rail Fence Encrypt',
  description: 'Zig-zag transposition cipher. Read the rails top to bottom.',
  category: 'Cipher',
  args: [{ name: 'rails', label: 'Rails', kind: { type: 'number', default: 3, min: 2, max: 50 } }],
  run: (input, args) => {
    const text = toText(input);
    const rails = Math.max(2, Number(args.rails ?? 3) | 0);
    const fence: string[][] = Array.from({ length: rails }, () => []);
    let row = 0;
    let dir = 1;
    for (const ch of text) {
      fence[row].push(ch);
      row += dir;
      if (row === rails - 1 || row === 0) dir *= -1;
    }
    return fence.flat().join('');
  },
};

export const railFenceDecrypt: OpDefinition = {
  id: 'railfence-decrypt',
  name: 'Rail Fence Decrypt',
  description: 'Reverse a rail-fence transposition cipher.',
  category: 'Cipher',
  args: [{ name: 'rails', label: 'Rails', kind: { type: 'number', default: 3, min: 2, max: 50 } }],
  run: (input, args) => {
    const text = toText(input);
    const rails = Math.max(2, Number(args.rails ?? 3) | 0);
    const pattern: number[] = [];
    let row = 0;
    let dir = 1;
    for (let i = 0; i < text.length; i++) {
      pattern.push(row);
      row += dir;
      if (row === rails - 1 || row === 0) dir *= -1;
    }
    const indexes: number[][] = Array.from({ length: rails }, () => []);
    pattern.forEach((r, i) => indexes[r].push(i));
    const flat = indexes.flat();
    const out: string[] = new Array(text.length);
    for (let i = 0; i < text.length; i++) out[flat[i]] = text[i];
    return out.join('');
  },
};
