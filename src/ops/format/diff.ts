import type { OpDefinition } from '../types';
import { toText } from '../util';

/**
 * Compare the input against a reference string and produce a side-by-side
 * line diff. Lines that differ are marked. Useful for "what changed after
 * this transform?".
 */
export const lineDiff: OpDefinition = {
  id: 'line-diff',
  name: 'Line Diff vs Reference',
  description:
    'Compare the current buffer line-by-line against a reference string and print a side-by-side diff.',
  category: 'Format',
  args: [
    {
      name: 'reference',
      label: 'Reference text',
      kind: { type: 'string', default: '', multiline: true, placeholder: 'paste reference here' },
    },
  ],
  run: (input, args) => {
    const cur = toText(input).split('\n');
    const ref = String(args.reference ?? '').split('\n');
    const max = Math.max(cur.length, ref.length);
    const lines: string[] = [];
    let added = 0;
    let removed = 0;
    let modified = 0;
    for (let i = 0; i < max; i++) {
      const a = ref[i] ?? '';
      const b = cur[i] ?? '';
      if (a === b) {
        lines.push(`  ${i + 1}: ${a}`);
        continue;
      }
      if (i >= ref.length) {
        lines.push(`+ ${i + 1}: ${b}`);
        added++;
      } else if (i >= cur.length) {
        lines.push(`- ${i + 1}: ${a}`);
        removed++;
      } else {
        lines.push(`- ${i + 1}: ${a}`);
        lines.push(`+ ${i + 1}: ${b}`);
        modified++;
      }
    }
    return [
      `# +${added} -${removed} ~${modified}`,
      ...lines,
    ].join('\n');
  },
};
