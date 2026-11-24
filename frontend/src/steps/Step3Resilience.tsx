import React, { useState } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import {
  Wrench,
  Monitor,
  Cloud,
  Terminal,
  Layers,
  Copy,
  Check,
  RotateCcw,
  Play,
  CheckCircle2,
  AlertOctagon,
  RefreshCw,
  ArrowRight,
  Shield,
  ShieldCheck,
} from 'lucide-react';
import { WorkflowStep } from '../workflow/WorkflowFSM';

interface Step3ResilienceProps {
  onComplete: () => void;
  onLog: (step: WorkflowStep, level: 'info' | 'success' | 'warning' | 'error', msg: string, detail?: string) => void;
  onVoiceAlert?: (text: string, type: string) => void;
}

type PillarTab = 'healer' | 'compat' | 'sandbox';

export const Step3Resilience: React.FC<Step3ResilienceProps> = ({
  onComplete,
  onLog,
  onVoiceAlert,
}) => {
  const [activeTab, setActiveTab] = useState<PillarTab>('healer');

  // --- Pillar 1: CLI Healer State ---
  const [errorText, setErrorText] = useState<string>("'kubectl' is not recognized as an internal or external command");
  const [healerLoading, setHealerLoading] = useState<boolean>(false);
  const [diagnosis, setDiagnosis] = useState<any>(null);
  const [copiedIndex, setCopiedIndex] = useState<number | null>(null);

  const sampleErrors = [
    { label: "Windows CMD: 'kubectl'", text: "'kubectl' is not recognized as an internal or external command" },
    { label: "PowerShell: 'terraform'", text: "The term 'terraform' is not recognized as the name of a cmdlet" },
    { label: "Bash: 'docker'", text: "bash: docker: command not found" },
    { label: "Zsh: 'helm'", text: "zsh: command not found: helm" },
  ];

  const handleDiagnose = async (customText?: string) => {
    const textToDiagnose = customText !== undefined ? customText : errorText;
    setHealerLoading(true);
    try {
      const res = await fetch('/api/healer/diagnose', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ error_text: textToDiagnose }),
      });
      if (res.ok) {
        const data = await res.json();
        setDiagnosis(data);
        onLog(WorkflowStep.RESILIENCE, 'success', `CLI Healer: ${data.status} for '${data.missing_command}'`, data.summary);
        if (onVoiceAlert) {
          onVoiceAlert(`CLI Healer diagnosis complete: ${data.summary}`, 'HEALER_DIAGNOSIS');
        }
      }
    } catch (err: any) {
      onLog(WorkflowStep.RESILIENCE, 'error', 'CLI Healer diagnosis failed', err.message);
    } finally {
      setHealerLoading(false);
    }
  };

  const copyToClipboard = (cmd: string, index: number) => {
    navigator.clipboard.writeText(cmd);
    setCopiedIndex(index);
    setTimeout(() => setCopiedIndex(null), 2000);
  };

  // --- Pillar 2: Win11 Compat State ---
  const [exePath, setExePath] = useState<string>('C:\\Program Files\\Git\\cmd\\git.exe');
  const [osMode, setOsMode] = useState<string>('WIN7RTM');
  const [displayFlags, setDisplayFlags] = useState<string[]>(['HIGHDPIAWARE']);
  const [runAsAdmin, setRunAsAdmin] = useState<boolean>(false);
  const [compatLoading, setCompatLoading] = useState<boolean>(false);
  const [compatResult, setCompatResult] = useState<any>(null);
  const [undoToken, setUndoToken] = useState<string | null>(null);
  const [undoLoading, setUndoLoading] = useState<boolean>(false);
  const [compatStatus, setCompatStatus] = useState<string | null>(null);
  const [compatError, setCompatError] = useState<string | null>(null);

  const availableFlags = ['HIGHDPIAWARE', 'DPIUNAWARE', 'GDIDPISCALING', '640X480', '256COLOR'];
  const osModes = ['WIN8RTM', 'WIN7RTM', 'VISTASP2', 'WINXPSP3'];

  const previewLayerString = () => {
    const tokens = ['~'];
    if (runAsAdmin) tokens.push('RUNASADMIN');
    displayFlags.forEach((f) => tokens.push(f));
    if (osMode) tokens.push(osMode);
    return tokens.join(' ');
  };

  const toggleFlag = (flag: string) => {
    setDisplayFlags((prev) =>
      prev.includes(flag) ? prev.filter((f) => f !== flag) : [...prev, flag]
    );
  };

  const handleApplyShim = async () => {
    setCompatLoading(true);
    setCompatStatus(null);
    setCompatError(null);
    try {
      const res = await fetch('/api/compat/apply', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          executable_path: exePath,
          os_mode: osMode || null,
          display_flags: displayFlags,
          run_as_admin: runAsAdmin,
        }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.detail || 'Failed to apply shim');

      setCompatResult(data.result);
      if (data.result.success) {
        setUndoToken(data.undo_token);
        setCompatStatus(`Successfully applied compatibility layer '${data.result.applied_layer}'.`);
        onLog(WorkflowStep.RESILIENCE, 'success', `Compat shim applied: ${data.result.applied_layer}`);
        if (onVoiceAlert) {
          onVoiceAlert(`Compatibility shim applied to ${exePath}. Digital signatures and SHA-256 binary untouched.`, 'COMPAT_APPLIED');
        }
      } else {
        setCompatError(data.result.detail);
      }
    } catch (err: any) {
      setCompatError(err.message || 'Error executing compatibility shim');
      onLog(WorkflowStep.RESILIENCE, 'error', 'Compat shim failed', err.message);
    } finally {
      setCompatLoading(false);
    }
  };

  const handleUndoShim = async () => {
    if (!undoToken) return;
    setUndoLoading(true);
    setCompatStatus(null);
    setCompatError(null);
    try {
      const res = await fetch('/api/compat/undo', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ undo_token: undoToken }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.detail || 'Failed to undo shim');

      setUndoToken(null);
      setCompatResult(null);
      setCompatStatus(`Undo complete: ${data.message}`);
      onLog(WorkflowStep.RESILIENCE, 'info', 'Compat shim restored to prior registry state');
      if (onVoiceAlert) {
        onVoiceAlert('Compatibility shim restored to previous registry state.', 'COMPAT_RESTORED');
      }
    } catch (err: any) {
      setCompatError(err.message || 'Failed to undo compatibility shim');
    } finally {
      setUndoLoading(false);
    }
  };

  // --- Pillar 3: AWS Sandbox State ---
  const [sandboxPackageId, setSandboxPackageId] = useState<string>('Git.Git');
  const [sandboxScope, setSandboxScope] = useState<'user' | 'machine'>('user');
  const [sandboxLoading, setSandboxLoading] = useState<boolean>(false);
  const [sandboxReport, setSandboxReport] = useState<any>(null);
  const [sandboxHistory, setSandboxHistory] = useState<any[]>([]);
  const [sandboxError, setSandboxError] = useState<string | null>(null);

  const fetchSandboxRuns = async () => {
    try {
      const res = await fetch('/api/sandbox/runs');
      if (res.ok) {
        const data = await res.json();
        setSandboxHistory(data.runs || []);
      }
    } catch (err) {
      console.warn('Failed to fetch sandbox runs:', err);
    }
  };

  const handleLaunchPretest = async (targetPkg?: string) => {
    const pkg = targetPkg || sandboxPackageId;
    setSandboxLoading(true);
    setSandboxError(null);
    try {
      const res = await fetch('/api/sandbox/pretest', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          package_id: pkg,
          source: 'winget',
          scope: sandboxScope,
        }),
      });
      if (!res.ok) {
        const errData = await res.json();
        throw new Error(errData.detail || 'Sandbox pretest failed');
      }
      const report = await res.json();
      setSandboxReport(report);
      fetchSandboxRuns();
      onLog(WorkflowStep.RESILIENCE, 'success', `Sandbox pre-test: ${report.verdict} via ${report.backend}`, report.summary);
      if (onVoiceAlert) {
        onVoiceAlert(`Cloud pre-test complete for ${report.package_id}. Verdict: ${report.verdict} via ${report.backend}.`, 'SANDBOX_VERDICT');
      }
    } catch (err: any) {
      setSandboxError(err.message || 'Error communicating with sandbox');
      onLog(WorkflowStep.RESILIENCE, 'error', 'Sandbox pretest failed', err.message);
    } finally {
      setSandboxLoading(false);
    }
  };

  return (
    <motion.div
      initial={{ opacity: 0, y: 12 }}
      animate={{ opacity: 1, y: 0 }}
      exit={{ opacity: 0, y: -12 }}
      transition={{ duration: 0.25 }}
      className="space-y-6"
    >
      {/* Step Header Card */}
      <div className="glass-card p-6">
        <div className="flex items-start justify-between gap-4">
          <div className="flex items-start gap-3.5">
            <div className="flex h-11 w-11 items-center justify-center rounded-xl bg-violet-500/10 border border-violet-500/20 text-violet-400 shrink-0">
              <Wrench className="h-5 w-5" />
            </div>
            <div>
              <div className="flex items-center gap-2">
                <span className="text-[11px] font-mono uppercase tracking-wider text-violet-400 font-semibold">
                  Step 4 of 6
                </span>
                <span className="rounded bg-violet-500/10 border border-violet-500/20 px-1.5 py-0.2 text-[10px] font-mono text-violet-300">
                  Resilience &amp; Compatibility
                </span>
              </div>
              <h2 className="text-lg font-bold text-slate-100 mt-1">
                Zero-Shell CLI Healer, Win11 Compat Shims &amp; Cloud Sandbox
              </h2>
              <p className="text-xs text-slate-400 mt-1 max-w-2xl leading-relaxed">
                Automated triage and remediation across three core pillars: orphaned terminal executable recovery, non-destructive per-user AppCompatFlags registry shims, and isolated AWS CodeBuild pre-test execution.
              </p>
            </div>
          </div>

          {/* Sub-navigation tabs */}
          <div className="flex items-center gap-1 rounded-lg border border-glass bg-black/40 p-1 shrink-0">
            <button
              onClick={() => setActiveTab('healer')}
              className={`flex items-center gap-1.5 rounded-md px-3 py-1.5 text-xs font-semibold transition ${
                activeTab === 'healer'
                  ? 'bg-indigo-600 text-white shadow-md'
                  : 'text-slate-400 hover:text-slate-200'
              }`}
            >
              <Terminal className="h-3.5 w-3.5" />
              CLI Healer
            </button>
            <button
              onClick={() => setActiveTab('compat')}
              className={`flex items-center gap-1.5 rounded-md px-3 py-1.5 text-xs font-semibold transition ${
                activeTab === 'compat'
                  ? 'bg-indigo-600 text-white shadow-md'
                  : 'text-slate-400 hover:text-slate-200'
              }`}
            >
              <Monitor className="h-3.5 w-3.5" />
              Win11 Compat
            </button>
            <button
              onClick={() => {
                setActiveTab('sandbox');
                fetchSandboxRuns();
              }}
              className={`flex items-center gap-1.5 rounded-md px-3 py-1.5 text-xs font-semibold transition ${
                activeTab === 'sandbox'
                  ? 'bg-indigo-600 text-white shadow-md'
                  : 'text-slate-400 hover:text-slate-200'
              }`}
            >
              <Cloud className="h-3.5 w-3.5" />
              Cloud Sandbox
            </button>
          </div>
        </div>
      </div>

      {/* Tab Panels */}
      <AnimatePresence mode="wait">
        {activeTab === 'healer' && (
          <motion.div
            key="healer"
            initial={{ opacity: 0, y: 8 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -8 }}
            transition={{ duration: 0.15 }}
            className="glass-card p-6 space-y-5"
          >
            <div className="flex items-center justify-between border-b border-glass pb-3">
              <div>
                <h3 className="text-sm font-bold text-slate-200">
                  Pillar 1: Terminal Command-Not-Found Interceptor
                </h3>
                <p className="text-xs text-slate-400">
                  Scans PATH directories, Program Files, and AppData for missing executables without spawning a shell.
                </p>
              </div>
              <span className="rounded bg-indigo-500/10 border border-indigo-500/20 px-2 py-0.5 text-[10px] font-mono text-indigo-300">
                Zero Shell Invocation
              </span>
            </div>

            <div className="space-y-3">
              <label className="block text-xs font-medium text-slate-300">
                Terminal Error Output to Diagnose
              </label>
              <div className="flex gap-2">
                <input
                  type="text"
                  value={errorText}
                  onChange={(e) => setErrorText(e.target.value)}
                  placeholder="Paste terminal error (e.g. 'kubectl' is not recognized)..."
                  className="glass-input text-xs"
                />
                <button
                  onClick={() => handleDiagnose()}
                  disabled={healerLoading}
                  className="btn-primary shrink-0"
                >
                  <Terminal className="h-3.5 w-3.5" />
                  <span>{healerLoading ? 'Probing...' : 'Diagnose'}</span>
                </button>
              </div>

              {/* Sample Chips */}
              <div className="flex flex-wrap items-center gap-2 pt-1 text-xs">
                <span className="text-slate-500 text-[11px]">Quick samples:</span>
                {sampleErrors.map((s, idx) => (
                  <button
                    key={idx}
                    onClick={() => {
                      setErrorText(s.text);
                      handleDiagnose(s.text);
                    }}
                    className="rounded-md border border-glass bg-black/40 hover:bg-surface-hover px-2.5 py-1 text-[11px] font-mono text-slate-400 hover:text-slate-200 transition"
                  >
                    {s.label}
                  </button>
                ))}
              </div>
            </div>

            {/* Diagnosis Result */}
            {diagnosis && (
              <motion.div
                initial={{ opacity: 0 }}
                animate={{ opacity: 1 }}
                className="rounded-xl border border-glass bg-black/60 p-4 space-y-3"
              >
                <div className="flex items-center justify-between border-b border-glass pb-2.5">
                  <div className="flex items-center gap-2">
                    <span
                      className={`rounded-full px-2.5 py-0.5 text-[11px] font-mono font-bold ${
                        diagnosis.status === 'ALREADY_IN_PATH'
                          ? 'bg-emerald-500/20 text-emerald-400 border border-emerald-500/30'
                          : diagnosis.status === 'FOUND_ON_DISK_NEEDS_PATH'
                          ? 'bg-sky-500/20 text-sky-400 border border-sky-500/30'
                          : diagnosis.status === 'AVAILABLE_VIA_WINGET'
                          ? 'bg-indigo-500/20 text-indigo-400 border border-indigo-500/30'
                          : 'bg-rose-500/20 text-rose-400 border border-rose-500/30'
                      }`}
                    >
                      {diagnosis.status}
                    </span>
                    <span className="text-xs text-slate-300 font-mono">
                      Command: <strong>{diagnosis.missing_command}</strong>
                    </span>
                  </div>
                  {diagnosis.winget_package_id && (
                    <span className="text-[10px] font-mono text-indigo-300 bg-indigo-950/40 border border-indigo-500/30 px-2 py-0.5 rounded">
                      Winget: {diagnosis.winget_package_id}
                    </span>
                  )}
                </div>

                <p className="text-xs text-slate-300">{diagnosis.summary}</p>

                {diagnosis.found_executable_path && (
                  <div className="rounded-lg bg-black/80 p-3 text-xs border border-glass space-y-1 font-mono">
                    <div className="text-slate-500 text-[10px] uppercase">Located Executable:</div>
                    <div className="text-sky-300">{diagnosis.found_executable_path}</div>
                    <div className="text-slate-500 text-[10px] uppercase pt-1">Directory to add to PATH:</div>
                    <div className="text-emerald-400">{diagnosis.directory_to_add}</div>
                  </div>
                )}

                {diagnosis.suggested_commands?.length > 0 && (
                  <div className="space-y-1.5 pt-1">
                    <span className="text-[10px] font-mono uppercase text-slate-500 block">
                      Deterministic Remediation Commands:
                    </span>
                    {diagnosis.suggested_commands.map((cmd: string, i: number) => (
                      <div
                        key={i}
                        className="flex items-center justify-between gap-2 rounded bg-black/80 px-3 py-2 border border-glass"
                      >
                        <code className="text-emerald-300 text-xs font-mono">{cmd}</code>
                        <button
                          onClick={() => copyToClipboard(cmd, i)}
                          className="btn-secondary text-[10px] py-1 px-2 shrink-0"
                        >
                          {copiedIndex === i ? (
                            <>
                              <Check className="h-3 w-3 text-emerald-400" />
                              <span>Copied</span>
                            </>
                          ) : (
                            <>
                              <Copy className="h-3 w-3" />
                              <span>Copy</span>
                            </>
                          )}
                        </button>
                      </div>
                    ))}
                  </div>
                )}
              </motion.div>
            )}
          </motion.div>
        )}

        {activeTab === 'compat' && (
          <motion.div
            key="compat"
            initial={{ opacity: 0, y: 8 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -8 }}
            transition={{ duration: 0.15 }}
            className="glass-card p-6 space-y-5"
          >
            <div className="flex items-center justify-between border-b border-glass pb-3">
              <div>
                <h3 className="text-sm font-bold text-slate-200">
                  Pillar 2: Windows 11 Compatibility Shim Engine
                </h3>
                <p className="text-xs text-slate-400">
                  Applies non-destructive per-user registry shims to <code className="text-indigo-400 font-mono text-[10px]">HKCU\Software\Microsoft\Windows NT\CurrentVersion\AppCompatFlags\Layers</code>.
                </p>
              </div>
              <span className="rounded bg-indigo-500/10 border border-indigo-500/20 px-2 py-0.5 text-[10px] font-mono text-indigo-300">
                SHA-256 Preserved
              </span>
            </div>

            <div className="space-y-4">
              <div>
                <label className="block text-xs font-medium text-slate-300 mb-1.5 flex items-center justify-between">
                  <span>Target Executable Path (.exe)</span>
                  <span className="text-[10px] text-slate-500 font-mono">Per-User Registry Key</span>
                </label>
                <input
                  type="text"
                  value={exePath}
                  onChange={(e) => setExePath(e.target.value)}
                  placeholder="C:\Path\To\Application.exe"
                  className="glass-input text-xs"
                />
              </div>

              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                <div>
                  <label className="block text-xs font-medium text-slate-300 mb-1.5">
                    OS Mode Emulation
                  </label>
                  <select
                    value={osMode}
                    onChange={(e) => setOsMode(e.target.value)}
                    className="glass-input text-xs cursor-pointer"
                  >
                    <option value="" className="bg-slate-950">None (Native Windows 11)</option>
                    {osModes.map((m) => (
                      <option key={m} value={m} className="bg-slate-950">{m}</option>
                    ))}
                  </select>
                </div>

                <div>
                  <label className="block text-xs font-medium text-slate-300 mb-1.5">
                    Admin Privilege Mode
                  </label>
                  <button
                    type="button"
                    onClick={() => setRunAsAdmin(!runAsAdmin)}
                    className={`w-full flex items-center justify-between rounded-lg border px-3 py-2 text-xs font-medium transition ${
                      runAsAdmin
                        ? 'border-indigo-500/40 bg-indigo-950/40 text-indigo-200'
                        : 'border-glass bg-black/40 text-slate-400 hover:text-slate-200'
                    }`}
                  >
                    <span className="flex items-center gap-1.5">
                      <Shield className="h-4 w-4" />
                      Run as Administrator (~ RUNASADMIN)
                    </span>
                    <span className="font-mono text-[10px] font-bold">
                      {runAsAdmin ? 'ENABLED' : 'DISABLED'}
                    </span>
                  </button>
                </div>
              </div>

              <div>
                <label className="block text-xs font-medium text-slate-300 mb-1.5">
                  Display &amp; High-DPI Scaling Flags
                </label>
                <div className="flex flex-wrap gap-2">
                  {availableFlags.map((flag) => {
                    const active = displayFlags.includes(flag);
                    return (
                      <button
                        key={flag}
                        type="button"
                        onClick={() => toggleFlag(flag)}
                        className={`flex items-center gap-1.5 rounded-lg border px-3 py-1.5 text-[11px] font-mono transition ${
                          active
                            ? 'border-indigo-500 bg-indigo-500/20 text-indigo-300 font-semibold'
                            : 'border-glass bg-black/40 text-slate-400 hover:text-slate-200'
                        }`}
                      >
                        {active && <Check className="h-3 w-3 text-indigo-400" />}
                        {flag}
                      </button>
                    );
                  })}
                </div>
              </div>

              {/* Computed Layer Preview */}
              <div className="rounded-xl border border-glass bg-black/60 p-3 flex items-center justify-between text-xs">
                <span className="text-slate-400 text-[11px]">Computed Layer String:</span>
                <code className="text-indigo-300 font-mono font-bold bg-indigo-950/40 border border-indigo-500/30 px-2 py-0.5 rounded">
                  {previewLayerString()}
                </code>
              </div>

              {compatError && (
                <div className="rounded-lg border border-rose-500/30 bg-rose-950/20 p-3 text-xs text-rose-300 flex items-center gap-2">
                  <AlertOctagon className="h-4 w-4 shrink-0 text-rose-400" />
                  <span>{compatError}</span>
                </div>
              )}

              {compatStatus && (
                <div className="rounded-lg border border-emerald-500/30 bg-emerald-950/20 p-3 text-xs text-emerald-300 flex items-center gap-2">
                  <CheckCircle2 className="h-4 w-4 shrink-0 text-emerald-400" />
                  <span>{compatStatus}</span>
                </div>
              )}

              <div className="flex flex-wrap items-center justify-between gap-3 pt-2">
                {undoToken ? (
                  <button
                    onClick={handleUndoShim}
                    disabled={undoLoading}
                    className="btn-danger"
                  >
                    <RotateCcw className={`h-3.5 w-3.5 ${undoLoading ? 'animate-spin' : ''}`} />
                    <span>1-Click Undo Compatibility Shim</span>
                  </button>
                ) : (
                  <span className="text-[11px] text-slate-500 italic">
                    Undo token is created automatically upon applying a shim.
                  </span>
                )}

                <button
                  onClick={handleApplyShim}
                  disabled={compatLoading || !exePath || previewLayerString() === '~'}
                  className="btn-primary"
                >
                  <Layers className="h-3.5 w-3.5" />
                  <span>{compatLoading ? 'Writing to Registry...' : 'Apply Compatibility Shim'}</span>
                </button>
              </div>
            </div>
          </motion.div>
        )}

        {activeTab === 'sandbox' && (
          <motion.div
            key="sandbox"
            initial={{ opacity: 0, y: 8 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -8 }}
            transition={{ duration: 0.15 }}
            className="glass-card p-6 space-y-5"
          >
            <div className="flex items-center justify-between border-b border-glass pb-3">
              <div>
                <h3 className="text-sm font-bold text-slate-200">
                  Pillar 3: AWS Cloud Pre-Test Sandbox
                </h3>
                <p className="text-xs text-slate-400">
                  Executes unattended dry-run installations inside isolated AWS CodeBuild Windows containers prior to local installation.
                </p>
              </div>
              <span className="rounded bg-indigo-500/10 border border-indigo-500/20 px-2 py-0.5 text-[10px] font-mono text-indigo-300">
                Isolated Dry-Run
              </span>
            </div>

            <div className="space-y-4">
              <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
                <div className="md:col-span-2">
                  <label className="block text-xs font-medium text-slate-300 mb-1.5 flex items-center justify-between">
                    <span>Target Package ID</span>
                    <span className="text-[10px] text-slate-500 font-mono">Winget Manifest ID</span>
                  </label>
                  <input
                    type="text"
                    value={sandboxPackageId}
                    onChange={(e) => setSandboxPackageId(e.target.value)}
                    placeholder="e.g. Git.Git, OpenJS.NodeJS"
                    className="glass-input text-xs"
                  />
                </div>

                <div>
                  <label className="block text-xs font-medium text-slate-300 mb-1.5">
                    Installation Scope
                  </label>
                  <select
                    value={sandboxScope}
                    onChange={(e) => setSandboxScope(e.target.value as 'user' | 'machine')}
                    className="glass-input text-xs cursor-pointer"
                  >
                    <option value="user" className="bg-slate-950">User Scope (Non-Admin)</option>
                    <option value="machine" className="bg-slate-950">Machine Scope (System)</option>
                  </select>
                </div>
              </div>

              {/* Quick Chips */}
              <div className="flex flex-wrap items-center gap-2 pt-1 text-xs">
                <span className="text-slate-500 text-[11px]">Test with:</span>
                {['Git.Git', 'OpenJS.NodeJS', 'Python.Python.3.12', 'Docker.DockerDesktop'].map((pkg) => (
                  <button
                    key={pkg}
                    onClick={() => {
                      setSandboxPackageId(pkg);
                      handleLaunchPretest(pkg);
                    }}
                    className="rounded-md border border-glass bg-black/40 hover:bg-surface-hover px-2.5 py-1 text-[11px] font-mono text-slate-400 hover:text-indigo-300 transition"
                  >
                    {pkg}
                  </button>
                ))}
              </div>

              {sandboxError && (
                <div className="rounded-lg border border-rose-500/30 bg-rose-950/20 p-3 text-xs text-rose-300">
                  {sandboxError}
                </div>
              )}

              <div className="flex justify-end pt-2">
                <button
                  onClick={() => handleLaunchPretest()}
                  disabled={sandboxLoading || !sandboxPackageId}
                  className="btn-primary"
                >
                  <Play className="h-3.5 w-3.5" />
                  <span>{sandboxLoading ? 'Launching Cloud Sandbox...' : 'Run Pre-Test in Sandbox'}</span>
                </button>
              </div>

              {/* Latest Report */}
              {sandboxReport && (
                <motion.div
                  initial={{ opacity: 0 }}
                  animate={{ opacity: 1 }}
                  className="rounded-xl border border-glass bg-black/60 p-4 space-y-2"
                >
                  <div className="flex items-center justify-between border-b border-glass pb-2.5">
                    <div className="flex items-center gap-2">
                      <span
                        className={`rounded-full px-2.5 py-0.5 text-[11px] font-mono font-bold ${
                          sandboxReport.verdict === 'PASSED'
                            ? 'bg-emerald-500/20 text-emerald-400 border border-emerald-500/30'
                            : sandboxReport.verdict === 'QUEUED'
                            ? 'bg-sky-500/20 text-sky-400 border border-sky-500/30'
                            : 'bg-rose-500/20 text-rose-400 border border-rose-500/30'
                        }`}
                      >
                        {sandboxReport.verdict}
                      </span>
                      <span className="text-xs text-slate-300 font-mono font-semibold">
                        {sandboxReport.package_id}
                      </span>
                    </div>
                    <span className="text-[10px] font-mono text-indigo-300 bg-indigo-950/40 border border-indigo-500/30 px-2 py-0.5 rounded">
                      Backend: {sandboxReport.backend}
                    </span>
                  </div>

                  <p className="text-xs text-slate-300">{sandboxReport.summary}</p>

                  <div className="flex items-center justify-between text-[11px] font-mono text-slate-500 pt-1">
                    <span>Run ID: {sandboxReport.run_id}</span>
                    <span>Started: {new Date(sandboxReport.started_at).toLocaleTimeString()}</span>
                  </div>
                </motion.div>
              )}

              {/* History */}
              {sandboxHistory.length > 0 && (
                <div className="pt-2">
                  <div className="text-[11px] uppercase font-bold text-slate-500 mb-2 flex items-center justify-between">
                    <span>Recent Sandbox Pre-Tests</span>
                    <button onClick={fetchSandboxRuns} className="text-slate-500 hover:text-slate-300">
                      <RefreshCw className="h-3 w-3" />
                    </button>
                  </div>
                  <div className="space-y-1.5 font-mono text-xs">
                    {sandboxHistory.slice(-4).reverse().map((r) => (
                      <div
                        key={r.run_id}
                        className="flex items-center justify-between rounded bg-black/60 px-3 py-1.5 border border-glass"
                      >
                        <div className="flex items-center gap-2">
                          <span className="text-emerald-400 font-bold">{r.package_id}</span>
                          <span className="text-slate-500 text-[10px]">({r.run_id})</span>
                        </div>
                        <div className="flex items-center gap-2">
                          <span className="text-[10px] text-indigo-300 bg-indigo-950/60 px-1.5 py-0.5 rounded">
                            {r.backend}
                          </span>
                          <span className="text-[10px] text-emerald-300 font-bold">
                            {r.verdict}
                          </span>
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              )}
            </div>
          </motion.div>
        )}
      </AnimatePresence>

      {/* Navigation Controls */}
      <div className="flex items-center justify-between pt-2">
        <div className="text-xs text-slate-500">
          Resilience tools reviewed. Proceed to screen privacy &amp; AI Brain intent execution.
        </div>
        <button
          onClick={onComplete}
          className="btn-primary"
        >
          <span>Proceed to Screen Guard &amp; AI Brain</span>
          <ArrowRight className="h-4 w-4" />
        </button>
      </div>
    </motion.div>
  );
};
