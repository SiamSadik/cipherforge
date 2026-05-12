import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Download as DownloadIcon, Trash2, Upload as UploadIcon } from 'lucide-react';
import { InputPane, OutputPane } from './components/InputOutputPanes';
import { MagicPanel } from './components/MagicPanel';
import { OperationCatalog } from './components/OperationCatalog';
import { RecipeStepCard } from './components/RecipeStepCard';
import {
  recursiveMagic,
  suggestNextOp,
  type MagicCandidate,
  type MagicChainStep,
} from './ops/magic';
import { runPipeline } from './ops/pipeline';
import { ALL_OPS, getOp } from './ops/registry';
import type { ArgValue, OpDefinition, PipelineResult, RecipeStep } from './ops/types';
import { isPrintableAscii } from './ops/util';

function makeStep(op: OpDefinition): RecipeStep {
  const args: Record<string, ArgValue> = {};
  for (const arg of op.args ?? []) {
    if (arg.kind.type === 'string') args[arg.name] = arg.kind.default ?? '';
    else if (arg.kind.type === 'number') args[arg.name] = arg.kind.default ?? 0;
    else if (arg.kind.type === 'boolean') args[arg.name] = arg.kind.default ?? false;
    else args[arg.name] = arg.kind.default ?? arg.kind.options[0]?.value ?? '';
  }
  return {
    uid: `${op.id}-${Math.random().toString(36).slice(2, 9)}`,
    opId: op.id,
    args,
    enabled: true,
  };
}

const STORAGE_KEY = 'cipherforge:state:v1';
const utf8Encoder = new TextEncoder();

interface PersistedState {
  inputText: string;
  recipe: RecipeStep[];
}

function loadState(): PersistedState | null {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as PersistedState;
    if (
      typeof parsed.inputText === 'string' &&
      Array.isArray(parsed.recipe) &&
      parsed.recipe.every((s) => typeof s.opId === 'string' && getOp(s.opId))
    ) {
      return parsed;
    }
  } catch {
    /* noop */
  }
  return null;
}

function App() {
  const persisted = loadState();
  const [inputText, setInputText] = useState(persisted?.inputText ?? defaultSample());
  const [inputBytes, setInputBytes] = useState<Uint8Array | null>(null);
  const [recipe, setRecipe] = useState<RecipeStep[]>(persisted?.recipe ?? defaultRecipe());
  const [result, setResult] = useState<PipelineResult | null>(null);
  const [magic, setMagic] = useState<MagicCandidate[] | null>(null);
  const [magicChain, setMagicChain] = useState<MagicChainStep[] | null>(null);
  const [magicBusy, setMagicBusy] = useState(false);
  const [draggingIdx, setDraggingIdx] = useState<number | null>(null);
  const importFileRef = useRef<HTMLInputElement>(null);

  const inputBuffer = useMemo(
    () => inputBytes ?? utf8Encoder.encode(inputText),
    [inputBytes, inputText],
  );

  const isInputBinary = useMemo(() => {
    if (!inputBytes) return false;
    let printable = 0;
    const sample = inputBytes.slice(0, 1024);
    for (const b of sample) if (isPrintableAscii(b)) printable++;
    return printable / sample.length < 0.85;
  }, [inputBytes]);

  // Persist state on every change.
  useEffect(() => {
    const state: PersistedState = { inputText: inputBytes ? '' : inputText, recipe };
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
    } catch {
      /* quota or privacy mode; ignore */
    }
  }, [inputText, inputBytes, recipe]);

  // Re-run the pipeline whenever the input or recipe changes.
  useEffect(() => {
    let cancelled = false;
    runPipeline(inputBuffer, recipe).then((r) => {
      if (!cancelled) setResult(r);
    });
    return () => {
      cancelled = true;
    };
  }, [inputBuffer, recipe]);

  const handleAddOp = useCallback((op: OpDefinition) => {
    setRecipe((cur) => [...cur, makeStep(op)]);
  }, []);

  const handleChangeArg = (uid: string, name: string, value: ArgValue) => {
    setRecipe((cur) =>
      cur.map((s) => (s.uid === uid ? { ...s, args: { ...s.args, [name]: value } } : s)),
    );
  };

  const handleToggleEnabled = (uid: string) => {
    setRecipe((cur) => cur.map((s) => (s.uid === uid ? { ...s, enabled: !s.enabled } : s)));
  };

  const handleMove = (uid: string, delta: number) => {
    setRecipe((cur) => {
      const idx = cur.findIndex((s) => s.uid === uid);
      if (idx < 0) return cur;
      const next = idx + delta;
      if (next < 0 || next >= cur.length) return cur;
      const copy = cur.slice();
      [copy[idx], copy[next]] = [copy[next], copy[idx]];
      return copy;
    });
  };

  const handleRemove = (uid: string) => {
    setRecipe((cur) => cur.filter((s) => s.uid !== uid));
  };

  const handleDragStart = (idx: number) => {
    setDraggingIdx(idx);
  };

  const handleDragOver = (e: React.DragEvent) => e.preventDefault();

  const handleDrop = (idx: number) => {
    const src = draggingIdx;
    setDraggingIdx(null);
    if (src == null || src === idx) return;
    setRecipe((cur) => {
      const copy = cur.slice();
      const [item] = copy.splice(src, 1);
      copy.splice(idx, 0, item);
      return copy;
    });
  };

  const handleClearRecipe = () => setRecipe([]);

  const handleClearInput = () => {
    setInputBytes(null);
    setInputText('');
  };

  const handleUploadFile = (bytes: Uint8Array, name: string) => {
    setInputBytes(bytes);
    setInputText(`<file: ${name}, ${bytes.length} bytes>`);
  };

  const handleInputChange = (text: string) => {
    setInputBytes(null);
    setInputText(text);
  };

  // Auto-suggest on input change (debounced).
  useEffect(() => {
    let cancelled = false;
    const t = setTimeout(async () => {
      const cands = await suggestNextOp(inputBuffer);
      if (!cancelled) {
        setMagic(cands);
        setMagicChain(null);
      }
    }, 250);
    return () => {
      cancelled = true;
      clearTimeout(t);
    };
  }, [inputBuffer]);

  const handleMagic = async () => {
    const cands = await suggestNextOp(inputBuffer);
    setMagic(cands);
  };

  const handleRunChain = async () => {
    setMagicBusy(true);
    try {
      const chain = await recursiveMagic(inputBuffer);
      setMagicChain(chain);
    } finally {
      setMagicBusy(false);
    }
  };

  const handleApplyChain = (chain: MagicChainStep[]) => {
    const newSteps: RecipeStep[] = [];
    for (const c of chain) {
      const op = getOp(c.opId);
      if (op) newSteps.push(makeStep(op));
    }
    if (newSteps.length === 0) return;
    setRecipe((cur) => [...cur, ...newSteps]);
    setMagicChain(null);
  };

  const handlePickMagic = (opId: string) => {
    const op = getOp(opId);
    if (op) handleAddOp(op);
  };

  const handleExportRecipe = () => {
    const data = {
      version: 1,
      app: 'cipherforge',
      exportedAt: new Date().toISOString(),
      input: inputBytes ? null : inputText,
      recipe: recipe.map((s) => ({ opId: s.opId, args: s.args, enabled: s.enabled })),
    };
    const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `cipherforge-recipe-${Date.now()}.json`;
    a.click();
    URL.revokeObjectURL(url);
  };

  const handleImportRecipe = async (file: File) => {
    try {
      const text = await file.text();
      const data = JSON.parse(text) as {
        recipe: { opId: string; args: Record<string, ArgValue>; enabled: boolean }[];
        input?: string | null;
      };
      const newRecipe: RecipeStep[] = [];
      for (const s of data.recipe ?? []) {
        const op = getOp(s.opId);
        if (!op) continue;
        const step = makeStep(op);
        step.args = { ...step.args, ...s.args };
        step.enabled = s.enabled !== false;
        newRecipe.push(step);
      }
      setRecipe(newRecipe);
      if (typeof data.input === 'string') {
        setInputBytes(null);
        setInputText(data.input);
      }
    } catch (err) {
      alert(`Failed to import recipe: ${(err as Error).message}`);
    }
  };

  return (
    <div className="grid h-screen grid-rows-[auto_1fr] overflow-hidden">
      <header className="flex items-center gap-3 border-b border-ink-800 bg-ink-950/90 px-4 py-2">
        <div className="flex items-center gap-2">
          <div className="flex h-7 w-7 items-center justify-center rounded bg-accent-500/15">
            <svg viewBox="0 0 24 24" className="h-4 w-4 text-accent-400" fill="none" stroke="currentColor" strokeWidth="2">
              <path d="M3 8l9-5 9 5v8l-9 5-9-5z" />
              <path d="M3 8l9 5 9-5" />
              <path d="M12 13v8" />
            </svg>
          </div>
          <div className="flex flex-col leading-none">
            <span className="text-sm font-semibold text-ink-100">CipherForge</span>
            <span className="text-[10px] uppercase tracking-wider text-ink-500">
              Decoder · Deobfuscator · Decrypter
            </span>
          </div>
        </div>
        <div className="ml-auto flex items-center gap-3 text-[11px] text-ink-500">
          <span className="hidden sm:inline">{ALL_OPS.length} operations</span>
          <span className="hidden sm:inline">·</span>
          <span className="hidden sm:inline">runs locally in your browser</span>
          <button
            onClick={handleExportRecipe}
            disabled={recipe.length === 0}
            className="flex items-center gap-1 rounded border border-ink-800 px-1.5 py-0.5 text-[10px] text-ink-400 hover:border-ink-600 hover:text-ink-100 disabled:opacity-30"
            title="Download the current recipe as JSON"
          >
            <DownloadIcon size={11} /> Export
          </button>
          <button
            onClick={() => importFileRef.current?.click()}
            className="flex items-center gap-1 rounded border border-ink-800 px-1.5 py-0.5 text-[10px] text-ink-400 hover:border-ink-600 hover:text-ink-100"
            title="Load a previously-saved recipe JSON"
          >
            <UploadIcon size={11} /> Import
          </button>
          <input
            ref={importFileRef}
            type="file"
            accept="application/json,.json"
            className="hidden"
            onChange={(e) => {
              const f = e.target.files?.[0];
              if (f) handleImportRecipe(f);
              e.target.value = '';
            }}
          />
          <a
            href="https://github.com/SiamSadik/cipherforge"
            target="_blank"
            rel="noreferrer"
            className="rounded border border-ink-800 px-1.5 py-0.5 text-[10px] text-ink-400 hover:border-ink-600 hover:text-ink-100"
          >
            GitHub
          </a>
        </div>
      </header>
      <div className="grid grid-cols-1 gap-3 overflow-hidden p-3 lg:grid-cols-[260px_1fr_360px]">
        <aside className="hidden h-full overflow-hidden rounded-lg border border-ink-800 lg:flex">
          <OperationCatalog onAdd={handleAddOp} />
        </aside>
        <main className="grid grid-rows-2 gap-3 overflow-hidden">
          <InputPane
            value={inputBytes ? `<binary input: ${inputBytes.length} bytes>` : inputText}
            onChange={handleInputChange}
            onUploadFile={handleUploadFile}
            onClear={handleClearInput}
            onMagic={handleMagic}
            inputBytes={inputBuffer.length}
            isBinary={isInputBinary}
          />
          <OutputPane
            bytes={result?.finalOutput ?? new Uint8Array()}
            totalMs={result?.totalMs ?? 0}
            hasError={Boolean(result?.steps.some((s) => s.error))}
          />
        </main>
        <aside className="flex h-full flex-col gap-3 overflow-hidden">
          {magic && magic.length > 0 && (
            <MagicPanel
              candidates={magic}
              chain={magicChain}
              onPick={handlePickMagic}
              onApplyChain={handleApplyChain}
              onRunChain={handleRunChain}
              onClose={() => {
                setMagic(null);
                setMagicChain(null);
              }}
              busy={magicBusy}
            />
          )}
          <div className="flex flex-col overflow-hidden rounded-lg border border-ink-800 bg-ink-900/40">
            <div className="flex items-center gap-2 border-b border-ink-800 px-3 py-1.5 text-[11px] uppercase tracking-wider text-ink-500">
              Recipe
              <span className="ml-auto text-ink-600">
                {recipe.length} step{recipe.length === 1 ? '' : 's'}
              </span>
              <button
                onClick={handleClearRecipe}
                disabled={recipe.length === 0}
                className="rounded p-1 text-ink-400 hover:bg-red-500/20 hover:text-red-300 disabled:opacity-30"
                title="Clear recipe"
              >
                <Trash2 size={14} />
              </button>
            </div>
            <div className="scrollbar-thin flex-1 space-y-2 overflow-y-auto p-2">
              {recipe.length === 0 ? (
                <div className="px-3 py-8 text-center text-xs text-ink-500">
                  Click an operation on the left to add it to the recipe.
                  <br />
                  Or hit the magic wand to auto-detect.
                </div>
              ) : (
                recipe.map((step, idx) => {
                  const op = getOp(step.opId);
                  if (!op) return null;
                  const stepResult = result?.steps.find((r) => r.uid === step.uid);
                  return (
                    <RecipeStepCard
                      key={step.uid}
                      step={step}
                      op={op}
                      result={stepResult}
                      index={idx}
                      total={recipe.length}
                      onChangeArg={(name, value) => handleChangeArg(step.uid, name, value)}
                      onToggleEnabled={() => handleToggleEnabled(step.uid)}
                      onMove={(delta) => handleMove(step.uid, delta)}
                      onRemove={() => handleRemove(step.uid)}
                      onDragStart={() => handleDragStart(idx)}
                      onDragOver={handleDragOver}
                      onDrop={() => handleDrop(idx)}
                      isDragging={draggingIdx === idx}
                    />
                  );
                })
              )}
            </div>
          </div>
        </aside>
      </div>
    </div>
  );
}

function defaultSample(): string {
  return 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJzdWIiOiIxMjM0NTY3ODkwIiwibmFtZSI6IkpvaG4gRG9lIiwiaWF0IjoxNTE2MjM5MDIyfQ.SflKxwRJSMeKKF2QT4fwpMeJf36POk6yJV_adQssw5c';
}

function defaultRecipe(): RecipeStep[] {
  const op = getOp('jwt-decode');
  return op ? [makeStep(op)] : [];
}

export default App;
