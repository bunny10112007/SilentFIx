import React, { useState } from 'react';
import { EyeOff, ShieldCheck, ShieldAlert, Cpu, Lock, AlertTriangle, Layers } from 'lucide-react';

interface ZoneOverlay {
  box: number[];
  label: string;
  flagged: boolean;
  color: string;
  details: string;
}

interface InspectionResult {
  injection_detected: boolean;
  pii_redacted_count: number;
  injections_count: number;
  tier3_guided_only: boolean;
  sanitized_text: string;
  blocked_commands: string[];
  detected_pii_types: string[];
  overlays: ZoneOverlay[];
  redacted_image_base64: string;
}

interface ScreenGuardSectionProps {
  onVoiceAlert?: (text: string, type: string) => void;
}

export const ScreenGuardSection: React.FC<ScreenGuardSectionProps> = ({ onVoiceAlert }) => {
  const [inspection, setInspection] = useState<InspectionResult | null>(null);
  const [loading, setLoading] = useState<boolean>(false);
  const [showOverlays, setShowOverlays] = useState<boolean>(true);
  const [activeTab, setActiveTab] = useState<'preview' | 'sanitized'>('preview');

  const handleRunInspection = async (withInjection: boolean, withPii: boolean) => {
    setLoading(true);
    try {
      const res = await fetch(
        `/api/screen/inspect?simulate_injection=${withInjection}&simulate_pii=${withPii}`,
        { method: 'POST' }
      );
      if (res.ok) {
        const data: InspectionResult = await res.json();
        setInspection(data);

        if (data.injection_detected && onVoiceAlert) {
          onVoiceAlert(
            'Security Warning: Screen Privacy Guard detected prompt injection signatures. Commands blocked and switched to Tier-3 guided-only mode.',
            'SCAM_POPUP_ALERT'
          );
        } else if (onVoiceAlert) {
          onVoiceAlert(
            `Screen inspection complete. ${data.pii_redacted_count} PII elements blurred in RAM with 16-pixel Gaussian blur.`,
            'INSPECTION_CLEAN'
          );
        }
      }
    } catch (err) {
      console.error('Inspection failed:', err);
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="rounded-2xl border border-slate-800 bg-slate-900/60 p-6 backdrop-blur">
      <div className="flex items-center justify-between pb-4 border-b border-slate-800">
        <div className="flex items-center gap-3">
          <div className="rounded-xl bg-purple-500/10 p-2.5 text-purple-400 border border-purple-500/20">
            <EyeOff className="h-6 w-6" />
          </div>
          <div>
            <h2 className="text-lg font-bold text-slate-100">
              Layer 3: Local RapidOCR PII Blurring & Injection Guard
            </h2>
            <p className="text-xs text-slate-400">
              Analyzes screen captures in RAM. Applies 16px Gaussian blur to sensitive PII (emails, cards, tokens), strips prompt injections, and restricts model to <code className="text-purple-400 font-mono">tier3_guided_only</code>.
            </p>
          </div>
        </div>
        {inspection && (
          <span
            className={`rounded-full border px-3 py-1 text-xs font-semibold ${
              inspection.tier3_guided_only
                ? 'border-rose-500/30 bg-rose-500/10 text-rose-400 animate-pulse'
                : 'border-emerald-500/30 bg-emerald-500/10 text-emerald-400'
            }`}
          >
            {inspection.tier3_guided_only ? 'Tier-3 Guided Only (Restricted)' : 'Standard Execution Mode'}
          </span>
        )}
      </div>

      {/* Control Buttons */}
      <div className="mt-4 flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-2">
          <button
            onClick={() => handleRunInspection(true, true)}
            disabled={loading}
            className="rounded-xl bg-purple-600 hover:bg-purple-500 px-4 py-2 text-xs font-semibold text-white shadow-lg shadow-purple-600/20 transition disabled:opacity-50"
          >
            {loading ? 'Processing in RAM...' : 'Run In-Memory Inspection (PII + Injection)'}
          </button>
          <button
            onClick={() => handleRunInspection(false, true)}
            disabled={loading}
            className="rounded-xl border border-slate-700 bg-slate-800 hover:bg-slate-700 px-3.5 py-2 text-xs font-semibold text-slate-300 transition disabled:opacity-50"
          >
            Clean Screen (PII Only)
          </button>
        </div>

        {inspection && (
          <div className="flex items-center gap-2">
            <button
              onClick={() => setActiveTab('preview')}
              className={`rounded-lg px-3 py-1.5 text-xs font-medium transition ${
                activeTab === 'preview'
                  ? 'bg-purple-500/20 text-purple-300 border border-purple-500/30'
                  : 'text-slate-400 hover:text-slate-200'
              }`}
            >
              Blurred RAM Preview
            </button>
            <button
              onClick={() => setActiveTab('sanitized')}
              className={`rounded-lg px-3 py-1.5 text-xs font-medium transition ${
                activeTab === 'sanitized'
                  ? 'bg-purple-500/20 text-purple-300 border border-purple-500/30'
                  : 'text-slate-400 hover:text-slate-200'
              }`}
            >
              Sanitized Text Context
            </button>
          </div>
        )}
      </div>

      {/* Inspection Results Dashboard */}
      {inspection && (
        <div className="mt-4 space-y-4">
          {/* Summary Badges */}
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
            <div className="rounded-xl border border-slate-800 bg-black/40 p-3">
              <span className="text-[10px] text-slate-400 uppercase font-bold block mb-1">
                PII Redactions
              </span>
              <span className="text-xl font-mono font-bold text-sky-400">
                {inspection.pii_redacted_count}
              </span>
              <span className="text-[10px] text-slate-500 block">16px Gaussian blurred</span>
            </div>

            <div className="rounded-xl border border-slate-800 bg-black/40 p-3">
              <span className="text-[10px] text-slate-400 uppercase font-bold block mb-1">
                Injections Blocked
              </span>
              <span className={`text-xl font-mono font-bold ${inspection.injections_count > 0 ? 'text-rose-400' : 'text-emerald-400'}`}>
                {inspection.injections_count}
              </span>
              <span className="text-[10px] text-slate-500 block">Red zone overlays</span>
            </div>

            <div className="rounded-xl border border-slate-800 bg-black/40 p-3">
              <span className="text-[10px] text-slate-400 uppercase font-bold block mb-1">
                Memory Security
              </span>
              <span className="text-sm font-semibold text-emerald-400 flex items-center gap-1 mt-1">
                <Lock className="h-4 w-4" /> Zero Disk Writes
              </span>
              <span className="text-[10px] text-slate-500 block">Kept solely in RAM</span>
            </div>

            <div className="rounded-xl border border-slate-800 bg-black/40 p-3">
              <span className="text-[10px] text-slate-400 uppercase font-bold block mb-1">
                Execution Mode
              </span>
              <span
                className={`text-xs font-bold block mt-1.5 ${
                  inspection.tier3_guided_only ? 'text-amber-400' : 'text-emerald-400'
                }`}
              >
                {inspection.tier3_guided_only ? 'tier3_guided_only' : 'autonomous_safe'}
              </span>
              <span className="text-[10px] text-slate-500 block">Privilege constrained</span>
            </div>
          </div>

          {/* Prompt Injection Alert */}
          {inspection.injection_detected && (
            <div className="rounded-xl border border-rose-500/40 bg-rose-950/40 p-4 text-xs text-rose-200">
              <div className="flex items-start gap-2.5">
                <ShieldAlert className="h-5 w-5 text-rose-400 shrink-0 mt-0.5" />
                <div>
                  <strong className="text-sm font-bold text-rose-100 block">
                    Chunk 1: Prompt Injection Signatures Detected & Blocked
                  </strong>
                  <p className="mt-1 text-rose-300/90">
                    Hostile instruction patterns (e.g., <code className="bg-rose-900/60 px-1 py-0.5 rounded text-white font-mono">Ignore previous instructions</code>, <code className="bg-rose-900/60 px-1 py-0.5 rounded text-white font-mono">powershell -enc</code>) were detected. Commands are stripped from model context and model execution is restricted to safe Tier-3 guided confirmation only.
                  </p>
                </div>
              </div>
            </div>
          )}

          {/* Tab Content */}
          {activeTab === 'preview' ? (
            <div className="relative rounded-xl border border-slate-800 overflow-hidden bg-black/90 flex flex-col items-center p-3">
              <div className="w-full flex items-center justify-between text-xs text-slate-400 mb-2 px-2">
                <span>In-Memory Redacted Preview (16px Gaussian Blur on PII, Red Border on Injections)</span>
                <span className="text-[10px] font-mono text-emerald-400">Safe for AWS S3 Archiving</span>
              </div>
              <img
                src={inspection.redacted_image_base64}
                alt="PII Redacted Screen"
                className="max-h-72 rounded-lg border border-slate-800 shadow-2xl object-contain"
              />
            </div>
          ) : (
            <div className="rounded-xl border border-slate-800 bg-black/70 p-4 font-mono text-xs">
              <div className="text-slate-400 mb-2 text-[10px] uppercase font-bold">
                Chunk 3: Sanitized Context Passed to Model (Malicious Lines Stripped)
              </div>
              <pre className="whitespace-pre-wrap text-emerald-300">
                {inspection.sanitized_text}
              </pre>
            </div>
          )}
        </div>
      )}
    </div>
  );
};
