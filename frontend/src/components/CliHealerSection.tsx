import React, { useState } from 'react';
import { Wrench, Terminal, CheckCircle2, AlertTriangle, ArrowRight, Copy, Check, Download, FolderPlus } from 'lucide-react';

interface CliDiagnosis {
  missing_command: string;
  status: 'FOUND_ON_DISK_NEEDS_PATH' | 'AVAILABLE_VIA_WINGET' | 'NOT_FOUND' | 'ALREADY_IN_PATH';
  found_executable_path?: string | null;
  directory_to_add?: string | null;
  winget_package_id?: string | null;
  summary: string;
  suggested_commands: string[];
}

interface CliHealerSectionProps {
  onVoiceAlert?: (text: string, type: string) => void;
}

export const CliHealerSection: React.FC<CliHealerSectionProps> = ({ onVoiceAlert }) => {
  const [errorText, setErrorText] = useState<string>("'kubectl' is not recognized as an internal or external command");
  const [diagnosis, setDiagnosis] = useState<CliDiagnosis | null>(null);
  const [loading, setLoading] = useState<boolean>(false);
  const [copiedIndex, setCopiedIndex] = useState<number | null>(null);

  const sampleErrors = [
    { label: "Windows CMD: 'kubectl'", text: "'kubectl' is not recognized as an internal or external command" },
    { label: "PowerShell: 'terraform'", text: "The term 'terraform' is not recognized as the name of a cmdlet" },
    { label: "Bash: 'docker'", text: "bash: docker: command not found" },
    { label: "Zsh: 'helm'", text: "zsh: command not found: helm" },
  ];

  const handleDiagnose = async (customText?: string) => {
    const textToDiagnose = customText !== undefined ? customText : errorText;
    setLoading(true);
    try {
      const res = await fetch('/api/healer/diagnose', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ error_text: textToDiagnose }),
      });
      if (res.ok) {
        const data: CliDiagnosis = await res.json();
        setDiagnosis(data);
        if (onVoiceAlert) {
          onVoiceAlert(`CLI Healer diagnosis complete: ${data.summary}`, 'HEALER_DIAGNOSIS');
        }
      }
    } catch (err) {
      console.error('Diagnosis request failed:', err);
    } finally {
      setLoading(false);
    }
  };

  const copyToClipboard = (cmd: string, index: number) => {
    navigator.clipboard.writeText(cmd);
    setCopiedIndex(index);
    setTimeout(() => setCopiedIndex(null), 2000);
  };

  return (
    <div className="rounded-2xl border border-slate-800 bg-slate-900/60 p-6 backdrop-blur">
      <div className="flex items-center justify-between pb-4 border-b border-slate-800">
        <div className="flex items-center gap-3">
          <div className="rounded-xl bg-orange-500/10 p-2.5 text-orange-400 border border-orange-500/20">
            <Wrench className="h-6 w-6" />
          </div>
          <div>
            <h2 className="text-lg font-bold text-slate-100">
              Pillar 1: Terminal CLI Error Healer
            </h2>
            <p className="text-xs text-slate-400">
              Intercepts command-not-found patterns via a 4-Stage System Probe. Locates orphaned binaries, checks Winget catalogs, and provides 1-click PATH resolution.
            </p>
          </div>
        </div>
        <span className="rounded-full border border-orange-500/30 bg-orange-500/10 px-3 py-1 text-xs font-semibold text-orange-400">
          Zero Shell Invocation
        </span>
      </div>

      {/* Input Form */}
      <div className="mt-5 space-y-3">
        <label className="block text-xs font-medium text-slate-300">
          Intercepted Terminal Error Output
        </label>
        <div className="flex gap-2">
          <input
            type="text"
            value={errorText}
            onChange={(e) => setErrorText(e.target.value)}
            placeholder="Paste terminal error (e.g. 'git' is not recognized as an internal or external command)..."
            className="flex-1 rounded-xl border border-slate-700 bg-slate-950 px-4 py-2.5 text-xs font-mono text-slate-200 focus:border-orange-500 focus:outline-none"
          />
          <button
            onClick={() => handleDiagnose()}
            disabled={loading}
            className="flex items-center gap-2 rounded-xl bg-orange-600 hover:bg-orange-500 px-5 py-2.5 text-xs font-semibold text-white shadow-lg shadow-orange-600/20 transition disabled:opacity-50"
          >
            <Terminal className="h-4 w-4" />
            {loading ? 'Probing System...' : 'Diagnose'}
          </button>
        </div>

        {/* Quick Sample Error Chips */}
        <div className="flex flex-wrap items-center gap-2 pt-1 text-xs">
          <span className="text-slate-500 text-[11px]">Quick samples:</span>
          {sampleErrors.map((s, idx) => (
            <button
              key={idx}
              onClick={() => {
                setErrorText(s.text);
                handleDiagnose(s.text);
              }}
              className="rounded-lg border border-slate-800 bg-black/40 hover:bg-slate-800 px-2.5 py-1 text-[11px] text-slate-400 hover:text-slate-200 transition"
            >
              {s.label}
            </button>
          ))}
        </div>
      </div>

      {/* Structured Diagnosis Result */}
      {diagnosis && (
        <div className="mt-5 rounded-xl border border-slate-800 bg-black/50 p-4 space-y-3">
          <div className="flex items-center justify-between border-b border-slate-800/80 pb-3">
            <div className="flex items-center gap-2">
              <span
                className={`rounded-full px-2.5 py-0.5 text-xs font-mono font-bold ${
                  diagnosis.status === 'ALREADY_IN_PATH'
                    ? 'bg-emerald-500/20 text-emerald-400 border border-emerald-500/30'
                    : diagnosis.status === 'FOUND_ON_DISK_NEEDS_PATH'
                    ? 'bg-sky-500/20 text-sky-400 border border-sky-500/30'
                    : diagnosis.status === 'AVAILABLE_VIA_WINGET'
                    ? 'bg-orange-500/20 text-orange-400 border border-orange-500/30'
                    : 'bg-rose-500/20 text-rose-400 border border-rose-500/30'
                }`}
              >
                {diagnosis.status}
              </span>
              <span className="text-xs text-slate-300 font-mono">
                command: <strong>{diagnosis.missing_command}</strong>
              </span>
            </div>
            {diagnosis.winget_package_id && (
              <span className="text-[10px] font-mono text-orange-300 bg-orange-950/40 border border-orange-500/30 px-2 py-0.5 rounded">
                Package: {diagnosis.winget_package_id}
              </span>
            )}
          </div>

          <p className="text-xs text-slate-300">{diagnosis.summary}</p>

          {/* Details if found on disk */}
          {diagnosis.found_executable_path && (
            <div className="rounded-lg bg-slate-950 p-3 text-xs border border-slate-800 space-y-1 font-mono">
              <div className="text-slate-400 text-[11px]">Located Executable:</div>
              <div className="text-sky-300">{diagnosis.found_executable_path}</div>
              <div className="text-slate-400 text-[11px] pt-1">Directory to add to PATH:</div>
              <div className="text-emerald-400">{diagnosis.directory_to_add}</div>
            </div>
          )}

          {/* Suggested Remediation Commands */}
          {diagnosis.suggested_commands.length > 0 && (
            <div className="pt-2">
              <span className="text-[11px] font-mono uppercase text-slate-400 mb-1.5 block">
                Deterministic Remediation Commands:
              </span>
              <div className="space-y-1.5 font-mono text-xs">
                {diagnosis.suggested_commands.map((cmd, i) => (
                  <div
                    key={i}
                    className="flex items-center justify-between gap-2 rounded bg-slate-950 px-3 py-2 text-slate-200 border border-slate-800"
                  >
                    <code className="text-emerald-300 text-xs">{cmd}</code>
                    <button
                      onClick={() => copyToClipboard(cmd, i)}
                      className="flex items-center gap-1 rounded bg-slate-800 hover:bg-slate-700 px-2.5 py-1 text-[11px] text-slate-300 transition shrink-0"
                    >
                      {copiedIndex === i ? (
                        <>
                          <Check className="h-3 w-3 text-emerald-400" />
                          Copied
                        </>
                      ) : (
                        <>
                          <Copy className="h-3 w-3" />
                          Copy
                        </>
                      )}
                    </button>
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  );
};
