// frontend/src/components/FolderRepairPanel.tsx
import React, { useMemo, useState } from "react";
import { AnimatePresence, motion } from "framer-motion";
import {
  AlertTriangle,
  ArrowRight,
  Check,
  CheckCircle2,
  ChevronDown,
  ChevronRight,
  Cloud,
  Download,
  FileDiff,
  FolderOpen,
  Loader2,
  Monitor,
  Play,
  RefreshCw,
  ShieldAlert,
  ShieldCheck,
  XCircle,
} from "lucide-react";
import type { FolderRepairJob, SelectiveApplyResult } from "../types/pillars";

interface FolderRepairPanelProps {
  onSelectWorkingDir: (folderPath: string) => void;
  onPasteToTerminal: (cmd: string) => void;
  onRunInTerminal: (cmd: string) => void;
}

function getClampedScreenMetrics() {
  const width = Math.min(7680, Math.max(640, Math.round(window.screen.width || 1920)));
  const height = Math.min(4320, Math.max(480, Math.round(window.screen.height || 1080)));
  const dpi = Math.min(300, Math.max(100, Math.round((window.devicePixelRatio || 1) * 100)));
  return { width, height, dpi };
}

export const FolderRepairPanel: React.FC<FolderRepairPanelProps> = ({
  onSelectWorkingDir,
  onPasteToTerminal,
  onRunInTerminal,
}) => {
  const screenMetrics = useMemo(getClampedScreenMetrics, []);

  const [folderPath, setFolderPath] = useState("");
  const [job, setJob] = useState<FolderRepairJob | null>(null);
  const [isScanning, setIsScanning] = useState(false);
  const [isSendingDisplay, setIsSendingDisplay] = useState(false);
  const [isApplying, setIsApplying] = useState(false);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);

  const [selectedFiles, setSelectedFiles] = useState<Set<string>>(new Set());
  const [expandedDiffs, setExpandedDiffs] = useState<Set<string>>(new Set());
  const [showUnchanged, setShowUnchanged] = useState(false);
  const [applyResult, setApplyResult] = useState<SelectiveApplyResult | null>(null);

  const handleStartRepair = async (e: React.FormEvent) => {
    e.preventDefault();
    const cleaned = folderPath.trim();
    if (!cleaned || isScanning) return;

    setErrorMsg(null);
    setApplyResult(null);
    setIsScanning(true);

    try {
      const res = await fetch("/api/folder-repair/start", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          folder_path: cleaned,
          screen_width: screenMetrics.width,
          screen_height: screenMetrics.height,
          dpi_scale_percent: screenMetrics.dpi,
        }),
      });
      if (!res.ok) {
        const body = (await res.json().catch(() => ({}))) as { detail?: string };
        throw new Error(body.detail || `Folder scan failed (HTTP ${res.status})`);
      }
      const data = (await res.json()) as FolderRepairJob;
      setJob(data);
      onSelectWorkingDir(data.source_folder);
    } catch (err) {
      setErrorMsg(err instanceof Error ? err.message : "Could not reach /api/folder-repair/start.");
    } finally {
      setIsScanning(false);
    }
  };

  const handleDisplayFeedback = async (fitsScreen: boolean) => {
    if (!job || isSendingDisplay) return;
    setErrorMsg(null);
    setIsSendingDisplay(true);

    try {
      const res = await fetch(`/api/folder-repair/${job.job_id}/display-feedback`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ fits_screen: fitsScreen }),
      });
      if (!res.ok) {
        const body = (await res.json().catch(() => ({}))) as { detail?: string };
        throw new Error(body.detail || `Display feedback failed (HTTP ${res.status})`);
      }
      const updated = (await res.json()) as FolderRepairJob;
      setJob(updated);

      if (updated.status === "READY_TO_APPLY") {
        const changed = updated.file_diffs
          .filter((d) => d.status !== "unchanged")
          .map((d) => d.relative_path);
        setSelectedFiles(new Set(changed));
        setExpandedDiffs(new Set(changed.slice(0, 3)));
      }
    } catch (err) {
      setErrorMsg(err instanceof Error ? err.message : "Failed to update display resolution check.");
    } finally {
      setIsSendingDisplay(false);
    }
  };

  const handleApplySelected = async () => {
    if (!job || selectedFiles.size === 0 || isApplying) return;
    setErrorMsg(null);
    setIsApplying(true);

    try {
      const res = await fetch(`/api/folder-repair/${job.job_id}/apply-diff`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ selected_files: Array.from(selectedFiles) }),
      });
      if (!res.ok) {
        const body = (await res.json().catch(() => ({}))) as { detail?: string };
        throw new Error(body.detail || `Selective patch failed (HTTP ${res.status})`);
      }
      const result = (await res.json()) as SelectiveApplyResult;
      setApplyResult(result);
    } catch (err) {
      setErrorMsg(err instanceof Error ? err.message : "Could not apply selected diff files.");
    } finally {
      setIsApplying(false);
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

  const changedDiffs = job?.file_diffs.filter((d) => d.status !== "unchanged") ?? [];
  const visibleDiffs = showUnchanged ? job?.file_diffs ?? [] : changedDiffs;

  return (
    <div className="flex-1 overflow-y-auto px-6 py-6 bg-[#0B0D12]">
      <div className="max-w-3xl mx-auto space-y-5">
        <div className="space-y-1">
          <div className="flex items-center justify-between gap-2">
            <h1 className="text-lg font-semibold text-zinc-100 flex items-center gap-2">
              <FolderOpen className="w-5 h-5 text-indigo-400" />
              Broken &amp; Legacy Folder Repair
            </h1>
            <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full bg-white/5 border border-white/10 text-[11px] text-zinc-300">
              <Monitor className="w-3.5 h-3.5 text-indigo-400" />
              Host Display: {screenMetrics.width}x{screenMetrics.height} @ {screenMetrics.dpi}%
            </span>
          </div>
          <p className="text-xs text-zinc-400">
            Scans missing dependencies and crash logs, packages a staging zip in parallel with an AWS Windows VM,
            verifies malware/crashes and display fit, then applies only changed files or downloads the full zip.
          </p>
        </div>

        <form
          onSubmit={handleStartRepair}
          className="rounded-xl bg-[#11141C] border border-white/10 p-4 space-y-3"
        >
          <label className="block text-xs font-medium text-zinc-300">
            Local Folder Path to Inspect &amp; Pre-Test in AWS Sandbox
          </label>
          <div className="flex gap-2">
            <input
              type="text"
              value={folderPath}
              onChange={(e) => setFolderPath(e.target.value)}
              placeholder="C:\Users\User\Downloads\legacy-app"
              className="flex-1 rounded-lg bg-[#090B0F] border border-white/10 px-3 py-2 text-xs font-mono text-zinc-100 placeholder:text-zinc-600 focus:outline-none focus:border-indigo-400"
            />
            <button
              type="submit"
              disabled={isScanning || !folderPath.trim()}
              className="inline-flex items-center gap-2 px-4 py-2 rounded-lg bg-indigo-500 hover:bg-indigo-400 disabled:opacity-40 text-xs font-medium text-white transition shrink-0"
            >
              {isScanning ? (
                <>
                  <Loader2 className="w-3.5 h-3.5 animate-spin" />
                  Booting VM &amp; Scanning...
                </>
              ) : (
                <>
                  <Cloud className="w-3.5 h-3.5" />
                  Scan &amp; Launch VM Test
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

        <AnimatePresence mode="wait">
          {job && (
            <motion.div
              key={job.job_id}
              initial={{ opacity: 0, y: 10 }}
              animate={{ opacity: 1, y: 0 }}
              className="space-y-4"
            >
              {/* Status & Cloud VM Telemetry Strip */}
              <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
                <div className="rounded-xl bg-[#11141C] border border-white/10 p-3.5 space-y-1">
                  <span className="text-[11px] text-zinc-500 uppercase tracking-wider">VM Sandbox</span>
                  <div className="flex items-center gap-1.5 text-xs font-medium text-zinc-100">
                    <Cloud className="w-3.5 h-3.5 text-indigo-400" />
                    <span>{job.vm_backend === "aws_ec2_ssm" ? "AWS EC2 Windows" : "Local Mock VM"}</span>
                  </div>
                  <p className="text-[11px] font-mono text-zinc-400 truncate">
                    {job.vm_instance_id ?? job.job_id}
                  </p>
                </div>

                <div className="rounded-xl bg-[#11141C] border border-white/10 p-3.5 space-y-1">
                  <span className="text-[11px] text-zinc-500 uppercase tracking-wider">Malware Scan</span>
                  <div className="flex items-center gap-1.5 text-xs font-medium">
                    {job.malware_report?.clean ? (
                      <>
                        <ShieldCheck className="w-3.5 h-3.5 text-emerald-400" />
                        <span className="text-emerald-300">Clean (Exit 0)</span>
                      </>
                    ) : (
                      <>
                        <ShieldAlert className="w-3.5 h-3.5 text-rose-400" />
                        <span className="text-rose-300">Threat Blocked</span>
                      </>
                    )}
                  </div>
                  <p className="text-[11px] text-zinc-400 truncate">
                    {job.malware_report?.engine ?? "Pending"}
                  </p>
                </div>

                <div className="rounded-xl bg-[#11141C] border border-white/10 p-3.5 space-y-1">
                  <span className="text-[11px] text-zinc-500 uppercase tracking-wider">Crash Harness</span>
                  <div className="flex items-center gap-1.5 text-xs font-medium">
                    {job.crash_test_passed ? (
                      <>
                        <CheckCircle2 className="w-3.5 h-3.5 text-emerald-400" />
                        <span className="text-emerald-300">Smoke Test Passed</span>
                      </>
                    ) : (
                      <>
                        <AlertTriangle className="w-3.5 h-3.5 text-amber-400" />
                        <span className="text-amber-300">Crash Detected</span>
                      </>
                    )}
                  </div>
                  <p className="text-[11px] text-zinc-400 truncate">{job.crash_log_tail}</p>
                </div>
              </div>

              {/* Detected Issues & Bundled Dependencies */}
              <div className="rounded-xl bg-[#11141C] border border-white/10 p-4 space-y-3">
                <div className="flex items-center justify-between">
                  <h2 className="text-xs font-semibold text-zinc-100">
                    Folder Audit Findings ({job.issues.length})
                  </h2>
                  <span className="text-[11px] font-mono text-zinc-500">{job.source_folder}</span>
                </div>

                {job.issues.length === 0 ? (
                  <p className="text-xs text-emerald-300">
                    No missing manifests or crash signatures found in this folder.
                  </p>
                ) : (
                  <ul className="space-y-2">
                    {job.issues.map((issue, idx) => (
                      <li
                        key={`${issue.file}-${idx}`}
                        className="rounded-lg bg-[#090B0F] border border-white/10 px-3 py-2 flex items-start justify-between gap-3 text-xs"
                      >
                        <div className="space-y-0.5">
                          <span className="font-mono text-indigo-300">{issue.file}</span>
                          <p className="text-zinc-300">{issue.detail}</p>
                        </div>
                        <span
                          className={`px-2 py-0.5 rounded-full text-[10px] font-medium uppercase shrink-0 ${
                            issue.severity === "error"
                              ? "bg-rose-500/15 text-rose-300 border border-rose-500/30"
                              : "bg-amber-500/15 text-amber-300 border border-amber-500/30"
                          }`}
                        >
                          {issue.category.replace("_", " ")}
                        </span>
                      </li>
                    ))}
                  </ul>
                )}

                {job.installed_dependencies.length > 0 && (
                  <div className="pt-2 border-t border-white/10 space-y-2">
                    <p className="text-[11px] font-medium text-zinc-400">
                      Dependency Restoration Commands (Send to PowerShell Terminal if needed):
                    </p>
                    {job.installed_dependencies.map((cmd) => (
                      <div
                        key={cmd}
                        className="rounded-lg bg-[#090B0F] border border-white/10 px-3 py-2 flex items-center justify-between gap-2"
                      >
                        <code className="font-mono text-xs text-indigo-200">{cmd}</code>
                        <div className="flex items-center gap-1.5">
                          <button
                            type="button"
                            onClick={() => onPasteToTerminal(cmd)}
                            className="inline-flex items-center gap-1 px-2 py-1 rounded bg-white/5 hover:bg-white/10 text-[11px] text-zinc-200"
                          >
                            Paste
                            <ArrowRight className="w-3 h-3" />
                          </button>
                          <button
                            type="button"
                            onClick={() => onRunInTerminal(cmd)}
                            className="inline-flex items-center gap-1 px-2 py-1 rounded bg-indigo-500 hover:bg-indigo-400 text-[11px] text-white"
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

              {/* Interactive Display Resolution Approval Loop */}
              {job.status === "AWAITING_DISPLAY_CHECK" && job.display_preview && (
                <div className="rounded-xl bg-[#11141C] border border-indigo-500/30 p-4 space-y-4">
                  <div className="flex items-center justify-between gap-2">
                    <div className="flex items-center gap-2">
                      <Monitor className="w-4 h-4 text-indigo-400" />
                      <h2 className="text-xs font-semibold text-zinc-100">
                        Display &amp; Resolution Fit Check (Iteration #{job.display_preview.iteration})
                      </h2>
                    </div>
                    <span className="px-2 py-0.5 rounded bg-indigo-500/15 border border-indigo-400/30 font-mono text-[11px] text-indigo-200">
                      {job.display_preview.applied_compat_layer}
                    </span>
                  </div>

                  {/* Viewport Aspect & DPI Frame Preview */}
                  <div className="rounded-lg bg-[#090B0F] border border-white/10 p-4 space-y-2">
                    <div className="flex items-center justify-between text-[11px] text-zinc-400">
                      <span>
                        Target Viewport: {job.display_preview.target_width} x{" "}
                        {job.display_preview.target_height} ({job.display_preview.dpi_scale_percent}% DPI)
                      </span>
                      <span className="text-emerald-300">VM Render Ready</span>
                    </div>
                    <div className="h-36 rounded-md border border-dashed border-indigo-400/30 bg-indigo-950/20 flex flex-col items-center justify-center text-center px-4 space-y-1.5">
                      <Monitor className="w-7 h-7 text-indigo-300" />
                      <p className="text-xs font-medium text-zinc-200">{job.display_preview.notes}</p>
                      <p className="text-[11px] text-zinc-500">
                        Does the app layout fit cleanly inside your {job.display_preview.target_width}x
                        {job.display_preview.target_height} screen without clipping or blur?
                      </p>
                    </div>
                  </div>

                  <div className="flex flex-wrap items-center gap-2.5">
                    <button
                      type="button"
                      disabled={isSendingDisplay}
                      onClick={() => void handleDisplayFeedback(true)}
                      className="inline-flex items-center gap-1.5 px-4 py-2 rounded-lg bg-emerald-600 hover:bg-emerald-500 disabled:opacity-40 text-xs font-medium text-white transition"
                    >
                      {isSendingDisplay ? (
                        <Loader2 className="w-3.5 h-3.5 animate-spin" />
                      ) : (
                        <Check className="w-3.5 h-3.5" />
                      )}
                      Yes, Fits My Screen — Build Verified Zip &amp; Diff
                    </button>

                    <button
                      type="button"
                      disabled={isSendingDisplay}
                      onClick={() => void handleDisplayFeedback(false)}
                      className="inline-flex items-center gap-1.5 px-4 py-2 rounded-lg bg-white/5 hover:bg-white/10 border border-white/10 disabled:opacity-40 text-xs font-medium text-zinc-200 transition"
                    >
                      <RefreshCw className="w-3.5 h-3.5 text-amber-300" />
                      Does Not Fit — Adjust Scaling &amp; Retest in VM
                    </button>
                  </div>
                </div>
              )}

              {/* Smart Diff Comparison & Full Zip Download */}
              {job.status === "READY_TO_APPLY" && (
                <div className="rounded-xl bg-[#11141C] border border-emerald-500/30 p-4 space-y-4">
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <div className="space-y-0.5">
                      <h2 className="text-xs font-semibold text-zinc-100 flex items-center gap-1.5">
                        <FileDiff className="w-4 h-4 text-emerald-400" />
                        Verified Package Ready — Compare &amp; Apply Only Required Changes
                      </h2>
                      <p className="text-[11px] text-zinc-400">
                        {changedDiffs.length} changed/added file(s) out of {job.file_diffs.length} total.
                        Existing files are backed up automatically before patching.
                      </p>
                    </div>

                    <div className="flex items-center gap-2">
                      <label className="inline-flex items-center gap-1.5 text-[11px] text-zinc-400 cursor-pointer">
                        <input
                          type="checkbox"
                          checked={showUnchanged}
                          onChange={(e) => setShowUnchanged(e.target.checked)}
                          className="accent-indigo-500"
                        />
                        Show unchanged
                      </label>
                      <a
                        href={`/api/folder-repair/${job.job_id}/download-zip`}
                        download
                        className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-white/5 hover:bg-white/10 border border-white/10 text-xs font-medium text-zinc-200 transition"
                      >
                        <Download className="w-3.5 h-3.5" />
                        Download Full Zip
                      </a>
                    </div>
                  </div>

                  <div className="space-y-2 max-h-80 overflow-y-auto pr-1">
                    {visibleDiffs.map((entry) => {
                      const isChecked = selectedFiles.has(entry.relative_path);
                      const isExpanded = expandedDiffs.has(entry.relative_path);
                      return (
                        <div
                          key={entry.relative_path}
                          className="rounded-lg bg-[#090B0F] border border-white/10 overflow-hidden"
                        >
                          <div className="px-3 py-2 flex items-center justify-between gap-2 text-xs">
                            <div className="flex items-center gap-2 min-w-0">
                              <input
                                type="checkbox"
                                disabled={entry.status === "unchanged"}
                                checked={isChecked}
                                onChange={() => toggleSelectFile(entry.relative_path)}
                                className="accent-indigo-500"
                              />
                              <button
                                type="button"
                                onClick={() => toggleExpandDiff(entry.relative_path)}
                                className="flex items-center gap-1 font-mono text-zinc-200 truncate hover:text-white"
                              >
                                {entry.unified_diff ? (
                                  isExpanded ? (
                                    <ChevronDown className="w-3.5 h-3.5 text-zinc-500 shrink-0" />
                                  ) : (
                                    <ChevronRight className="w-3.5 h-3.5 text-zinc-500 shrink-0" />
                                  )
                                ) : null}
                                <span className="truncate">{entry.relative_path}</span>
                              </button>
                            </div>
                            <div className="flex items-center gap-2 shrink-0">
                              <span className="text-[11px] text-zinc-500">
                                {(entry.size_bytes / 1024).toFixed(1)} KB
                              </span>
                              <span
                                className={`px-2 py-0.5 rounded-full text-[10px] font-medium uppercase ${
                                  entry.status === "added"
                                    ? "bg-emerald-500/15 text-emerald-300"
                                    : entry.status === "modified"
                                    ? "bg-indigo-500/15 text-indigo-300"
                                    : "bg-white/5 text-zinc-500"
                                }`}
                              >
                                {entry.status}
                              </span>
                            </div>
                          </div>

                          {isExpanded && entry.unified_diff && (
                            <pre className="px-3 py-2.5 border-t border-white/10 bg-black/40 font-mono text-[11px] overflow-x-auto leading-relaxed">
                              {entry.unified_diff.split("\n").map((line, i) => (
                                <div
                                  key={i}
                                  className={
                                    line.startsWith("+")
                                      ? "text-emerald-300"
                                      : line.startsWith("-")
                                      ? "text-rose-300"
                                      : "text-zinc-400"
                                  }
                                >
                                  {line}
                                </div>
                              ))}
                            </pre>
                          )}
                        </div>
                      );
                    })}
                  </div>

                  <div className="flex items-center justify-between pt-2 border-t border-white/10">
                    <span className="text-xs text-zinc-400">
                      {selectedFiles.size} file(s) selected for incremental update
                    </span>
                    <button
                      type="button"
                      disabled={selectedFiles.size === 0 || isApplying}
                      onClick={() => void handleApplySelected()}
                      className="inline-flex items-center gap-1.5 px-4 py-2 rounded-lg bg-indigo-500 hover:bg-indigo-400 disabled:opacity-40 text-xs font-medium text-white transition"
                    >
                      {isApplying ? (
                        <Loader2 className="w-3.5 h-3.5 animate-spin" />
                      ) : (
                        <CheckCircle2 className="w-3.5 h-3.5" />
                      )}
                      Apply Selected Changes Only
                    </button>
                  </div>

                  {applyResult && (
                    <div className="rounded-lg bg-emerald-500/10 border border-emerald-500/30 p-3 text-xs text-emerald-200 space-y-1">
                      <p className="font-medium">
                        Patched {applyResult.applied_files.length} file(s) locally without replacing untouched files.
                      </p>
                      <p className="text-[11px] font-mono text-emerald-300/80">
                        Rollback backup saved at: {applyResult.backup_dir}
                      </p>
                    </div>
                  )}
                </div>
              )}
            </motion.div>
          )}
        </AnimatePresence>
      </div>
    </div>
  );
};
