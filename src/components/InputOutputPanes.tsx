import clsx from 'clsx';
import { Copy, Download, FileText, Trash2, Upload, Wand2 } from 'lucide-react';
import { useMemo, useRef, useState } from 'react';
import { isPrintableAscii, shannonEntropy, toText } from '../ops/util';

interface InputPaneProps {
  value: string;
  onChange(value: string): void;
  onUploadFile(bytes: Uint8Array, name: string): void;
  onClear(): void;
  onMagic(): void;
  inputBytes: number;
  isBinary: boolean;
}

export function InputPane(props: InputPaneProps) {
  const fileRef = useRef<HTMLInputElement>(null);

  return (
    <div className="flex flex-col rounded-lg border border-ink-800 bg-ink-900/40">
      <div className="flex items-center gap-2 border-b border-ink-800 px-3 py-1.5 text-[11px] uppercase tracking-wider text-ink-500">
        Input
        <span className="ml-auto text-ink-600">{props.inputBytes} bytes</span>
        {props.isBinary && (
          <span className="rounded bg-amber-500/20 px-1.5 py-0.5 text-[9px] text-amber-300">
            binary
          </span>
        )}
        <button
          onClick={() => fileRef.current?.click()}
          className="rounded p-1 text-ink-400 hover:bg-ink-800 hover:text-ink-100"
          title="Upload file"
        >
          <Upload size={14} />
        </button>
        <button
          onClick={props.onMagic}
          className="rounded p-1 text-ink-400 hover:bg-ink-800 hover:text-accent-400"
          title="Magic — auto-detect what to do next"
        >
          <Wand2 size={14} />
        </button>
        <button
          onClick={props.onClear}
          className="rounded p-1 text-ink-400 hover:bg-red-500/20 hover:text-red-300"
          title="Clear input"
        >
          <Trash2 size={14} />
        </button>
        <input
          ref={fileRef}
          type="file"
          className="hidden"
          onChange={async (e) => {
            const file = e.target.files?.[0];
            if (!file) return;
            const buf = new Uint8Array(await file.arrayBuffer());
            props.onUploadFile(buf, file.name);
            e.target.value = '';
          }}
        />
      </div>
      <textarea
        value={props.value}
        onChange={(e) => props.onChange(e.target.value)}
        spellCheck={false}
        placeholder="Paste, type, or upload data here. Try a JWT, base64 blob, hex string, or minified JS."
        className="scrollbar-thin h-full min-h-[160px] flex-1 resize-none bg-transparent p-3 font-mono text-sm leading-relaxed text-ink-100 outline-none"
      />
    </div>
  );
}

interface OutputPaneProps {
  bytes: Uint8Array;
  totalMs: number;
  hasError: boolean;
}

export function OutputPane({ bytes, totalMs, hasError }: OutputPaneProps) {
  const isBinary = useMemo(() => !looksLikeText(bytes), [bytes]);
  const [explicitView, setExplicitView] = useState<'text' | 'hex' | null>(null);
  const view = explicitView ?? (isBinary ? 'hex' : 'text');
  const setView = setExplicitView;
  const [copied, setCopied] = useState(false);

  const text = toText(bytes);
  const hex = bytes.length > 0 ? formatHexDump(bytes, 256) : '';

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(view === 'hex' ? hex : text);
      setCopied(true);
      setTimeout(() => setCopied(false), 1200);
    } catch {
      /* noop */
    }
  };

  const download = () => {
    const blob = new Blob([new Uint8Array(bytes).buffer], { type: 'application/octet-stream' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = 'output.bin';
    a.click();
    URL.revokeObjectURL(url);
  };

  return (
    <div className="flex flex-col rounded-lg border border-ink-800 bg-ink-900/40">
      <div className="flex items-center gap-2 border-b border-ink-800 px-3 py-1.5 text-[11px] uppercase tracking-wider text-ink-500">
        Output
        <div className="ml-2 flex overflow-hidden rounded border border-ink-800">
          <button
            onClick={() => setView('text')}
            className={clsx(
              'px-2 py-0.5 text-[10px]',
              view === 'text' ? 'bg-ink-800 text-ink-100' : 'text-ink-500 hover:text-ink-200',
            )}
          >
            Text
          </button>
          <button
            onClick={() => setView('hex')}
            className={clsx(
              'px-2 py-0.5 text-[10px]',
              view === 'hex' ? 'bg-ink-800 text-ink-100' : 'text-ink-500 hover:text-ink-200',
            )}
          >
            Hex
          </button>
        </div>
        <span className="ml-auto text-ink-600">
          {bytes.length} bytes · {totalMs.toFixed(1)}ms · entropy {shannonEntropy(bytes).toFixed(2)}
        </span>
        {hasError && (
          <span className="rounded bg-red-500/20 px-1.5 py-0.5 text-[9px] text-red-300">error</span>
        )}
        <button
          onClick={copy}
          className={clsx(
            'rounded p-1 hover:bg-ink-800',
            copied ? 'text-accent-500' : 'text-ink-400 hover:text-ink-100',
          )}
          title="Copy"
        >
          <Copy size={14} />
        </button>
        <button
          onClick={download}
          className="rounded p-1 text-ink-400 hover:bg-ink-800 hover:text-ink-100"
          title="Download as file"
        >
          <Download size={14} />
        </button>
      </div>
      <div className="scrollbar-thin h-full min-h-[160px] flex-1 overflow-auto p-3">
        {bytes.length === 0 ? (
          <div className="flex h-full flex-col items-center justify-center text-ink-600">
            <FileText size={28} className="mb-2 opacity-40" />
            <span className="text-xs">No output yet</span>
          </div>
        ) : (
          <pre className="whitespace-pre-wrap break-all font-mono text-sm text-ink-100">
            {view === 'text' ? text : hex}
          </pre>
        )}
      </div>
    </div>
  );
}

function looksLikeText(bytes: Uint8Array): boolean {
  if (bytes.length === 0) return true;
  let printable = 0;
  for (let i = 0; i < Math.min(bytes.length, 4096); i++) {
    if (isPrintableAscii(bytes[i])) printable++;
  }
  return printable / Math.min(bytes.length, 4096) > 0.85;
}

function formatHexDump(bytes: Uint8Array, limit: number): string {
  const lines: string[] = [];
  const max = Math.min(bytes.length, limit);
  for (let i = 0; i < max; i += 16) {
    const slice = bytes.slice(i, i + 16);
    let hex = '';
    let ascii = '';
    for (let j = 0; j < 16; j++) {
      if (j < slice.length) {
        hex += slice[j].toString(16).padStart(2, '0') + ' ';
        ascii += isPrintableAscii(slice[j]) ? String.fromCharCode(slice[j]) : '.';
      } else {
        hex += '   ';
        ascii += ' ';
      }
      if (j === 7) hex += ' ';
    }
    lines.push(`${i.toString(16).padStart(8, '0')}  ${hex} |${ascii}|`);
  }
  if (bytes.length > limit) lines.push(`... (${bytes.length - limit} more bytes)`);
  return lines.join('\n');
}
