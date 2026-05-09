import { Sparkles, X } from 'lucide-react';
import type { MagicCandidate } from '../ops/magic';

interface Props {
  candidates: MagicCandidate[];
  onPick(opId: string): void;
  onClose(): void;
}

export function MagicPanel({ candidates, onPick, onClose }: Props) {
  return (
    <div className="rounded-lg border border-accent-500/40 bg-accent-500/5 p-3">
      <div className="mb-2 flex items-center gap-2 text-xs uppercase tracking-wider text-accent-400">
        <Sparkles size={14} />
        Magic suggestions
        <button
          onClick={onClose}
          className="ml-auto rounded p-1 text-ink-500 hover:bg-ink-800 hover:text-ink-200"
        >
          <X size={12} />
        </button>
      </div>
      {candidates.length === 0 ? (
        <div className="text-xs text-ink-400">
          Couldn't auto-detect anything. The input may already be plain text or use an encoding without
          a strong fingerprint.
        </div>
      ) : (
        <div className="space-y-1.5">
          {candidates.map((c) => (
            <button
              key={c.op.id}
              onClick={() => onPick(c.op.id)}
              className="flex w-full items-start gap-2 rounded border border-ink-800 bg-ink-900/60 px-2 py-1.5 text-left text-xs hover:border-accent-500/50 hover:bg-ink-900"
            >
              <span className="rounded bg-accent-500/20 px-1.5 py-0.5 text-[10px] text-accent-300">
                {(c.confidence * 100).toFixed(0)}%
              </span>
              <div className="flex-1 overflow-hidden">
                <div className="font-medium text-ink-100">{c.op.name}</div>
                {c.preview && (
                  <div className="mt-0.5 truncate text-[11px] text-ink-500">"{c.preview}"</div>
                )}
              </div>
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
