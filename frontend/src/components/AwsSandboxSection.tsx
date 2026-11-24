import React, { useState, useEffect } from 'react';
import { Cloud, Play, CheckCircle2, AlertTriangle, ShieldCheck, Box, RefreshCw, Cpu, Check } from 'lucide-react';

interface CloudPretestReport {
  run_id: string;
  package_id: string;
  backend: 'aws_codebuild' | 'offline_simulated';
  verdict: 'QUEUED' | 'RUNNING' | 'PASSED' | 'UNVERIFIED_SIMULATED' | 'NEEDS_COMPAT_SHIM' | 'FAILED';
  started_at: string;
  aws_build_id?: string | null;
  summary: string;
}

interface AwsSandboxSectionProps {
  onVoiceAlert?: (text: string, type: string) => void;
}

export const AwsSandboxSection: React.FC<AwsSandboxSectionProps> = ({ onVoiceAlert }) => {
  const [packageId, setPackageId] = useState<string>('Git.Git');
  const [scope, setScope] = useState<'user' | 'machine'>('user');
  const [currentReport, setCurrentReport] = useState<CloudPretestReport | null>(null);
  const [history, setHistory] = useState<CloudPretestReport[]>([]);
  const [loading, setLoading] = useState<boolean>(false);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);

  const fetchRuns = async () => {
    try {
      const res = await fetch('/api/sandbox/runs');
      if (res.ok) {
        const data = await res.json();
        setHistory(data.runs || []);
      }
    } catch (err) {
      console.warn('Failed to fetch sandbox runs:', err);
    }
  };

  useEffect(() => {
    fetchRuns();
  }, []);

  const handleLaunchPretest = async (targetPkg?: string) => {
    const pkg = targetPkg || packageId;
    setLoading(true);
    setErrorMsg(null);

    try {
      const res = await fetch('/api/sandbox/pretest', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          package_id: pkg,
          source: 'winget',
          scope: scope,
        }),
      });

      if (!res.ok) {
        const errData = await res.json();
        throw new Error(errData.detail || 'Sandbox pretest request failed');
      }

      const report: CloudPretestReport = await res.json();
      setCurrentReport(report);
      fetchRuns();

      if (onVoiceAlert) {
        onVoiceAlert(
          `Cloud pre-test complete for ${report.package_id}. Verdict: ${report.verdict} via ${report.backend}.`,
          'SANDBOX_VERDICT'
        );
      }
    } catch (err: any) {
      setErrorMsg(err.message || 'Error communicating with sandbox');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="rounded-2xl border border-slate-800 bg-slate-900/60 p-6 backdrop-blur">
      <div className="flex items-center justify-between pb-4 border-b border-slate-800">
        <div className="flex items-center gap-3">
          <div className="rounded-xl bg-cyan-500/10 p-2.5 text-cyan-400 border border-cyan-500/20">
            <Cloud className="h-6 w-6" />
          </div>
          <div>
            <h2 className="text-lg font-bold text-slate-100">
              Pillar 3: AWS Cloud Pre-Test Sandbox
            </h2>
            <p className="text-xs text-slate-400">
              Executes unattended silent installs inside isolated AWS CodeBuild Windows containers prior to local installation. Automatic offline dry-run simulation when unconfigured.
            </p>
          </div>
        </div>
        <span className="rounded-full border border-cyan-500/30 bg-cyan-500/10 px-3 py-1 text-xs font-semibold text-cyan-400">
          Isolated Dry-Run
        </span>
      </div>

      {/* Input Controls */}
      <div className="mt-5 space-y-4">
        <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
          <div className="md:col-span-2">
            <label className="block text-xs font-medium text-slate-300 mb-1.5 flex items-center justify-between">
              <span>Target Package ID (Winget / Manifest)</span>
              <span className="text-[10px] text-slate-500 font-mono">Regex: ^[A-Za-z0-9][A-Za-z0-9._-]{'{2,80}'}$</span>
            </label>
            <input
              type="text"
              value={packageId}
              onChange={(e) => setPackageId(e.target.value)}
              placeholder="e.g. Git.Git, OpenJS.NodeJS, Docker.DockerDesktop"
              className="w-full rounded-xl border border-slate-700 bg-slate-950 px-4 py-2 text-xs font-mono text-slate-200 focus:border-cyan-500 focus:outline-none"
            />
          </div>

          <div>
            <label className="block text-xs font-medium text-slate-300 mb-1.5">
              Installation Scope
            </label>
            <select
              value={scope}
              onChange={(e) => setScope(e.target.value as 'user' | 'machine')}
              className="w-full rounded-xl border border-slate-700 bg-slate-950 px-3 py-2 text-xs text-slate-200 font-mono focus:border-cyan-500 focus:outline-none"
            >
              <option value="user">User Scope (Non-Admin)</option>
              <option value="machine">Machine Scope (System-Wide)</option>
            </select>
          </div>
        </div>

        {/* Quick Trigger Chips */}
        <div className="flex flex-wrap items-center gap-2 pt-1 text-xs">
          <span className="text-slate-500 text-[11px]">Test with:</span>
          {['Git.Git', 'OpenJS.NodeJS', 'Python.Python.3.12', 'Docker.DockerDesktop'].map((pkg) => (
            <button
              key={pkg}
              onClick={() => {
                setPackageId(pkg);
                handleLaunchPretest(pkg);
              }}
              className="rounded-lg border border-slate-800 bg-black/40 hover:bg-slate-800 px-2.5 py-1 text-[11px] text-slate-400 hover:text-cyan-300 transition"
            >
              {pkg}
            </button>
          ))}
        </div>

        {errorMsg && (
          <div className="rounded-lg border border-rose-500/30 bg-rose-950/30 p-3 text-xs text-rose-300">
            {errorMsg}
          </div>
        )}

        <div className="flex justify-end">
          <button
            onClick={() => handleLaunchPretest()}
            disabled={loading || !packageId}
            className="flex items-center gap-2 rounded-xl bg-cyan-600 hover:bg-cyan-500 px-5 py-2 text-xs font-semibold text-white shadow-lg shadow-cyan-600/20 transition disabled:opacity-50"
          >
            <Play className="h-3.5 w-3.5" />
            {loading ? 'Launching Cloud Sandbox...' : 'Run Pre-Test in Sandbox'}
          </button>
        </div>
      </div>

      {/* Latest Report Card */}
      {currentReport && (
        <div className="mt-5 rounded-xl border border-cyan-500/30 bg-black/50 p-4 space-y-2">
          <div className="flex flex-wrap items-center justify-between gap-2 border-b border-slate-800/80 pb-3">
            <div className="flex items-center gap-2">
              <span
                className={`rounded-full px-2.5 py-0.5 text-xs font-mono font-bold ${
                  currentReport.verdict === 'PASSED'
                    ? 'bg-emerald-500/20 text-emerald-400 border border-emerald-500/30'
                    : currentReport.verdict === 'UNVERIFIED_SIMULATED'
                    ? 'bg-amber-500/20 text-amber-400 border border-amber-500/30'
                    : currentReport.verdict === 'QUEUED'
                    ? 'bg-sky-500/20 text-sky-400 border border-sky-500/30'
                    : 'bg-rose-500/20 text-rose-400 border border-rose-500/30'
                }`}
              >
                {currentReport.verdict}
              </span>
              <span className="text-xs text-slate-300 font-mono font-semibold">
                {currentReport.package_id}
              </span>
            </div>
            <div className="flex items-center gap-2">
              {currentReport.backend === 'offline_simulated' ? (
                <span className="flex items-center gap-1 text-[10px] font-mono font-semibold text-amber-400 bg-amber-950/60 border border-amber-500/40 px-2 py-0.5 rounded">
                  <AlertTriangle className="h-3 w-3" />
                  Simulated — No Container Executed
                </span>
              ) : (
                <span className="text-[10px] font-mono text-cyan-300 bg-cyan-950/40 border border-cyan-500/30 px-2 py-0.5 rounded">
                  Backend: {currentReport.backend}
                </span>
              )}
            </div>
          </div>

          <p className="text-xs text-slate-300">{currentReport.summary}</p>

          <div className="flex items-center justify-between text-[11px] font-mono text-slate-500 pt-1">
            <span>Run ID: {currentReport.run_id}</span>
            <span>Started: {new Date(currentReport.started_at).toLocaleTimeString()}</span>
          </div>
        </div>
      )}

      {/* History Table */}
      {history.length > 0 && (
        <div className="mt-4 pt-3 border-t border-slate-800/80">
          <div className="text-[11px] uppercase font-bold text-slate-400 mb-2 flex items-center justify-between">
            <span>Recent Sandbox Pre-Tests</span>
            <button onClick={fetchRuns} className="text-slate-500 hover:text-slate-300">
              <RefreshCw className="h-3 w-3" />
            </button>
          </div>
          <div className="space-y-1.5 font-mono text-xs">
            {history.slice(-4).reverse().map((r) => (
              <div
                key={r.run_id}
                className="flex items-center justify-between rounded bg-black/40 px-3 py-1.5 border border-slate-800"
              >
                <div className="flex items-center gap-2">
                  <span className="text-emerald-400 font-bold">{r.package_id}</span>
                  <span className="text-slate-500 text-[10px]">({r.run_id})</span>
                </div>
                <div className="flex items-center gap-2">
                  <span className="text-[10px] text-cyan-400 bg-cyan-950/60 px-1.5 py-0.5 rounded">
                    {r.backend}
                  </span>
                  <span className={`text-[10px] font-bold ${
                    r.verdict === 'PASSED'
                      ? 'text-emerald-300'
                      : r.verdict === 'UNVERIFIED_SIMULATED'
                      ? 'text-amber-400'
                      : 'text-cyan-300'
                  }`}>
                    {r.verdict}
                  </span>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
};
