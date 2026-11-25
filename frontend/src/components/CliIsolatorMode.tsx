import React, { useState } from "react";
import { motion } from "framer-motion";
import {
  Check,
  CheckCircle2,
  Clipboard,
  Cpu,
  FlaskConical,
  Play,
  RefreshCw,
  ShieldAlert,
  Terminal,
  XCircle,
} from "lucide-react";
import type { CliIsolationReport } from "../types/pillars";

interface CliIsolatorModeProps {
  terminalOpen: boolean;
  onToggleTerminal: () => void;
  onPasteToTerminal: (cmd: string) => void;
  onRunInTerminal: (cmd: string) => void;
}

export const CliIsolatorMode: React.FC<CliIsolatorModeProps> = ({
  terminalOpen,
  onToggleTerminal,
  onPasteToTerminal,
  onRunInTerminal,
}) => {
  const [errorText, setErrorText] = useState(
    "'kubectl' is not recognized as an internal or external command"
  );
  const [projectDir, setProjectDir] = useState("C:\\Users\\User\\Downloads\\SILENTFIX");
  const [loading, setLoading] = useState(false);
  const [report, setReport] = useState<CliIsolationReport | null>(null);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const [copiedIdx, setCopiedIdx] = useState<number | null>(null);

  const sampleErrors = [
    {
      label: "CMD: kubectl",
      text: "'kubectl' is not recognized as an internal or external command",
    },
    {
      label: "PowerShell: terraform",
      text: "The term 'terraform' is not recognized as the name of a cmdlet",
    },
    {
      label: "Zsh: helm",
      text: "zsh: command not found: helm",
    },
    {
      label: "Bash: docker",
      text: "bash: docker: command not found",
    },
  ];

  const handleIsolate = async (customText?: string) => {
    const text = (customText ?? errorText).trim();
    if (!text) return;

    setLoading(true);
    setErrorMsg(null);

    try {
      const res = await fetch("/api/cli-isolator/isolate", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          error_text: text,
          project_dir: projectDir.trim() || null,
        }),
      });
      const data = await res.json();
      if (!res.ok) {
        throw new Error(data.detail || "CLI isolation request failed");
      }
      setReport(data as CliIsolationReport);
    } catch (err: any) {
      setErrorMsg(err.message || "Error communicating with CLI isolator API");
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
          <FlaskConical className="w-4 h-4 text-indigo-400" />
          <h1 className="text-sm font-semibold text-zinc-100">
            Pillar 2: Broken CLI Root-Cause Isolator
          </h1>
          <span className="rounded bg-indigo-500/10 border border-indigo-500/20 px-2 py-0.5 text-[10px] font-mono text-indigo-300">
            Hypothesis Matrix + Env Mirror
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
        {/* Input Form */}
        <form
          onSubmit={(e) => {
            e.preventDefault();
            void handleIsolate();
          }}
          className="rounded-xl border border-white/10 bg-white/[0.02] p-4 space-y-3"
        >
          <div>
            <label className="block text-xs font-medium text-zinc-200 mb-1.5">
              Paste Failing Terminal Error Output
            </label>
            <textarea
              rows={2}
              value={errorText}
              onChange={(e) => setErrorText(e.target.value)}
              placeholder="Paste terminal error (e.g. 'git' is not recognized as an internal or external command)..."
              className="w-full rounded-lg border border-white/10 bg-black/50 px-3 py-2 text-xs font-mono text-zinc-100 placeholder:text-zinc-600 focus:border-indigo-400 focus:outline-none"
            />
          </div>

          <div className="flex flex-wrap items-center gap-2">
            <input
              type="text"
              value={projectDir}
              onChange={(e) => setProjectDir(e.target.value)}
              placeholder="Optional project directory (for .venv / node_modules check)"
              className="flex-1 min-w-[220px] rounded-lg border border-white/10 bg-black/50 px-3 py-2 text-xs font-mono text-zinc-200 placeholder:text-zinc-600 focus:border-indigo-400 focus:outline-none"
            />
            <button
              type="submit"
              disabled={loading || !errorText.trim()}
              className="flex items-center gap-2 rounded-lg bg-indigo-600 hover:bg-indigo-500 px-4 py-2 text-xs font-semibold text-white transition disabled:opacity-40 shrink-0"
            >
              {loading ? (
                <RefreshCw className="w-3.5 h-3.5 animate-spin" />
              ) : (
                <Play className="w-3.5 h-3.5" />
              )}
              <span>{loading ? "Testing Hypotheses..." : "Isolate Root Cause"}</span>
            </button>
          </div>

          <div className="flex flex-wrap items-center gap-2 pt-1 text-xs">
            <span className="text-[11px] text-zinc-500">Quick samples:</span>
            {sampleErrors.map((s) => (
              <button
                key={s.label}
                type="button"
                onClick={() => {
                  setErrorText(s.text);
                  void handleIsolate(s.text);
                }}
                className="rounded-md border border-white/10 bg-black/40 hover:bg-white/10 px-2.5 py-1 text-[11px] font-mono text-zinc-300 transition"
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

        {report && (
          <motion.div
            initial={{ opacity: 0, y: 8 }}
            animate={{ opacity: 1, y: 0 }}
            className="space-y-5"
          >
            {/* Diagnosis Verdict Banner */}
            <div
              className={`rounded-xl border p-4 space-y-2 ${
                report.empirically_verified
                  ? "border-emerald-500/30 bg-emerald-950/15"
                  : "border-amber-500/30 bg-amber-950/15"
              }`}
            >
              <div className="flex flex-wrap items-center justify-between gap-2">
                <div className="flex items-center gap-2">
                  {report.empirically_verified ? (
                    <CheckCircle2 className="w-4 h-4 text-emerald-400" />
                  ) : (
                    <ShieldAlert className="w-4 h-4 text-amber-400" />
                  )}
                  <span className="text-xs font-semibold text-zinc-100">
                    {report.exact_root_cause}
                  </span>
                </div>
                <span className="flex items-center gap-1 rounded bg-black/50 border border-white/10 px-2 py-0.5 text-[10px] font-mono text-zinc-300">
                  <Cpu className="w-3 h-3 text-indigo-400" />
                  {report.mirror_backend}
                </span>
              </div>

              <div className="flex flex-wrap gap-3 text-[11px] font-mono text-zinc-400">
                <span>Command: {report.snapshot.missing_command || "unknown"}</span>
                <span>&bull;</span>
                <span>Platform: {report.snapshot.shell_platform}</span>
                {report.snapshot.tool_on_disk && (
                  <>
                    <span>&bull;</span>
                    <span className="text-sky-300">Disk: {report.snapshot.tool_on_disk}</span>
                  </>
                )}
              </div>
            </div>

            {/* Highlighted Copy/Paste Card for exact_fix_commands */}
            {report.exact_fix_commands.length > 0 && (
              <div className="rounded-xl border border-indigo-500/40 bg-indigo-950/20 p-4 space-y-3">
                <div className="flex items-center justify-between">
                  <h2 className="text-xs font-semibold text-indigo-200 uppercase tracking-wider font-mono">
                    Empirically Verified Fix Commands
                  </h2>
                  <span className="rounded-full bg-emerald-500/20 border border-emerald-500/30 px-2.5 py-0.5 text-[10px] font-mono font-bold text-emerald-300">
                    VERIFIED IN MIRROR
                  </span>
                </div>

                <div className="space-y-2">
                  {report.exact_fix_commands.map((cmd, idx) => (
                    <div
                      key={idx}
                      className="flex flex-wrap items-center justify-between gap-2 rounded-lg border border-white/10 bg-black/70 px-3 py-2 font-mono text-xs"
                    >
                      <code className="text-emerald-300 break-all flex-1">{cmd}</code>
                      <div className="flex items-center gap-1.5 shrink-0">
                        <button
                          type="button"
                          onClick={() => handleCopy(cmd, idx)}
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
                          onClick={() => onPasteToTerminal(cmd)}
                          className="rounded border border-indigo-500/30 bg-indigo-500/10 hover:bg-indigo-500/20 px-2.5 py-1 text-[11px] text-indigo-300 transition"
                        >
                          Paste to Terminal
                        </button>
                        <button
                          type="button"
                          onClick={() => onRunInTerminal(cmd)}
                          className="flex items-center gap-1 rounded bg-indigo-600 hover:bg-indigo-500 px-2.5 py-1 text-[11px] text-white transition"
                        >
                          <Play className="w-3 h-3" />
                          <span>Run</span>
                        </button>
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            )}

            {/* Tested Hypotheses Matrix Table */}
            <div className="rounded-xl border border-white/10 bg-white/[0.02] overflow-hidden">
              <div className="px-4 py-3 border-b border-white/10 bg-black/30">
                <h2 className="text-xs font-semibold text-zinc-200 uppercase tracking-wider font-mono">
                  Tested Hypothesis Matrix ({report.tested_hypotheses.length})
                </h2>
              </div>
              <div className="overflow-x-auto">
                <table className="w-full text-left text-xs">
                  <thead className="bg-black/50 text-[10px] font-mono uppercase text-zinc-500 border-b border-white/10">
                    <tr>
                      <th className="px-4 py-2.5">Hypothesis</th>
                      <th className="px-4 py-2.5">Probe</th>
                      <th className="px-4 py-2.5">Outcome</th>
                      <th className="px-4 py-2.5">Empirical Evidence</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-white/5">
                    {report.tested_hypotheses.length === 0 ? (
                      <tr>
                        <td colSpan={4} className="px-4 py-6 text-center text-zinc-500 italic">
                          No testable hypotheses could be formed from this error trace.
                        </td>
                      </tr>
                    ) : (
                      report.tested_hypotheses.map((h) => (
                        <tr key={h.hypothesis_id} className="hover:bg-white/[0.02]">
                          <td className="px-4 py-3 align-top">
                            <div className="font-mono font-bold text-zinc-200">
                              {h.hypothesis_id}
                            </div>
                            <div className="text-[11px] text-zinc-400 mt-0.5">{h.cause_title}</div>
                          </td>
                          <td className="px-4 py-3 font-mono text-[11px] text-indigo-300 align-top">
                            {h.verification_probe}
                          </td>
                          <td className="px-4 py-3 align-top">
                            <span
                              className={`inline-flex items-center gap-1 rounded px-2 py-0.5 text-[10px] font-mono font-bold ${
                                h.outcome === "PASSED"
                                  ? "bg-emerald-500/20 text-emerald-300 border border-emerald-500/30"
                                  : h.outcome === "FAILED"
                                  ? "bg-rose-500/15 text-rose-300 border border-rose-500/30"
                                  : "bg-zinc-500/20 text-zinc-300 border border-zinc-500/30"
                              }`}
                            >
                              {h.outcome === "PASSED" ? (
                                <CheckCircle2 className="w-3 h-3" />
                              ) : (
                                <XCircle className="w-3 h-3" />
                              )}
                              {h.outcome}
                            </span>
                          </td>
                          <td className="px-4 py-3 font-mono text-[11px] text-zinc-400 break-words max-w-sm align-top">
                            {h.evidence}
                          </td>
                        </tr>
                      ))
                    )}
                  </tbody>
                </table>
              </div>
            </div>
          </motion.div>
        )}
      </div>
    </div>
  );
};
