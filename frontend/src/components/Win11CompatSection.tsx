import React, { useState } from 'react';
import { Layers, ShieldCheck, RotateCcw, CheckCircle2, AlertOctagon, Monitor, Shield, Check } from 'lucide-react';

interface CompatShimResult {
  success: boolean;
  executable_path: string;
  applied_layer: string;
  previous_layer: string | null;
  detail: string;
}

interface Win11CompatSectionProps {
  onVoiceAlert?: (text: string, type: string) => void;
}

export const Win11CompatSection: React.FC<Win11CompatSectionProps> = ({ onVoiceAlert }) => {
  const [exePath, setExePath] = useState<string>('C:\\Program Files\\Git\\cmd\\git.exe');
  const [osMode, setOsMode] = useState<string>('WIN7RTM');
  const [displayFlags, setDisplayFlags] = useState<string[]>(['HIGHDPIAWARE']);
  const [runAsAdmin, setRunAsAdmin] = useState<boolean>(false);
  const [appliedResult, setAppliedResult] = useState<CompatShimResult | null>(null);
  const [undoToken, setUndoToken] = useState<string | null>(null);
  const [loading, setLoading] = useState<boolean>(false);
  const [undoLoading, setUndoLoading] = useState<boolean>(false);
  const [statusMsg, setStatusMsg] = useState<string | null>(null);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);

  const availableFlags = ['HIGHDPIAWARE', 'DPIUNAWARE', 'GDIDPISCALING', '640X480', '256COLOR'];
  const osModes = ['WIN8RTM', 'WIN7RTM', 'VISTASP2', 'WINXPSP3'];

  // Real-time preview of layer string
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
    setLoading(true);
    setStatusMsg(null);
    setErrorMsg(null);
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
      if (!res.ok) {
        throw new Error(data.detail || 'Failed to apply compatibility shim');
      }

      setAppliedResult(data.result);
      if (data.result.success) {
        setUndoToken(data.undo_token);
        setStatusMsg(`Successfully applied compatibility layer '${data.result.applied_layer}'.`);
        if (onVoiceAlert) {
          onVoiceAlert(`Compatibility shim applied to ${exePath}. Digital signatures and SHA-256 binary untouched.`, 'COMPAT_APPLIED');
        }
      } else {
        setErrorMsg(data.result.detail);
      }
    } catch (err: any) {
      setErrorMsg(err.message || 'Error executing compatibility shim');
    } finally {
      setLoading(false);
    }
  };

  const handleUndoShim = async () => {
    if (!undoToken) return;
    setUndoLoading(true);
    setStatusMsg(null);
    setErrorMsg(null);
    try {
      const res = await fetch('/api/compat/undo', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ undo_token: undoToken }),
      });

      const data = await res.json();
      if (!res.ok) {
        throw new Error(data.detail || 'Failed to undo shim');
      }

      setUndoToken(null);
      setAppliedResult(null);
      setStatusMsg(`Undo complete: ${data.message}`);
      if (onVoiceAlert) {
        onVoiceAlert('Compatibility shim restored to previous registry state.', 'COMPAT_RESTORED');
      }
    } catch (err: any) {
      setErrorMsg(err.message || 'Failed to undo compatibility shim');
    } finally {
      setUndoLoading(false);
    }
  };

  return (
    <div className="rounded-2xl border border-slate-800 bg-slate-900/60 p-6 backdrop-blur">
      <div className="flex items-center justify-between pb-4 border-b border-slate-800">
        <div className="flex items-center gap-3">
          <div className="rounded-xl bg-indigo-500/10 p-2.5 text-indigo-400 border border-indigo-500/20">
            <Monitor className="h-6 w-6" />
          </div>
          <div>
            <h2 className="text-lg font-bold text-slate-100">
              Pillar 2: Windows 11 Compatibility Shim Engine
            </h2>
            <p className="text-xs text-slate-400">
              Applies non-destructive per-user registry layers in <code className="text-indigo-400 font-mono text-[10px]">HKCU\...\AppCompatFlags\Layers</code>. Fixes crashes and high-DPI scaling without modifying binary bytes or signatures.
            </p>
          </div>
        </div>
        <span className="rounded-full border border-indigo-500/30 bg-indigo-500/10 px-3 py-1 text-xs font-semibold text-indigo-400">
          SHA-256 Preserved
        </span>
      </div>

      <div className="mt-5 space-y-4">
        {/* Target .exe Path */}
        <div>
          <label className="block text-xs font-medium text-slate-300 mb-1.5 flex items-center justify-between">
            <span>Target Executable Path (.exe required)</span>
            <span className="text-[10px] text-slate-500 font-mono">Per-User Registry Key</span>
          </label>
          <input
            type="text"
            value={exePath}
            onChange={(e) => setExePath(e.target.value)}
            placeholder="C:\Path\To\LegacyApplication.exe"
            className="w-full rounded-xl border border-slate-700 bg-slate-950 px-4 py-2 text-xs font-mono text-slate-200 focus:border-indigo-500 focus:outline-none"
          />
        </div>

        {/* Options Row */}
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          {/* OS Mode */}
          <div>
            <label className="block text-xs font-medium text-slate-300 mb-1.5">
              Target OS Compatibility Emulation
            </label>
            <select
              value={osMode}
              onChange={(e) => setOsMode(e.target.value)}
              className="w-full rounded-lg border border-slate-700 bg-slate-950 px-3 py-2 text-xs text-slate-200 font-mono focus:border-indigo-500 focus:outline-none"
            >
              <option value="">None (Native Windows 11)</option>
              {osModes.map((m) => (
                <option key={m} value={m}>
                  {m}
                </option>
              ))}
            </select>
          </div>

          {/* Admin Privileges Toggle */}
          <div>
            <label className="block text-xs font-medium text-slate-300 mb-1.5">
              Elevation Requirement
            </label>
            <button
              type="button"
              onClick={() => setRunAsAdmin(!runAsAdmin)}
              className={`w-full flex items-center justify-between rounded-lg border px-3 py-2 text-xs font-medium transition ${
                runAsAdmin
                  ? 'border-indigo-500/40 bg-indigo-950/40 text-indigo-200'
                  : 'border-slate-700 bg-slate-950 text-slate-400 hover:text-slate-200'
              }`}
            >
              <span className="flex items-center gap-1.5">
                <Shield className="h-4 w-4" />
                Run as Administrator (~ RUNASADMIN)
              </span>
              <span className="font-mono text-[11px] font-bold">
                {runAsAdmin ? 'ENABLED' : 'DISABLED'}
              </span>
            </button>
          </div>
        </div>

        {/* High-DPI and Scaling Flags */}
        <div>
          <label className="block text-xs font-medium text-slate-300 mb-1.5">
            Display & High-DPI Scaling Flags
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
                      : 'border-slate-800 bg-black/40 text-slate-400 hover:text-slate-200'
                  }`}
                >
                  {active && <Check className="h-3 w-3 text-indigo-400" />}
                  {flag}
                </button>
              );
            })}
          </div>
        </div>

        {/* Real-time Layer String Preview */}
        <div className="rounded-xl border border-slate-800 bg-black/50 p-3 flex items-center justify-between text-xs">
          <span className="text-slate-400 text-[11px]">Computed Layer String:</span>
          <code className="text-indigo-300 font-mono font-bold bg-indigo-950/40 border border-indigo-500/30 px-2 py-0.5 rounded">
            {previewLayerString()}
          </code>
        </div>

        {/* Status / Error alerts */}
        {errorMsg && (
          <div className="rounded-lg border border-rose-500/30 bg-rose-950/30 p-3 text-xs text-rose-300 flex items-center gap-2">
            <AlertOctagon className="h-4 w-4 shrink-0 text-rose-400" />
            <span>{errorMsg}</span>
          </div>
        )}

        {statusMsg && (
          <div className="rounded-lg border border-emerald-500/30 bg-emerald-950/30 p-3 text-xs text-emerald-300 flex items-center gap-2">
            <CheckCircle2 className="h-4 w-4 shrink-0 text-emerald-400" />
            <span>{statusMsg}</span>
          </div>
        )}

        {/* Actions */}
        <div className="pt-2 flex flex-wrap items-center justify-between gap-3">
          {undoToken ? (
            <button
              onClick={handleUndoShim}
              disabled={undoLoading}
              className="flex items-center gap-1.5 rounded-xl border border-purple-500/40 bg-purple-500/10 hover:bg-purple-500/20 px-4 py-2 text-xs font-semibold text-purple-300 transition disabled:opacity-50"
            >
              <RotateCcw className="h-3.5 w-3.5" />
              {undoLoading ? 'Restoring...' : '1-Click Undo Compatibility Shim'}
            </button>
          ) : (
            <span className="text-[11px] text-slate-500 italic">
              Undo token is minted when a shim is applied.
            </span>
          )}

          <button
            onClick={handleApplyShim}
            disabled={loading || !exePath || previewLayerString() === '~'}
            className="flex items-center gap-2 rounded-xl bg-indigo-600 hover:bg-indigo-500 px-5 py-2 text-xs font-semibold text-white shadow-lg shadow-indigo-600/20 transition disabled:opacity-50"
          >
            <Layers className="h-3.5 w-3.5" />
            {loading ? 'Writing to Registry...' : 'Apply Compatibility Shim'}
          </button>
        </div>
      </div>
    </div>
  );
};
