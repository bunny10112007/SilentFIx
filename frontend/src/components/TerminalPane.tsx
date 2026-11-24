import React, { useEffect, useRef, useState } from "react";
import { ShieldAlert, Terminal, Trash2 } from "lucide-react";
import type { TerminalEntry } from "../types/workspace";

interface TerminalPaneProps {
  sessionId: string;
  cwd: string;
  entries: TerminalEntry[];
  draftCommand: string;
  onDraftChange: (cmd: string) => void;
  onRunCommand: (cmd: string) => Promise<void>;
  onClear: () => void;
  isRunning: boolean;
}

export const TerminalPane: React.FC<TerminalPaneProps> = ({
  cwd,
  entries,
  draftCommand,
  onDraftChange,
  onRunCommand,
  onClear,
  isRunning,
}) => {
  const scrollRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const [historyIdx, setHistoryIdx] = useState<number>(-1);

  useEffect(() => {
    scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight, behavior: "smooth" });
  }, [entries]);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    const cmd = draftCommand.trim();
    if (!cmd || isRunning) return;
    setHistoryIdx(-1);
    onDraftChange("");
    await onRunCommand(cmd);
  };

  const handleKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === "ArrowUp" && entries.length > 0) {
      e.preventDefault();
      const next = historyIdx === -1 ? entries.length - 1 : Math.max(0, historyIdx - 1);
      setHistoryIdx(next);
      onDraftChange(entries[next].command);
    } else if (e.key === "ArrowDown" && historyIdx !== -1) {
      e.preventDefault();
      if (historyIdx >= entries.length - 1) {
        setHistoryIdx(-1);
        onDraftChange("");
      } else {
        const next = historyIdx + 1;
        setHistoryIdx(next);
        onDraftChange(entries[next].command);
      }
    }
  };

  return (
    <section
      className="w-[42%] min-w-[340px] max-w-[640px] bg-[#090B0F] border-l border-white/10 flex flex-col font-mono text-xs"
      onClick={() => inputRef.current?.focus()}
    >
      <div className="h-10 px-3 border-b border-white/10 flex items-center justify-between bg-[#0E1015]">
        <div className="flex items-center gap-2 text-zinc-200">
          <Terminal className="w-3.5 h-3.5 text-zinc-400" />
          <span className="font-medium">powershell.exe</span>
        </div>
        <button
          type="button"
          onClick={(e) => {
            e.stopPropagation();
            onClear();
          }}
          title="Clear terminal"
          className="p-1.5 rounded hover:bg-white/10 text-zinc-400 hover:text-zinc-200 transition"
        >
          <Trash2 className="w-3.5 h-3.5" />
        </button>
      </div>

      <div ref={scrollRef} className="flex-1 p-3.5 overflow-y-auto space-y-3 text-zinc-300">
        <div className="text-zinc-500 leading-relaxed">
          Windows PowerShell (SilentFix Filtered Terminal)
          <br />
          Paste any copied fix below and press Enter.
        </div>

        {entries.map((item) => (
          <div key={item.id} className="space-y-1">
            <div className="text-zinc-400 break-all">
              <span className="text-indigo-400">PS {item.cwd}&gt;</span>{" "}
              <span className="text-zinc-100">{item.command}</span>
            </div>
            {item.stdout && (
              <pre className="whitespace-pre-wrap break-words text-zinc-300 pl-2 border-l border-white/10">
                {item.stdout}
              </pre>
            )}
            {item.stderr && (
              <div
                className={`whitespace-pre-wrap break-words pl-2 border-l ${
                  item.blocked
                    ? "border-amber-500 text-amber-300 flex items-start gap-1.5"
                    : "border-rose-500 text-rose-300"
                }`}
              >
                {item.blocked && <ShieldAlert className="w-3.5 h-3.5 shrink-0 mt-0.5" />}
                <span>{item.stderr}</span>
              </div>
            )}
          </div>
        ))}

        <form onSubmit={handleSubmit} className="flex items-center gap-1.5 pt-1">
          <span className="text-indigo-400 shrink-0">PS {cwd}&gt;</span>
          <input
            ref={inputRef}
            type="text"
            value={draftCommand}
            onChange={(e) => onDraftChange(e.target.value)}
            onKeyDown={handleKeyDown}
            disabled={isRunning}
            placeholder={isRunning ? "Running..." : "Paste command here..."}
            className="flex-1 bg-transparent text-zinc-100 placeholder:text-zinc-600 focus:outline-none"
            autoComplete="off"
            spellCheck={false}
          />
        </form>
      </div>
    </section>
  );
};
