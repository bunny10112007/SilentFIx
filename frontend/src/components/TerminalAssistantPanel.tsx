// frontend/src/components/TerminalAssistantPanel.tsx
import React, { useState } from "react";
import { motion } from "framer-motion";
import {
  AlertTriangle,
  ArrowRight,
  Check,
  Copy,
  HelpCircle,
  Loader2,
  Play,
  ShieldCheck,
  Terminal,
  XCircle,
} from "lucide-react";
import type { AssistantGuideResponse } from "../types/pillars";

const SAMPLE_TASKS = [
  { label: "Stop port 8000", task: "kill whatever is using port 8000" },
  { label: "Undo last git commit", task: "undo last commit without losing changes" },
  { label: "List python processes", task: "list all running python processes" },
];

interface TerminalAssistantPanelProps {
  onPasteToTerminal: (cmd: string) => void;
  onRunInTerminal: (cmd: string) => void;
}

export const TerminalAssistantPanel: React.FC<TerminalAssistantPanelProps> = ({
  onPasteToTerminal,
  onRunInTerminal,
}) => {
  const [taskInput, setTaskInput] = useState("");
  const [guide, setGuide] = useState<AssistantGuideResponse | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const [copiedCmd, setCopiedCmd] = useState<string | null>(null);

  const handleCopy = async (cmd: string) => {
    await navigator.clipboard.writeText(cmd);
    setCopiedCmd(cmd);
    window.setTimeout(() => setCopiedCmd(null), 1500);
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    const cleaned = taskInput.trim();
    if (!cleaned || isLoading) return;

    setErrorMsg(null);
    setIsLoading(true);
    try {
      const res = await fetch("/api/assistant/guide", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ task: cleaned }),
      });
      if (!res.ok) {
        const body = (await res.json().catch(() => ({}))) as { detail?: string };
        throw new Error(body.detail || `Assistant request failed (HTTP ${res.status})`);
      }
      const data = (await res.json()) as AssistantGuideResponse;
      setGuide(data);
    } catch (err) {
      setErrorMsg(err instanceof Error ? err.message : "Could not reach /api/assistant/guide.");
    } finally {
      setIsLoading(false);
    }
  };

  return (
    <div className="flex-1 overflow-y-auto px-6 py-6 bg-[#0B0D12]">
      <div className="max-w-3xl mx-auto space-y-5">
        <div className="space-y-1">
          <h1 className="text-lg font-semibold text-zinc-100 flex items-center gap-2">
            <Terminal className="w-5 h-5 text-indigo-400" />
            Zero-Hallucination Terminal Assistant
          </h1>
          <p className="text-xs text-zinc-400">
            Describe any terminal task in plain English. Every suggested command is checked against
            PowerShell&apos;s AST parser and <code className="font-mono text-indigo-300">Get-Command</code>{" "}
            without executing before being shown.
          </p>
        </div>

        <form
          onSubmit={handleSubmit}
          className="rounded-xl bg-[#11141C] border border-white/10 p-4 space-y-3"
        >
          <div className="flex flex-wrap items-center justify-between gap-2">
            <label className="text-xs font-medium text-zinc-300">
              What do you want to accomplish?
            </label>
            <div className="flex flex-wrap gap-1.5">
              {SAMPLE_TASKS.map((sample) => (
                <button
                  key={sample.label}
                  type="button"
                  onClick={() => setTaskInput(sample.task)}
                  className="px-2 py-0.5 rounded-md bg-white/5 hover:bg-white/10 border border-white/10 text-[11px] text-zinc-300 transition"
                >
                  {sample.label}
                </button>
              ))}
            </div>
          </div>

          <div className="flex gap-2">
            <input
              type="text"
              value={taskInput}
              onChange={(e) => setTaskInput(e.target.value)}
              placeholder="e.g. kill whatever is using port 8000, undo last commit..."
              className="flex-1 rounded-lg bg-[#090B0F] border border-white/10 px-3 py-2 text-xs text-zinc-100 placeholder:text-zinc-600 focus:outline-none focus:border-indigo-400"
            />
            <button
              type="submit"
              disabled={isLoading || taskInput.trim().length < 2}
              className="inline-flex items-center gap-2 px-4 py-2 rounded-lg bg-indigo-500 hover:bg-indigo-400 disabled:opacity-40 text-xs font-medium text-white transition shrink-0"
            >
              {isLoading ? (
                <>
                  <Loader2 className="w-3.5 h-3.5 animate-spin" />
                  AST Verifying...
                </>
              ) : (
                <>
                  <ShieldCheck className="w-3.5 h-3.5" />
                  Verify &amp; Guide
                </>
              )}
            </button>
          </div>
        </form>

        {errorMsg && (
          <div className="rounded-xl bg-rose-500/10 border border-rose-500/30 p-3.5 flex items-start gap-2.5 text-xs text-rose-200">
            <XCircle className="w-4 h-4 text-rose-400 shrink-0 mt-0.5" />
            <span>{errorMsg}</span>
          </div>
        )}

        {guide && (
          <motion.div
            initial={{ opacity: 0, y: 10 }}
            animate={{ opacity: 1, y: 0 }}
            className="space-y-4"
          >
            <div className="rounded-xl bg-[#11141C] border border-white/10 p-4 flex items-center justify-between gap-3">
              <div className="space-y-0.5">
                <span className="text-[11px] text-zinc-500 uppercase tracking-wider">Task Plan</span>
                <p className="text-sm text-zinc-100">{guide.task_summary}</p>
              </div>
              <span
                className={`px-2.5 py-0.5 rounded-full text-[10px] font-semibold uppercase shrink-0 ${
                  guide.grounded
                    ? "bg-emerald-500/15 text-emerald-300 border border-emerald-500/30"
                    : "bg-amber-500/15 text-amber-300 border border-amber-500/30"
                }`}
              >
                {guide.grounded ? "Grounded" : "Needs Detail"}
              </span>
            </div>

            {guide.clarifying_question && (
              <div className="rounded-xl bg-amber-500/10 border border-amber-500/30 p-4 flex items-start gap-2.5 text-xs text-amber-200">
                <HelpCircle className="w-4 h-4 text-amber-400 shrink-0 mt-0.5" />
                <span>{guide.clarifying_question}</span>
              </div>
            )}

            {guide.warnings.length > 0 && (
              <div className="rounded-xl bg-rose-500/10 border border-rose-500/30 p-4 space-y-1.5 text-xs text-rose-200">
                <div className="flex items-center gap-1.5 font-semibold text-rose-300">
                  <AlertTriangle className="w-4 h-4" />
                  <span>Unverified / Blocked Commands Withheld</span>
                </div>
                {guide.warnings.map((w, idx) => (
                  <p key={idx} className="font-mono text-[11px] text-rose-300/90">
                    {w}
                  </p>
                ))}
              </div>
            )}

            <div className="space-y-3">
              {guide.steps.map((step, idx) => (
                <div
                  key={`${step.step_title}-${idx}`}
                  className="rounded-xl bg-[#11141C] border border-white/10 p-4 space-y-3"
                >
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <div className="flex items-center gap-2">
                      <span className="text-xs font-mono text-indigo-300">Step {idx + 1}.</span>
                      <h2 className="text-xs font-semibold text-zinc-100">{step.step_title}</h2>
                    </div>
                    <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full bg-emerald-500/15 border border-emerald-500/30 text-[10px] font-mono text-emerald-300">
                      <ShieldCheck className="w-3 h-3" />
                      {step.verification_badge}
                    </span>
                  </div>

                  <div className="rounded-lg bg-[#090B0F] border border-white/10 p-3 flex flex-col sm:flex-row sm:items-center justify-between gap-3">
                    <code className="font-mono text-xs text-indigo-200 break-all">{step.command}</code>
                    <div className="flex items-center gap-1.5 shrink-0">
                      <button
                        type="button"
                        onClick={() => void handleCopy(step.command)}
                        className="inline-flex items-center gap-1 px-2.5 py-1 rounded-md bg-white/5 hover:bg-white/10 text-xs text-zinc-200 transition"
                      >
                        {copiedCmd === step.command ? (
                          <>
                            <Check className="w-3.5 h-3.5 text-emerald-400" />
                            Copied
                          </>
                        ) : (
                          <>
                            <Copy className="w-3.5 h-3.5" />
                            Copy
                          </>
                        )}
                      </button>
                      <button
                        type="button"
                        onClick={() => onPasteToTerminal(step.command)}
                        className="inline-flex items-center gap-1 px-2.5 py-1 rounded-md bg-white/5 hover:bg-white/10 text-xs text-zinc-200 transition"
                      >
                        Paste
                        <ArrowRight className="w-3.5 h-3.5" />
                      </button>
                      <button
                        type="button"
                        onClick={() => onRunInTerminal(step.command)}
                        className="inline-flex items-center gap-1 px-2.5 py-1 rounded-md bg-indigo-500 hover:bg-indigo-400 text-xs font-medium text-white transition"
                      >
                        <Play className="w-3 h-3" />
                        Run
                      </button>
                    </div>
                  </div>

                  <p className="text-xs text-zinc-300 leading-relaxed">{step.plain_explanation}</p>

                  {step.flag_breakdown.length > 0 && (
                    <div className="rounded-lg bg-[#090B0F] border border-white/5 p-3 space-y-1.5">
                      <p className="text-[10px] font-medium uppercase tracking-wider text-zinc-500">
                        Plain-English Flag Breakdown
                      </p>
                      {step.flag_breakdown.map((flag, fIdx) => (
                        <div key={fIdx} className="flex items-start gap-2 text-xs">
                          <code className="px-1.5 py-0.5 rounded bg-indigo-500/15 border border-indigo-400/20 font-mono text-[11px] text-indigo-200 shrink-0">
                            {flag.part}
                          </code>
                          <span className="text-[11px] text-zinc-400 pt-0.5">{flag.meaning}</span>
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
