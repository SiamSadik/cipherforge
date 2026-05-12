import { Sparkles, Wand2, X } from 'lucide-react';
import type { MagicCandidate, MagicChainStep } from '../ops/magic';

interface Props {
  candidates: MagicCandidate[];
  chain?: MagicChainStep[] | null;
  onPick(opId: string): void;
  onApplyChain?(chain: MagicChainStep[]): void;
  onClose(): void;
  onRunChain?(): void;
  busy?: boolean;
}

export function MagicPanel({ candidates, chain, onPick, onApplyChain, onClose, onRunChain, busy }: Props) {
  return (
    <div className="rounded-lg border border-accent-500/40 bg-accent-500/5 p-3">
      <div className="mb-2 flex items-center gap-2 text-xs uppercase tracking-wider text-accent-400">
        <Sparkles size={14} />
        Magic suggestions
        {onRunChain && (
          <button
            onClick={onRunChain}
            disabled={busy}
            className="ml-auto flex items-center gap-1 rounded border border-accent-500/40 bg-accent-500/10 px-2 py-0.5 text-[10px] uppercase tracking-wider text-accent-200 hover:bg-accent-500/20 disabled:opacity-50"
            title="Try to auto-decode through multiple layers"
          >
            <Wand2 size={11} />
            Auto-chain
          </button>
        )}
        <button
          onClick={onClose}
          className={`${onRunChain ? '' : 'ml-auto '}rounded p-1 text-ink-500 hover:bg-ink-800 hover:text-ink-200`}
        >
          <X size={12} />
        </button>
      </div>
      {candidates.length === 0 ? (
        <div className="text-xs text-ink-400">
          Nothing fingerprinted in the current input. Try pasting something encoded
          (Base64, Hex, JWT, gzipped Base64, …).
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
      {chain && chain.length > 0 && (
        <div className="mt-3 border-t border-accent-500/20 pt-2">
          <div className="mb-1 flex items-center gap-2 text-[10px] uppercase tracking-wider text-accent-300">
            <Wand2 size={11} />
            Auto-chain ({chain.length} step{chain.length === 1 ? '' : 's'})
            {onApplyChain && (
              <button
                onClick={() => onApplyChain(chain)}
                className="ml-auto rounded bg-accent-500/30 px-2 py-0.5 text-[10px] text-accent-100 hover:bg-accent-500/50"
              >
                Apply to recipe
              </button>
            )}
          </div>
          <ol className="space-y-1 text-[11px] text-ink-400">
            {chain.map((s, idx) => (
              <li key={idx}>
                <span className="mr-2 text-accent-400">{idx + 1}.</span>
                <span className="font-medium text-ink-200">{s.opName}</span>
                <span className="ml-1 text-ink-600">→ "{s.preview}"</span>
              </li>
            ))}
          </ol>
        </div>
      )}
    </div>
  );
}
