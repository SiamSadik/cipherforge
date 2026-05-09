import { Search } from 'lucide-react';
import { useMemo, useState } from 'react';
import type { OpCategory, OpDefinition } from '../ops/types';
import { CATEGORY_ORDER, opsByCategory } from '../ops/registry';
import clsx from 'clsx';

const CATEGORY_COLORS: Record<OpCategory, string> = {
  Encoding: 'text-emerald-300 bg-emerald-500/10 border-emerald-500/30',
  Cipher: 'text-purple-300 bg-purple-500/10 border-purple-500/30',
  Crypto: 'text-rose-300 bg-rose-500/10 border-rose-500/30',
  Hash: 'text-amber-300 bg-amber-500/10 border-amber-500/30',
  JavaScript: 'text-yellow-300 bg-yellow-500/10 border-yellow-500/30',
  Compression: 'text-cyan-300 bg-cyan-500/10 border-cyan-500/30',
  Binary: 'text-sky-300 bg-sky-500/10 border-sky-500/30',
  Format: 'text-ink-300 bg-ink-700/30 border-ink-700',
};

interface Props {
  onAdd(op: OpDefinition): void;
}

export function OperationCatalog({ onAdd }: Props) {
  const [query, setQuery] = useState('');
  const groups = useMemo(() => opsByCategory(), []);

  const visibleGroups = useMemo(() => {
    const lower = query.trim().toLowerCase();
    if (!lower) return CATEGORY_ORDER.map((c) => ({ category: c, ops: groups[c] }));
    return CATEGORY_ORDER.map((c) => ({
      category: c,
      ops: groups[c].filter(
        (o) =>
          o.name.toLowerCase().includes(lower) ||
          o.id.toLowerCase().includes(lower) ||
          o.description.toLowerCase().includes(lower),
      ),
    })).filter((g) => g.ops.length > 0);
  }, [query, groups]);

  return (
    <div className="flex h-full flex-col bg-ink-900/40">
      <div className="border-b border-ink-800 p-3">
        <div className="relative">
          <Search
            size={14}
            className="pointer-events-none absolute left-2 top-1/2 -translate-y-1/2 text-ink-500"
          />
          <input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Search operations..."
            className="w-full rounded border border-ink-800 bg-ink-950 py-1.5 pl-7 pr-2 text-xs text-ink-100 outline-none focus:border-accent-500"
          />
        </div>
      </div>
      <div className="scrollbar-thin flex-1 overflow-y-auto">
        {visibleGroups.map(({ category, ops }) => (
          <div key={category} className="px-2 py-2">
            <div className="mb-1 px-1 text-[10px] font-semibold uppercase tracking-wider text-ink-500">
              {category}
            </div>
            <div className="space-y-1">
              {ops.map((op) => (
                <button
                  key={op.id}
                  onClick={() => onAdd(op)}
                  className="group flex w-full items-center gap-2 rounded border border-transparent px-2 py-1.5 text-left text-xs text-ink-200 transition-colors hover:border-ink-700 hover:bg-ink-800/60"
                  title={op.description}
                >
                  <span
                    className={clsx(
                      'rounded border px-1 py-0.5 text-[9px]',
                      CATEGORY_COLORS[op.category],
                    )}
                  >
                    {op.category[0]}
                  </span>
                  <span className="truncate">{op.name}</span>
                </button>
              ))}
            </div>
          </div>
        ))}
        {visibleGroups.length === 0 && (
          <div className="p-4 text-center text-xs text-ink-500">No operations match "{query}"</div>
        )}
      </div>
    </div>
  );
}
