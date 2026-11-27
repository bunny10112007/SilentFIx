// frontend/src/components/CliIsolatorPanel.tsx
import React, { useState } from "react";
import { motion } from "framer-motion";
import {
  AlertTriangle,
  ArrowRight,
  Check,
  CheckCircle2,
  ChevronDown,
  ChevronRight,
  Copy,
  Cpu,
  Loader2,
  Play,
  ShieldCheck,
  Terminal,
  Wrench,
  XCircle,
} from "lucide-react";
import type { CliIsolationReport } from "../types/pillars";

const SAMPLE_ERRORS = [
  {
    label: "'git' not recognized",
    text: "git : The term 'git' is not recognized as the name of a cmdlet, function, script file, or operable program.",
  },
  {
    label: "'pytest' not recognized",
    text: "'pytest' is not recognized as an internal or external command, operable program or batch file.",
  },
  {
    label: "'node' not recognized",
    text: "node : The term 'node' is not recognized as the name of a cmdlet, function, script file, or operable program.",
  },
];

interface CliIsolatorPanelProps {
  activeFolder: string | null;
  onPasteToTerminal: (cmd: string) => void;
  onRunInTerminal: (cmd: string) => void;
}

export const CliIsolatorPanel: React.FC<CliIsolatorPanelProps> = ({
  activeFolder,
  onPasteToTerminal,
  onRunInTerminal,
}) => {
  const [errorText, setErrorText] = useState("");
  const [projectDir, setProjectDir] = useState(activeFolder ?? "");
  const [report, setReport] = useState<CliIsolationReport | null>(null);
  const [isIsolating, setIsIsolating] = useState(false);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const [copiedCmd, setCopiedCmd] = useState<string | null>(null);
  const [showSnapshot, setShowSnapshot] = useState(false);

  const handleCopy = async (cmd: string) => {
    await navigator.clipboard.writeText(cmd);
    setCopiedCmd(cmd);
    window.setTimeout(() => setCopiedCmd(null), 1500);
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    const cleaned = errorText.trim();
    if (!cleaned || isIsolating) return;

    setErrorMsg(null);
    setIsIsolating(true);
    try {
      const res = await fetch("/api/cli-isolator/isolate", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          error_text: cleaned,
          project_dir: projectDir.trim() || null,
        }),
      });
      if (!res.ok) {
        const body = (await res.json().catch(() => ({}))) as { detail?: string };
        throw new Error(body.detail || `Isolation failed (HTTP ${res.status})`);
      }
      const data = (await res.json()) as CliIsolationReport;
      setReport(data);
    } catch (err) {
      setErrorMsg(err instanceof Error ? err.message : "Could not reach /api/cli-isolator/isolate.");
    } finally {
      setIsIsolating(false);
    }
  };

  return (
    <div className="flex-1 overflow-y-auto px-6 py-6 bg-[#0B0D12]">
      <div className="max-w-3xl mx-auto space-y-5">
        <div className="space-y-1">
          <h1 className="text-lg font-semibold text-zinc-100 flex items-center gap-2">
            <Wrench className="w-5 h-5 text-indigo-400" />
            Broken CLI Root-Cause Isolator
          </h1>
          <p className="text-xs text-zinc-400">
            Paste your exact terminal error. SilentFix mirrors your CLI environment, tests every possible
            failure cause empirically, and outputs only the command that passed verification.
          </p>
        </div>

        <form
          onSubmit={handleSubmit}
          className="rounded-xl bg-[#11141C] border border-white/10 p-4 space-y-3"
        >
          <div className="flex flex-wrap items-center justify-between gap-2">
            <label className="text-xs font-medium text-zinc-300">Pasted Terminal Error</label>
            <div className="flex flex-wrap gap-1.5">
              {SAMPLE_ERRORS.map((sample) => (
                <button
                  key={sample.label}
                  type="button"
                  onClick={() => setErrorText(sample.text)}
                  className="px-2 py-0.5 rounded-md bg-white/5 hover:bg-white/10 border border-white/10 text-[11px] text-zinc-300 transition"
                >
                  {sample.label}
                </button>
              ))}
            </div>
          </div>

          <textarea
            rows={4}
            value={errorText}
            onChange={(e) => setErrorText(e.target.value)}
            placeholder="Paste the exact red error output from PowerShell or CMD..."
            className="w-full rounded-lg bg-[#090B0F] border border-white/10 p-3 font-mono text-xs text-zinc-100 placeholder:text-zinc-600 focus:outline-none focus:border-indigo-400 resize-y"
          />

          <div className="flex flex-col sm:flex-row gap-2">
            <input
              type="text"
              value={projectDir}
              onChange={(e) => setProjectDir(e.target.value)}
              placeholder="Optional project folder (checks local .venv and node_modules/.bin)"
              className="flex-1 rounded-lg bg-[#090B0F] border border-white/10 px-3 py-2 font-mono text-xs text-zinc-200 placeholder:text-zinc-600 focus:outline-none focus:border-indigo-400"
            />
            <button
              type="submit"
              disabled={isIsolating || errorText.trim().length < 3}
              className="inline-flex items-center justify-center gap-2 px-4 py-2 rounded-lg bg-indigo-500 hover:bg-indigo-400 disabled:opacity-40 text-xs font-medium text-white transition shrink-0"
            >
              {isIsolating ? (
                <>
                  <Loader2 className="w-3.5 h-3.5 animate-spin" />
                  Testing Hypotheses...
                </>
              ) : (
                <>
                  <Cpu className="w-3.5 h-3.5" />
                  Mirror &amp; Isolate Root Cause
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

        {report && (
          <motion.div
            initial={{ opacity: 0, y: 10 }}
            animate={{ opacity: 1, y: 0 }}
            className="space-y-4"
          >
            {/* Exact Root Cause Verdict */}
            <div
              className={`rounded-xl border p-4 space-y-3 ${
                report.empirically_verified
                  ? "bg-emerald-500/5 border-emerald-500/30"
                  : "bg-amber-500/5 border-amber-500/30"
              }`}
            >
              <div className="flex flex-wrap items-center justify-between gap-2">
                <div className="flex items-center gap-2">
                  {report.empirically_verified ? (
                    <ShieldCheck className="w-4 h-4 text-emerald-400" />
                  ) : (
                    <AlertTriangle className="w-4 h-4 text-amber-400" />
                  )}
                  <h2 className="text-xs font-semibold text-zinc-100">
                    {report.empirically_verified
                      ? "Exact Root Cause Isolated (Zero Guesswork)"
                      : "No Automated Hypothesis Passed"}
                  </h2>
                </div>
                <span className="px-2 py-0.5 rounded-full bg-white/5 border border-white/10 text-[11px] text-zinc-300">
                  Mirror: {report.mirror_backend.replace(/_/g, " ")}
                </span>
              </div>

              <p className="text-sm text-zinc-200">{report.exact_root_cause}</p>

              {report.exact_fix_commands.length > 0 && (
                <div className="space-y-2 pt-1">
                  <p className="text-[11px] font-medium uppercase tracking-wider text-zinc-400">
                    Verified Fix Commands (Run in Order)
                  </p>
                  {report.exact_fix_commands.map((cmd, idx) => (
                    <div
                      key={`${cmd}-${idx}`}
                      className="rounded-lg bg-[#090B0F] border border-white/10 p-3 flex flex-col sm:flex-row sm:items-center justify-between gap-3"
                    >
                      <div className="flex items-start gap-2 min-w-0">
                        <span className="text-[11px] font-mono text-zinc-500 mt-0.5">{idx + 1}.</span>
                        <code className="font-mono text-xs text-indigo-200 break-all">{cmd}</code>
                      </div>
                      <div className="flex items-center gap-1.5 shrink-0">
                        <button
                          type="button"
                          onClick={() => void handleCopy(cmd)}
                          className="inline-flex items-center gap-1 px-2.5 py-1 rounded-md bg-white/5 hover:bg-white/10 text-xs text-zinc-200 transition"
                        >
                          {copiedCmd === cmd ? (
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
                          onClick={() => onPasteToTerminal(cmd)}
                          className="inline-flex items-center gap-1 px-2.5 py-1 rounded-md bg-white/5 hover:bg-white/10 text-xs text-zinc-200 transition"
                        >
                          Paste
                          <ArrowRight className="w-3.5 h-3.5" />
                        </button>
                        <button
                          type="button"
                          onClick={() => onRunInTerminal(cmd)}
                          className="inline-flex items-center gap-1 px-2.5 py-1 rounded-md bg-indigo-500 hover:bg-indigo-400 text-xs font-medium text-white transition"
                        >
                          <Play className="w-3 h-3" />
                          Run
                        </button>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>

            {/* Hypothesis Testing Matrix */}
            <div className="rounded-xl bg-[#11141C] border border-white/10 p-4 space-y-3">
              <h3 className="text-xs font-semibold text-zinc-100">
                Empirical Hypothesis Matrix ({report.tested_hypotheses.length} Tested)
              </h3>
              <div className="space-y-2">
                {report.tested_hypotheses.map((h) => (
                  <div
                    key={h.hypothesis_id}
                    className="rounded-lg bg-[#090B0F] border border-white/10 p-3 space-y-1.5"
                  >
                    <div className="flex items-center justify-between gap-2">
                      <div className="flex items-center gap-2">
                        {h.outcome === "PASSED" ? (
                          <CheckCircle2 className="w-4 h-4 text-emerald-400 shrink-0" />
                        ) : (
                          <XCircle className="w-4 h-4 text-zinc-500 shrink-0" />
                        )}
                        <span className="text-xs font-medium text-zinc-100">{h.cause_title}</span>
                      </div>
                      <span
                        className={`px-2 py-0.5 rounded-full text-[10px] font-semibold uppercase ${
                          h.outcome === "PASSED"
                            ? "bg-emerald-500/15 text-emerald-300 border border-emerald-500/30"
                            : "bg-white/5 text-zinc-400 border border-white/10"
                        }`}
                      >
                        {h.outcome}
                      </span>
                    </div>
                    <div className="pl-6 text-[11px] font-mono text-zinc-400 space-y-0.5">
                      <div>Probe: {h.verification_probe}</div>
                      <div className="text-zinc-500 break-words">Evidence: {h.evidence}</div>
                    </div>
                  </div>
                ))}
              </div>
            </div>

            {/* Collapsible Environment Snapshot */}
            <div className="rounded-xl bg-[#11141C] border border-white/10 overflow-hidden">
              <button
                type="button"
                onClick={() => setShowSnapshot((v) => !v)}
                className="w-full px-4 py-3 flex items-center justify-between text-xs font-medium text-zinc-300 hover:text-zinc-100"
              >
                <span className="flex items-center gap-2">
                  <Terminal className="w-3.5 h-3.5 text-zinc-400" />
                  Captured Sanitized CLI Snapshot
                </span>
                {showSnapshot ? (
                  <ChevronDown className="w-4 h-4 text-zinc-500" />
                ) : (
                  <ChevronRight className="w-4 h-4 text-zinc-500" />
                )}
              </button>
              {showSnapshot && (
                <div className="px-4 pb-4 pt-1 border-t border-white/10 font-mono text-[11px] text-zinc-400 space-y-1">
                  <div>Missing Command: {report.snapshot.missing_command ?? "none"}</div>
                  <div>Platform: {report.snapshot.shell_platform}</div>
                  <div>Found on Disk: {report.snapshot.tool_on_disk ?? "none"}</div>
                  <div>Local Venv/Node Bin: {report.snapshot.in_local_venv_or_node ?? "none"}</div>
                  <div>PATH Entries Captured: {report.snapshot.current_path_entries.length}</div>
                </div>
              )}
            </div>
          </motion.div>
        )}
      </div>
    </div>
  );
};
