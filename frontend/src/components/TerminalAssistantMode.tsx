import React, { useState } from "react";
import { motion } from "framer-motion";
import {
  AlertTriangle,
  Check,
  Clipboard,
  HelpCircle,
  Play,
  RefreshCw,
  ShieldAlert,
  ShieldCheck,
  Sparkles,
  Terminal,
} from "lucide-react";
import type { AssistantGuideResponse } from "../types/pillars";

interface TerminalAssistantModeProps {
  terminalOpen: boolean;
  onToggleTerminal: () => void;
  onPasteToTerminal: (cmd: string) => void;
  onRunInTerminal: (cmd: string) => void;
}

export const TerminalAssistantMode: React.FC<TerminalAssistantModeProps> = ({
  terminalOpen,
  onToggleTerminal,
  onPasteToTerminal,
  onRunInTerminal,
}) => {
  const [taskInput, setTaskInput] = useState("kill whatever is using port 8000");
  const [loading, setLoading] = useState(false);
  const [guide, setGuide] = useState<AssistantGuideResponse | null>(null);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const [copiedIdx, setCopiedIdx] = useState<number | null>(null);

  const sampleTasks = [
    { label: "Stop process on port 8000", task: "kill whatever is using port 8000" },
    { label: "Undo last git commit", task: "undo last commit without losing changes" },
    { label: "List running Python processes", task: "list all running python processes" },
  ];

  const handleAskAssistant = async (customTask?: string) => {
    const task = (customTask ?? taskInput).trim();
    if (!task) return;

    setLoading(true);
    setErrorMsg(null);

    try {
      const res = await fetch("/api/assistant/guide", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ task }),
      });
      const data = await res.json();
      if (!res.ok) {
        throw new Error(data.detail || "Terminal assistant request failed");
      }
      setGuide(data as AssistantGuideResponse);
    } catch (err: any) {
      setErrorMsg(err.message || "Error contacting terminal assistant API");
    } finally {
      setLoading(false);
    }
  };

  const handleCopy = (cmd: string, idx: number) => {
    navigator.clipboard.writeText(cmd);
    setCopiedIdx(idx);
    setTimeout(() => setCopiedIdx(null), 1800);
  };

  return (
    <div className="flex-1 flex flex-col min-w-0 bg-[#0B0D12] overflow-hidden">
      {/* Top Bar */}
      <header className="h-12 px-5 border-b border-white/10 flex items-center justify-between bg-[#0E1015]/80 shrink-0">
        <div className="flex items-center gap-2.5">
          <Sparkles className="w-4 h-4 text-indigo-400" />
          <h1 className="text-sm font-semibold text-zinc-100">
            Pillar 3: Zero-Hallucination Terminal Assistant
          </h1>
          <span className="rounded bg-indigo-500/10 border border-indigo-500/20 px-2 py-0.5 text-[10px] font-mono text-indigo-300">
            PowerShell AST + Get-Command Verified
          </span>
        </div>

        <button
          type="button"
          onClick={onToggleTerminal}
          className={`flex items-center gap-1.5 rounded-lg border px-2.5 py-1 text-xs font-mono transition ${
            terminalOpen
              ? "border-indigo-500/40 bg-indigo-500/10 text-indigo-300"
              : "border-white/10 bg-white/5 text-zinc-400 hover:text-zinc-200"
          }`}
        >
          <Terminal className="w-3.5 h-3.5" />
          <span>{terminalOpen ? "Hide Terminal" : "Show Terminal"}</span>
        </button>
      </header>

      {/* Main Scrollable Content */}
      <div className="flex-1 overflow-y-auto p-5 space-y-5">
        {/* Request Form */}
        <form
          onSubmit={(e) => {
            e.preventDefault();
            void handleAskAssistant();
          }}
          className="rounded-xl border border-white/10 bg-white/[0.02] p-4 space-y-3"
        >
          <label className="block text-xs font-medium text-zinc-200">
            Describe What You Want to Do in Plain English
          </label>
          <div className="flex gap-2">
            <input
              type="text"
              value={taskInput}
              onChange={(e) => setTaskInput(e.target.value)}
              placeholder="e.g. kill whatever is using port 8000, undo last git commit..."
              className="flex-1 rounded-lg border border-white/10 bg-black/50 px-3 py-2 text-xs text-zinc-100 placeholder:text-zinc-600 focus:border-indigo-400 focus:outline-none"
            />
            <button
              type="submit"
              disabled={loading || taskInput.trim().length < 2}
              className="flex items-center gap-2 rounded-lg bg-indigo-600 hover:bg-indigo-500 px-4 py-2 text-xs font-semibold text-white transition disabled:opacity-40 shrink-0"
            >
              {loading ? (
                <RefreshCw className="w-3.5 h-3.5 animate-spin" />
              ) : (
                <Sparkles className="w-3.5 h-3.5" />
              )}
              <span>{loading ? "AST Verifying..." : "Generate Verified Guide"}</span>
            </button>
          </div>

          <div className="flex flex-wrap items-center gap-2 pt-1 text-xs">
            <span className="text-[11px] text-zinc-500">Examples:</span>
            {sampleTasks.map((s) => (
              <button
                key={s.label}
                type="button"
                onClick={() => {
                  setTaskInput(s.task);
                  void handleAskAssistant(s.task);
                }}
                className="rounded-md border border-white/10 bg-black/40 hover:bg-white/10 px-2.5 py-1 text-[11px] text-zinc-300 transition"
              >
                {s.label}
              </button>
            ))}
          </div>
        </form>

        {errorMsg && (
          <div className="rounded-xl border border-rose-500/30 bg-rose-950/20 p-3.5 flex items-center gap-2 text-xs text-rose-300">
            <ShieldAlert className="w-4 h-4 shrink-0 text-rose-400" />
            <span>{errorMsg}</span>
          </div>
        )}

        {guide && (
          <motion.div
            initial={{ opacity: 0, y: 8 }}
            animate={{ opacity: 1, y: 0 }}
            className="space-y-4"
          >
            {/* Task Summary */}
            <div className="rounded-xl border border-white/10 bg-white/[0.02] p-4 flex items-center justify-between gap-3">
              <div className="space-y-0.5">
                <span className="text-[10px] font-mono uppercase text-zinc-500">
                  Assistant Summary
                </span>
                <p className="text-xs font-medium text-zinc-100">{guide.task_summary}</p>
              </div>
              <span
                className={`rounded-full px-2.5 py-0.5 text-[10px] font-mono font-bold shrink-0 ${
                  guide.grounded
                    ? "bg-emerald-500/20 text-emerald-300 border border-emerald-500/30"
                    : "bg-amber-500/20 text-amber-300 border border-amber-500/30"
                }`}
              >
                {guide.grounded ? "GROUNDED" : "CLARIFICATION NEEDED"}
              </span>
            </div>

            {/* Clarifying Question */}
            {guide.clarifying_question && (
              <div className="rounded-xl border border-amber-500/30 bg-amber-950/15 p-4 flex items-start gap-2.5 text-xs text-amber-200">
                <HelpCircle className="w-4 h-4 text-amber-400 shrink-0 mt-0.5" />
                <div>
                  <strong className="font-semibold block mb-0.5">More Context Needed</strong>
                  <span>{guide.clarifying_question}</span>
                </div>
              </div>
            )}

            {/* Withheld Command Warnings */}
            {guide.warnings.length > 0 && (
              <div className="rounded-xl border border-rose-500/30 bg-rose-950/15 p-4 space-y-1.5 text-xs text-rose-200">
                <div className="flex items-center gap-1.5 font-semibold text-rose-300">
                  <AlertTriangle className="w-4 h-4 shrink-0" />
                  <span>Unverified Commands Withheld</span>
                </div>
                {guide.warnings.map((w, idx) => (
                  <p key={idx} className="font-mono text-[11px] text-rose-300/90">
                    {w}
                  </p>
                ))}
              </div>
            )}

            {/* Verified Steps */}
            <div className="space-y-3">
              {guide.steps.map((step, idx) => (
                <div
                  key={idx}
                  className="rounded-xl border border-white/10 bg-white/[0.02] p-4 space-y-3"
                >
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <div className="flex items-center gap-2">
                      <span className="flex h-5 w-5 items-center justify-center rounded-full bg-indigo-500/20 text-[11px] font-mono font-bold text-indigo-300">
                        {idx + 1}
                      </span>
                      <h3 className="text-xs font-semibold text-zinc-100">
                        {step.step_title}
                      </h3>
                    </div>
                    <span className="inline-flex items-center gap-1 rounded bg-emerald-500/15 border border-emerald-500/30 px-2 py-0.5 text-[10px] font-mono font-semibold text-emerald-300">
                      <ShieldCheck className="w-3 h-3" />
                      {step.verification_badge}
                    </span>
                  </div>

                  {/* Command Bar */}
                  <div className="flex flex-wrap items-center justify-between gap-2 rounded-lg border border-white/10 bg-black/70 px-3 py-2 font-mono text-xs">
                    <code className="text-emerald-300 break-all flex-1">{step.command}</code>
                    <div className="flex items-center gap-1.5 shrink-0">
                      <button
                        type="button"
                        onClick={() => handleCopy(step.command, idx)}
                        className="flex items-center gap-1 rounded border border-white/10 bg-white/5 hover:bg-white/10 px-2.5 py-1 text-[11px] text-zinc-200 transition"
                      >
                        {copiedIdx === idx ? (
                          <>
                            <Check className="w-3 h-3 text-emerald-400" />
                            <span>Copied</span>
                          </>
                        ) : (
                          <>
                            <Clipboard className="w-3 h-3" />
                            <span>Copy</span>
                          </>
                        )}
                      </button>
                      <button
                        type="button"
                        onClick={() => onPasteToTerminal(step.command)}
                        className="rounded border border-indigo-500/30 bg-indigo-500/10 hover:bg-indigo-500/20 px-2.5 py-1 text-[11px] text-indigo-300 transition"
                      >
                        Paste to Terminal
                      </button>
                      <button
                        type="button"
                        onClick={() => onRunInTerminal(step.command)}
                        className="flex items-center gap-1 rounded bg-indigo-600 hover:bg-indigo-500 px-2.5 py-1 text-[11px] text-white transition"
                      >
                        <Play className="w-3 h-3" />
                        <span>Run</span>
                      </button>
                    </div>
                  </div>

                  {/* Plain Explanation & Flag Breakdown */}
                  <p className="text-xs text-zinc-300 leading-relaxed">
                    {step.plain_explanation}
                  </p>

                  {step.flag_breakdown.length > 0 && (
                    <div className="rounded-lg border border-white/5 bg-black/40 p-3 space-y-1.5">
                      <span className="text-[10px] font-mono uppercase text-zinc-500 block">
                        Plain-English Flag Breakdown
                      </span>
                      {step.flag_breakdown.map((flag, fIdx) => (
                        <div key={fIdx} className="flex items-start gap-2 text-xs">
                          <code className="rounded bg-indigo-500/10 border border-indigo-500/20 px-1.5 py-0.5 text-[11px] font-mono text-indigo-300 shrink-0">
                            {flag.part}
                          </code>
                          <span className="text-zinc-400 text-[11px] pt-0.5">{flag.meaning}</span>
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              ))}
            </div>
          </motion.div>
        )}
      </div>
    </div>
  );
};
