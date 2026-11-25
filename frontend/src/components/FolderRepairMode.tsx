import React, { useState } from "react";
import { motion } from "framer-motion";
import {
  AlertTriangle,
  Check,
  CheckCircle2,
  ChevronDown,
  ChevronRight,
  Download,
  FileCode2,
  FilePlus2,
  FolderOpen,
  Maximize2,
  Monitor,
  Play,
  RefreshCw,
  ShieldAlert,
  ShieldCheck,
  Terminal,
} from "lucide-react";
import type { FileDiffEntry, FolderRepairJob } from "../types/pillars";

interface FolderRepairModeProps {
  terminalOpen: boolean;
  onToggleTerminal: () => void;
  onPasteToTerminal?: (cmd: string) => void;
}

export const FolderRepairMode: React.FC<FolderRepairModeProps> = ({
  terminalOpen,
  onToggleTerminal,
  onPasteToTerminal,
}) => {
  const [folderPath, setFolderPath] = useState("C:\\Users\\User\\Downloads\\SILENTFIX");
  const [job, setJob] = useState<FolderRepairJob | null>(null);
  const [loading, setLoading] = useState(false);
  const [feedbackLoading, setFeedbackLoading] = useState(false);
  const [applyLoading, setApplyLoading] = useState(false);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);

  const [selectedFiles, setSelectedFiles] = useState<Set<string>>(new Set());
  const [expandedDiffs, setExpandedDiffs] = useState<Set<string>>(new Set());
  const [applyResult, setApplyResult] = useState<{
    applied_files: string[];
    backup_dir: string;
  } | null>(null);

  const handleStartRepair = async (e?: React.FormEvent) => {
    if (e) e.preventDefault();
    const cleaned = folderPath.trim();
    if (!cleaned) return;

    setLoading(true);
    setErrorMsg(null);
    setApplyResult(null);

    const screenWidth = Math.max(640, Math.min(7680, window.screen.width || 1920));
    const screenHeight = Math.max(480, Math.min(4320, window.screen.height || 1080));
    const dpiScale = Math.max(100, Math.min(300, Math.round((window.devicePixelRatio || 1) * 100)));

    try {
      const res = await fetch("/api/folder-repair/start", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          folder_path: cleaned,
          screen_width: screenWidth,
          screen_height: screenHeight,
          dpi_scale_percent: dpiScale,
        }),
      });
      const data = await res.json();
      if (!res.ok) {
        throw new Error(data.detail || "Folder repair failed to start");
      }
      const nextJob = data as FolderRepairJob;
      setJob(nextJob);
      setSelectedFiles(new Set());
      setExpandedDiffs(new Set());
    } catch (err: any) {
      setErrorMsg(err.message || "Failed to connect to folder repair API");
    } finally {
      setLoading(false);
    }
  };

  const handleDisplayFeedback = async (fitsScreen: boolean) => {
    if (!job) return;
    setFeedbackLoading(true);
    setErrorMsg(null);

    try {
      const res = await fetch(`/api/folder-repair/${job.job_id}/display-feedback`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ fits_screen: fitsScreen }),
      });
      const data = await res.json();
      if (!res.ok) {
        throw new Error(data.detail || "Display feedback request failed");
      }
      const nextJob = data as FolderRepairJob;
      setJob(nextJob);

      if (nextJob.status === "READY_TO_APPLY") {
        const changed = nextJob.file_diffs
          .filter((d) => d.status !== "unchanged")
          .map((d) => d.relative_path);
        setSelectedFiles(new Set(changed));
        if (changed.length > 0) {
          setExpandedDiffs(new Set([changed[0]]));
        }
      }
    } catch (err: any) {
      setErrorMsg(err.message || "Error sending display feedback");
    } finally {
      setFeedbackLoading(false);
    }
  };

  const toggleSelectFile = (relPath: string) => {
    setSelectedFiles((prev) => {
      const next = new Set(prev);
      if (next.has(relPath)) next.delete(relPath);
      else next.add(relPath);
      return next;
    });
  };

  const toggleExpandDiff = (relPath: string) => {
    setExpandedDiffs((prev) => {
      const next = new Set(prev);
      if (next.has(relPath)) next.delete(relPath);
      else next.add(relPath);
      return next;
    });
  };

  const handleApplySelectedDiff = async () => {
    if (!job || selectedFiles.size === 0) return;
    setApplyLoading(true);
    setErrorMsg(null);
    setApplyResult(null);

    try {
      const res = await fetch(`/api/folder-repair/${job.job_id}/apply-diff`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ selected_files: Array.from(selectedFiles) }),
      });
      const data = await res.json();
      if (!res.ok) {
        throw new Error(data.detail || "Failed to apply selective changes");
      }
      setApplyResult(data);
    } catch (err: any) {
      setErrorMsg(err.message || "Error applying changes");
    } finally {
      setApplyLoading(false);
    }
  };

  const changedDiffs: FileDiffEntry[] = job
    ? job.file_diffs.filter((d) => d.status !== "unchanged")
    : [];

  return (
    <div className="flex-1 flex flex-col min-w-0 bg-[#0B0D12] overflow-hidden">
      {/* Top Bar */}
      <header className="h-12 px-5 border-b border-white/10 flex items-center justify-between bg-[#0E1015]/80 shrink-0">
        <div className="flex items-center gap-2.5">
          <FolderOpen className="w-4 h-4 text-indigo-400" />
          <h1 className="text-sm font-semibold text-zinc-100">
            Pillar 1: Folder &amp; Legacy Repair
          </h1>
          <span className="rounded bg-indigo-500/10 border border-indigo-500/20 px-2 py-0.5 text-[10px] font-mono text-indigo-300">
            Parallel VM + Smart Diff
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
        {/* Launch Form */}
        <form
          onSubmit={handleStartRepair}
          className="rounded-xl border border-white/10 bg-white/[0.02] p-4 space-y-3"
        >
          <div className="flex items-center justify-between text-xs">
            <label className="font-medium text-zinc-200">
              Target Folder Path to Scan &amp; Sandbox-Verify
            </label>
            <span className="font-mono text-[11px] text-zinc-400">
              Auto-Display: {window.screen.width}x{window.screen.height} @{" "}
              {Math.max(100, Math.min(300, Math.round((window.devicePixelRatio || 1) * 100)))}%
            </span>
          </div>

          <div className="flex gap-2">
            <input
              type="text"
              value={folderPath}
              onChange={(e) => setFolderPath(e.target.value)}
              placeholder="C:\path\to\broken-or-legacy-app"
              className="flex-1 rounded-lg border border-white/10 bg-black/50 px-3 py-2 text-xs font-mono text-zinc-100 placeholder:text-zinc-600 focus:border-indigo-400 focus:outline-none"
            />
            <button
              type="submit"
              disabled={loading || !folderPath.trim()}
              className="flex items-center gap-2 rounded-lg bg-indigo-600 hover:bg-indigo-500 px-4 py-2 text-xs font-semibold text-white transition disabled:opacity-40 shrink-0"
            >
              {loading ? (
                <RefreshCw className="w-3.5 h-3.5 animate-spin" />
              ) : (
                <Play className="w-3.5 h-3.5" />
              )}
              <span>{loading ? "Booting Sandbox & Scanning..." : "Start Folder Repair"}</span>
            </button>
          </div>
        </form>

        {errorMsg && (
          <div className="rounded-xl border border-rose-500/30 bg-rose-950/20 p-3.5 flex items-center gap-2 text-xs text-rose-300">
            <ShieldAlert className="w-4 h-4 shrink-0 text-rose-400" />
            <span>{errorMsg}</span>
          </div>
        )}

        {/* Job Results */}
        {job && (
          <motion.div
            initial={{ opacity: 0, y: 8 }}
            animate={{ opacity: 1, y: 0 }}
            className="space-y-5"
          >
            {/* Status & Scan Summary */}
            <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
              <div className="rounded-xl border border-white/10 bg-white/[0.02] p-3.5 space-y-1">
                <span className="text-[10px] font-mono uppercase text-zinc-500">Job Status</span>
                <div className="flex items-center gap-2">
                  <span className="text-xs font-mono font-bold text-indigo-300">{job.status}</span>
                  <span className="text-[10px] font-mono text-zinc-500">#{job.job_id}</span>
                </div>
                <span className="text-[11px] font-mono text-zinc-400 block">
                  VM: {job.vm_backend} ({job.vm_instance_id})
                </span>
              </div>

              <div className="rounded-xl border border-white/10 bg-white/[0.02] p-3.5 space-y-1">
                <span className="text-[10px] font-mono uppercase text-zinc-500">
                  Defender Scan
                </span>
                <div className="flex items-center gap-1.5 text-xs font-semibold">
                  {job.malware_report?.clean ? (
                    <>
                      <ShieldCheck className="w-4 h-4 text-emerald-400" />
                      <span className="text-emerald-300">Clean (Exit 0)</span>
                    </>
                  ) : (
                    <>
                      <ShieldAlert className="w-4 h-4 text-rose-400" />
                      <span className="text-rose-300">Threat Flagged</span>
                    </>
                  )}
                </div>
                <span className="text-[11px] text-zinc-400 block truncate">
                  {job.malware_report?.summary}
                </span>
              </div>

              <div className="rounded-xl border border-white/10 bg-white/[0.02] p-3.5 space-y-1">
                <span className="text-[10px] font-mono uppercase text-zinc-500">
                  Detected Issues &amp; Deps
                </span>
                <div className="text-xs font-semibold text-zinc-200">
                  {job.issues.length} issue(s) &bull; {job.installed_dependencies.length} dep cmd(s)
                </div>
                <span className="text-[11px] font-mono text-zinc-400 block truncate">
                  {job.crash_log_tail || "Smoke test passed"}
                </span>
              </div>
            </div>

            {/* Issues / Dependencies List */}
            {(job.issues.length > 0 || job.installed_dependencies.length > 0) && (
              <div className="rounded-xl border border-white/10 bg-white/[0.02] p-4 space-y-3">
                <h2 className="text-xs font-semibold text-zinc-200 uppercase tracking-wider font-mono">
                  Scan Findings
                </h2>
                <div className="space-y-1.5">
                  {job.issues.map((iss, idx) => (
                    <div
                      key={idx}
                      className="flex items-center justify-between gap-3 rounded-lg border border-white/5 bg-black/40 px-3 py-2 text-xs"
                    >
                      <div className="flex items-center gap-2 min-w-0">
                        <AlertTriangle
                          className={`w-3.5 h-3.5 shrink-0 ${
                            iss.severity === "error" ? "text-rose-400" : "text-amber-400"
                          }`}
                        />
                        <span className="font-mono text-zinc-200 shrink-0">{iss.file}</span>
                        <span className="text-zinc-400 truncate">{iss.detail}</span>
                      </div>
                      <span className="rounded bg-white/5 px-2 py-0.5 text-[10px] font-mono text-zinc-400 shrink-0">
                        {iss.category}
                      </span>
                    </div>
                  ))}
                  {job.installed_dependencies.map((cmd, idx) => (
                    <div
                      key={`dep-${idx}`}
                      className="flex items-center justify-between gap-2 rounded-lg border border-indigo-500/20 bg-indigo-950/20 px-3 py-2 text-xs font-mono"
                    >
                      <span className="text-indigo-200 truncate">{cmd}</span>
                      {onPasteToTerminal && (
                        <button
                          type="button"
                          onClick={() => onPasteToTerminal(cmd)}
                          className="rounded border border-indigo-500/30 bg-indigo-500/10 hover:bg-indigo-500/20 px-2 py-0.5 text-[10px] text-indigo-300 shrink-0"
                        >
                          Paste to Terminal
                        </button>
                      )}
                    </div>
                  ))}
                </div>
              </div>
            )}

            {/* STEP A: Interactive Display Check Loop */}
            {job.status === "AWAITING_DISPLAY_CHECK" && job.display_preview && (
              <motion.div
                initial={{ opacity: 0, scale: 0.99 }}
                animate={{ opacity: 1, scale: 1 }}
                className="rounded-xl border border-indigo-500/30 bg-indigo-950/10 p-5 space-y-4"
              >
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <div className="flex items-center gap-2">
                    <Monitor className="w-4 h-4 text-indigo-400" />
                    <h3 className="text-sm font-semibold text-zinc-100">
                      VM Display Fit Verification (Iteration #{job.display_preview.iteration})
                    </h3>
                  </div>
                  <span className="rounded bg-indigo-500/20 border border-indigo-500/30 px-2.5 py-0.5 text-[11px] font-mono text-indigo-200">
                    Layer: {job.display_preview.applied_compat_layer}
                  </span>
                </div>

                <p className="text-xs text-zinc-300">{job.display_preview.notes}</p>

                <div className="rounded-lg border border-white/10 bg-black/70 p-3 flex flex-col items-center">
                  <div className="w-full flex items-center justify-between text-[11px] font-mono text-zinc-400 mb-2">
                    <span>
                      Target: {job.display_preview.target_width}x
                      {job.display_preview.target_height} @{" "}
                      {job.display_preview.dpi_scale_percent}% DPI
                    </span>
                    <span className="flex items-center gap-1 text-indigo-300">
                      <Maximize2 className="w-3 h-3" />
                      Sandbox Capture
                    </span>
                  </div>
                  <img
                    src={`${job.display_preview.preview_url}${
                      job.display_preview.preview_url.includes("?") ? "&" : "?"
                    }iter=${job.display_preview.iteration}`}
                    alt="VM Display Preview"
                    className="max-h-64 rounded border border-white/10 object-contain"
                  />
                </div>

                <div className="flex flex-wrap items-center justify-end gap-3 pt-1">
                  <button
                    type="button"
                    disabled={feedbackLoading}
                    onClick={() => handleDisplayFeedback(false)}
                    className="flex items-center gap-2 rounded-lg border border-amber-500/40 bg-amber-500/10 hover:bg-amber-500/20 px-4 py-2 text-xs font-semibold text-amber-200 transition disabled:opacity-40"
                  >
                    <RefreshCw
                      className={`w-3.5 h-3.5 ${feedbackLoading ? "animate-spin" : ""}`}
                    />
                    <span>Does Not Fit — Adjust &amp; Retry</span>
                  </button>

                  <button
                    type="button"
                    disabled={feedbackLoading}
                    onClick={() => handleDisplayFeedback(true)}
                    className="flex items-center gap-2 rounded-lg bg-emerald-600 hover:bg-emerald-500 px-4 py-2 text-xs font-semibold text-white transition disabled:opacity-40"
                  >
                    <CheckCircle2 className="w-3.5 h-3.5" />
                    <span>Fits My Screen</span>
                  </button>
                </div>
              </motion.div>
            )}

            {/* STEP B: Smart Diff Picker + Selective Apply + Zip Download */}
            {job.status === "READY_TO_APPLY" && (
              <motion.div
                initial={{ opacity: 0, y: 8 }}
                animate={{ opacity: 1, y: 0 }}
                className="rounded-xl border border-emerald-500/30 bg-emerald-950/10 p-5 space-y-4"
              >
                <div className="flex flex-wrap items-center justify-between gap-3">
                  <div>
                    <h3 className="text-sm font-semibold text-emerald-300 flex items-center gap-2">
                      <CheckCircle2 className="w-4 h-4" />
                      <span>Ready to Apply — Smart Diff Picker</span>
                    </h3>
                    <p className="text-xs text-zinc-400 mt-0.5">
                      Showing {changedDiffs.length} changed file(s) out of {job.file_diffs.length}{" "}
                      total verified bundle files.
                    </p>
                  </div>

                  <a
                    href={`/api/folder-repair/${job.job_id}/download-zip`}
                    download={`silentfix_verified_${job.job_id}.zip`}
                    className="flex items-center gap-1.5 rounded-lg border border-white/15 bg-white/5 hover:bg-white/10 px-3 py-1.5 text-xs font-semibold text-zinc-200 transition"
                  >
                    <Download className="w-3.5 h-3.5 text-indigo-400" />
                    <span>Download Full Verified Zip</span>
                  </a>
                </div>

                {/* Changed Files List */}
                <div className="space-y-2">
                  {changedDiffs.length === 0 ? (
                    <div className="rounded-lg border border-white/10 bg-black/40 p-4 text-xs text-zinc-400 text-center">
                      No local file modifications required.
                    </div>
                  ) : (
                    changedDiffs.map((diff) => {
                      const isChecked = selectedFiles.has(diff.relative_path);
                      const isExpanded = expandedDiffs.has(diff.relative_path);

                      return (
                        <div
                          key={diff.relative_path}
                          className="rounded-lg border border-white/10 bg-black/50 overflow-hidden"
                        >
                          <div className="flex items-center justify-between gap-3 px-3 py-2.5">
                            <label className="flex items-center gap-2.5 cursor-pointer min-w-0 flex-1">
                              <input
                                type="checkbox"
                                checked={isChecked}
                                onChange={() => toggleSelectFile(diff.relative_path)}
                                className="rounded border-white/20 bg-black text-indigo-500 focus:ring-indigo-500"
                              />
                              {diff.status === "added" ? (
                                <FilePlus2 className="w-3.5 h-3.5 text-emerald-400 shrink-0" />
                              ) : (
                                <FileCode2 className="w-3.5 h-3.5 text-amber-400 shrink-0" />
                              )}
                              <span className="font-mono text-xs text-zinc-200 truncate">
                                {diff.relative_path}
                              </span>
                            </label>

                            <div className="flex items-center gap-2 shrink-0">
                              <span
                                className={`rounded px-2 py-0.5 text-[10px] font-mono uppercase font-semibold ${
                                  diff.status === "added"
                                    ? "bg-emerald-500/15 text-emerald-300 border border-emerald-500/30"
                                    : "bg-amber-500/15 text-amber-300 border border-amber-500/30"
                                }`}
                              >
                                {diff.status}
                              </span>
                              <span className="text-[10px] font-mono text-zinc-500">
                                {diff.size_bytes} B
                              </span>
                              {diff.unified_diff && (
                                <button
                                  type="button"
                                  onClick={() => toggleExpandDiff(diff.relative_path)}
                                  className="flex items-center gap-1 rounded border border-white/10 bg-white/5 hover:bg-white/10 px-2 py-0.5 text-[10px] font-mono text-zinc-300"
                                >
                                  {isExpanded ? (
                                    <ChevronDown className="w-3 h-3" />
                                  ) : (
                                    <ChevronRight className="w-3 h-3" />
                                  )}
                                  <span>Diff</span>
                                </button>
                              )}
                            </div>
                          </div>

                          {isExpanded && diff.unified_diff && (
                            <div className="border-t border-white/10 bg-[#07080B] p-3 overflow-x-auto">
                              <pre className="text-[11px] font-mono text-zinc-300 whitespace-pre">
                                {diff.unified_diff}
                              </pre>
                            </div>
                          )}
                        </div>
                      );
                    })
                  )}
                </div>

                {applyResult && (
                  <div className="rounded-lg border border-emerald-500/30 bg-emerald-950/30 p-3 text-xs text-emerald-200 space-y-1">
                    <div className="flex items-center gap-1.5 font-semibold">
                      <Check className="w-4 h-4 text-emerald-400" />
                      <span>
                        Applied {applyResult.applied_files.length} file(s) safely.
                      </span>
                    </div>
                    <div className="font-mono text-[11px] text-emerald-300/80">
                      Backup saved to: {applyResult.backup_dir}
                    </div>
                  </div>
                )}

                <div className="flex justify-end pt-1">
                  <button
                    type="button"
                    disabled={applyLoading || selectedFiles.size === 0}
                    onClick={handleApplySelectedDiff}
                    className="flex items-center gap-2 rounded-lg bg-indigo-600 hover:bg-indigo-500 px-4 py-2 text-xs font-semibold text-white transition disabled:opacity-40"
                  >
                    <Check className="w-3.5 h-3.5" />
                    <span>
                      {applyLoading
                        ? "Patching Selected Files..."
                        : `Apply Selected Changes Only (${selectedFiles.size})`}
                    </span>
                  </button>
                </div>
              </motion.div>
            )}
          </motion.div>
        )}
      </div>
    </div>
  );
};
