import clsx from 'clsx';
import { ChevronDown, ChevronUp, GripVertical, Power, X } from 'lucide-react';
import { useState } from 'react';
import type { ArgValue, OpDefinition, RecipeStep, StepResult } from '../ops/types';

interface Props {
  step: RecipeStep;
  op: OpDefinition;
  index: number;
  total: number;
  result?: StepResult;
  onChangeArg(name: string, value: ArgValue): void;
  onToggleEnabled(): void;
  onMove(delta: number): void;
  onRemove(): void;
  onDragStart(): void;
  onDragOver(e: React.DragEvent): void;
  onDrop(): void;
  isDragging: boolean;
}

export function RecipeStepCard(props: Props) {
  const { step, op, result, onChangeArg, onToggleEnabled, onMove, onRemove, index, total } = props;
  const [open, setOpen] = useState(true);
  const errored = Boolean(result?.error);

  return (
    <div
      draggable
      onDragStart={props.onDragStart}
      onDragOver={props.onDragOver}
      onDrop={props.onDrop}
      className={clsx(
        'group rounded-lg border bg-ink-900/70 transition-shadow',
        errored
          ? 'border-red-500/50 shadow-[0_0_0_1px_rgba(239,68,68,0.25)]'
          : 'border-ink-800 hover:border-ink-700',
        !step.enabled && 'opacity-50',
        props.isDragging && 'ring-1 ring-accent-500',
      )}
    >
      <div className="flex items-center gap-2 px-3 py-2">
        <button
          className="cursor-grab text-ink-500 hover:text-ink-200"
          aria-label="Drag to reorder"
          onMouseDown={(e) => e.stopPropagation()}
        >
          <GripVertical size={16} />
        </button>
        <span className="rounded bg-ink-800 px-1.5 py-0.5 text-[10px] text-ink-400">
          {(index + 1).toString().padStart(2, '0')}
        </span>
        <span className={clsx('text-sm font-medium', errored ? 'text-red-300' : 'text-ink-100')}>
          {op.name}
        </span>
        <span className="rounded bg-ink-800 px-1.5 py-0.5 text-[10px] text-ink-500">
          {op.category}
        </span>
        {result && !errored && (
          <span className="ml-auto text-[10px] text-ink-500">
            {result.durationMs.toFixed(1)}ms · {result.output.length}B
          </span>
        )}
        <div className="ml-auto flex items-center gap-1 text-ink-500">
          <button
            disabled={index === 0}
            onClick={() => onMove(-1)}
            className="rounded p-1 hover:bg-ink-800 hover:text-ink-100 disabled:opacity-30"
            aria-label="Move up"
          >
            <ChevronUp size={14} />
          </button>
          <button
            disabled={index === total - 1}
            onClick={() => onMove(1)}
            className="rounded p-1 hover:bg-ink-800 hover:text-ink-100 disabled:opacity-30"
            aria-label="Move down"
          >
            <ChevronDown size={14} />
          </button>
          <button
            onClick={onToggleEnabled}
            className={clsx(
              'rounded p-1 hover:bg-ink-800',
              step.enabled ? 'text-accent-500' : 'text-ink-500',
            )}
            aria-label={step.enabled ? 'Disable step' : 'Enable step'}
          >
            <Power size={14} />
          </button>
          <button
            onClick={onRemove}
            className="rounded p-1 hover:bg-red-500/20 hover:text-red-300"
            aria-label="Remove step"
          >
            <X size={14} />
          </button>
        </div>
      </div>
      {op.args && op.args.length > 0 && (
        <button
          onClick={() => setOpen((v) => !v)}
          className="flex w-full items-center justify-between border-t border-ink-800 px-3 py-1 text-[10px] uppercase tracking-wider text-ink-500 hover:text-ink-200"
        >
          <span>{open ? 'Hide arguments' : `${op.args.length} argument${op.args.length === 1 ? '' : 's'}`}</span>
          <span>{open ? '−' : '+'}</span>
        </button>
      )}
      {open && op.args && op.args.length > 0 && (
        <div className="space-y-2 border-t border-ink-800 bg-ink-950/40 px-3 py-2">
          {op.args.map((arg) => (
            <ArgInput
              key={arg.name}
              spec={arg}
              value={step.args[arg.name] ?? defaultValue(arg)}
              onChange={(v) => onChangeArg(arg.name, v)}
            />
          ))}
        </div>
      )}
      {op.description && (
        <div className="border-t border-ink-800 px-3 py-1.5 text-[11px] text-ink-500">
          {op.description}
        </div>
      )}
      {errored && (
        <div className="border-t border-red-500/30 bg-red-500/10 px-3 py-1.5 text-xs text-red-200">
          {result?.error}
        </div>
      )}
    </div>
  );
}

function defaultValue(arg: OpDefinition['args'] extends (infer A)[] | undefined ? A : never): ArgValue {
  if (arg.kind.type === 'string') return arg.kind.default ?? '';
  if (arg.kind.type === 'number') return arg.kind.default ?? 0;
  if (arg.kind.type === 'boolean') return arg.kind.default ?? false;
  return arg.kind.default ?? arg.kind.options[0]?.value ?? '';
}

interface ArgInputProps {
  spec: NonNullable<OpDefinition['args']>[number];
  value: ArgValue;
  onChange(value: ArgValue): void;
}

function ArgInput({ spec, value, onChange }: ArgInputProps) {
  return (
    <div className="grid grid-cols-[7rem_1fr] items-center gap-2">
      <label className="text-[11px] text-ink-400">{spec.label}</label>
      {spec.kind.type === 'string' && (
        <input
          type="text"
          spellCheck={false}
          placeholder={spec.kind.placeholder ?? ''}
          value={String(value)}
          onChange={(e) => onChange(e.target.value)}
          className="rounded border border-ink-700 bg-ink-900 px-2 py-1 font-mono text-xs text-ink-100 outline-none focus:border-accent-500"
        />
      )}
      {spec.kind.type === 'number' && (
        <input
          type="number"
          min={spec.kind.min}
          max={spec.kind.max}
          step={spec.kind.step ?? 1}
          value={Number(value)}
          onChange={(e) => onChange(Number(e.target.value))}
          className="rounded border border-ink-700 bg-ink-900 px-2 py-1 font-mono text-xs text-ink-100 outline-none focus:border-accent-500"
        />
      )}
      {spec.kind.type === 'boolean' && (
        <label className="flex items-center gap-2 text-xs text-ink-200">
          <input
            type="checkbox"
            checked={Boolean(value)}
            onChange={(e) => onChange(e.target.checked)}
            className="h-3.5 w-3.5 accent-accent-500"
          />
        </label>
      )}
      {spec.kind.type === 'select' && (
        <select
          value={String(value)}
          onChange={(e) => onChange(e.target.value)}
          className="rounded border border-ink-700 bg-ink-900 px-2 py-1 text-xs text-ink-100 outline-none focus:border-accent-500"
        >
          {spec.kind.options.map((o) => (
            <option key={o.value} value={o.value}>
              {o.label}
            </option>
          ))}
        </select>
      )}
    </div>
  );
}
