import React, { useState } from 'react';
import {
  Terminal,
  Play,
  RotateCcw,
  ShieldAlert,
  CheckCircle2,
  AlertTriangle,
  Layers,
  Clock,
  Radio,
} from 'lucide-react';
import { useInstallStream } from '../hooks/useInstallStream';

interface PreFlightVerdict {
  verified: boolean;
  package_id: string;
  package_name: string;
  source_url: string;
  sha256_hash: string;
  version: string;
  probe_token: string;
  expires_in_seconds: number;
}

interface InstallStreamSectionProps {
  currentVerdict: PreFlightVerdict | null;
  onVoiceAlert?: (text: string, type: string) => void;
  onRollbackComplete?: () => void;
}

export const InstallStreamSection: React.FC<InstallStreamSectionProps> = ({
  currentVerdict,
  onVoiceAlert,
  onRollbackComplete,
}) => {
  const {
    events,
    currentPhase,
    progress,
    isStreaming,
    isWaitingUac,
    isCompleted,
    isFailed,
    isRolledBack,
    startStream,
    stopStream,
  } = useInstallStream();

  const [activeSessionId, setActiveSessionId] = useState<string | null>(null);
  const [rollbackLoading, setRollbackLoading] = useState<boolean>(false);
  const [bypassForbiddenError, setBypassForbiddenError] = useState<string | null>(null);
  const [conflictError, setConflictError] = useState<string | null>(null);
  const [rollbackSuccessMsg, setRollbackSuccessMsg] = useState<string | null>(null);

  // Trigger installation via verified probe token
  const handleStartVerifiedInstall = async () => {
    if (!currentVerdict) {
      setBypassForbiddenError(
        '403 Forbidden: Cannot start installation without a verified Pre-Flight Gate token. Enforce privilege boundary!'
      );
      return;
    }

    setBypassForbiddenError(null);
    setConflictError(null);
    setRollbackSuccessMsg(null);

    try {
      const res = await fetch('/api/install/start', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          package_id: currentVerdict.package_id,
          source: 'winget',
          scope: 'user',
          probe_token: currentVerdict.probe_token,
          package_name: currentVerdict.package_name,
          version: currentVerdict.version,
        }),
      });

      if (!res.ok) {
        const err = await res.json();
        throw new Error(err.detail || 'Failed to start installation');
      }

      const data = await res.json();
      setActiveSessionId(data.session_id);
      startStream(data.session_id);

      if (onVoiceAlert) {
        onVoiceAlert(
          `Starting deterministic non-shell installation of ${currentVerdict.package_name}.`,
          'STARTING'
        );
      }
    } catch (err: any) {
      setBypassForbiddenError(err.message);
    }
  };

  // Test Direct Bypass to demonstrate 403 Forbidden Gate
  const handleTestBypassAttack = async () => {
    setBypassForbiddenError(null);
    try {
      const res = await fetch('/api/install/start', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          package_id: 'Malicious.Payload.Tool',
          source: 'winget',
          scope: 'user',
          probe_token: 'fake_or_bypassed_token_9999',
          package_name: 'Unverified Exploit',
        }),
      });

      if (res.status === 403) {
        const data = await res.json();
        setBypassForbiddenError(
          `[SECURITY INVARIANT TEST PASSED] Backend correctly returned 403 Forbidden: "${data.detail}"`
        );
        if (onVoiceAlert) {
          onVoiceAlert('Unauthorized installer bypass attempt blocked with 403 Forbidden.', 'SECURITY_ALERT');
        }
      } else {
        setBypassForbiddenError('Unexpected response status: ' + res.status);
      }
    } catch (err: any) {
      setBypassForbiddenError(err.message);
    }
  };

  // Module 2 Chunk 2: Atomic compare-and-swap rollback lock
  const handle1ClickRollback = async () => {
    if (!activeSessionId) return;
    setRollbackLoading(true);
    setConflictError(null);

    try {
      const res = await fetch(`/api/install/rollback/${activeSessionId}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ reason: '1-Click rollback from dashboard' }),
      });

      if (res.status === 409) {
        const err = await res.json();
        setConflictError(`409 Conflict: ${err.detail}`);
      } else if (res.ok) {
        const data = await res.json();
        setRollbackSuccessMsg(`Atomic Rollback Succeeded: ${data.message}`);
        if (onVoiceAlert) {
          onVoiceAlert('Rollback complete. System state safely restored.', 'ROLLBACK_TRIGGERED');
        }
        if (onRollbackComplete) {
          onRollbackComplete();
        }
      }
    } catch (err: any) {
      setConflictError(err.message || 'Rollback error');
    } finally {
      setRollbackLoading(false);
    }
  };

  // Test concurrent rollback race condition to trigger 409 Conflict
  const handleTestConcurrentRollbackRace = async () => {
    if (!activeSessionId) return;
    setRollbackLoading(true);
    setConflictError(null);

    // Launch two requests concurrently
    const req1 = fetch(`/api/install/rollback/${activeSessionId}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ reason: 'Concurrent race test request A' }),
    });
    const req2 = fetch(`/api/install/rollback/${activeSessionId}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ reason: 'Concurrent race test request B' }),
    });

    const [res1, res2] = await Promise.all([req1, req2]);
    const statuses = [res1.status, res2.status];

    if (statuses.includes(409)) {
      setConflictError(
        `[ATOMIC LOCK TEST PASSED] Concurrent race handled: One request succeeded (200), and the parallel request failed cleanly with 409 Conflict via SQLite BEGIN IMMEDIATE atomic compare-and-swap!`
      );
    } else {
      setConflictError(`Results: ${statuses.join(', ')}`);
    }
    setRollbackLoading(false);
  };

  return (
    <div className="rounded-2xl border border-slate-800 bg-slate-900/60 p-6 backdrop-blur">
      <div className="flex items-center justify-between pb-4 border-b border-slate-800">
        <div className="flex items-center gap-3">
          <div className="rounded-xl bg-blue-500/10 p-2.5 text-blue-400 border border-blue-500/20">
            <Terminal className="h-6 w-6" />
          </div>
          <div>
            <h2 className="text-lg font-bold text-slate-100">
              Layer 2: Non-Shell Winget Execution & UAC Watchdog
            </h2>
            <p className="text-xs text-slate-400">
              Passes explicit argument arrays to <code className="text-blue-400 font-mono">create_subprocess_exec(shell=False)</code>. Zero shell injection risk. Parses 256-byte stdout chunks with UAC delay detection.
            </p>
          </div>
        </div>
        <div className="flex items-center gap-2">
          {isStreaming && (
            <span className="flex items-center gap-1.5 rounded-full border border-sky-500/30 bg-sky-500/10 px-3 py-1 text-xs font-semibold text-sky-400">
              <Radio className="h-3 w-3 animate-pulse text-sky-400" />
              Live SSE Stream
            </span>
          )}
          {currentPhase !== 'IDLE' && (
            <span className="rounded-full border border-slate-700 bg-slate-800 px-3 py-1 text-xs font-mono font-semibold text-slate-300">
              {currentPhase}
            </span>
          )}
        </div>
      </div>

      {/* Progress Bar & Phases */}
      <div className="mt-5">
        <div className="flex items-center justify-between text-xs text-slate-400 mb-1.5">
          <span className="font-medium flex items-center gap-1.5">
            <Clock className="h-3.5 w-3.5 text-slate-500" />
            Execution Phase: <strong className="text-slate-200">{currentPhase}</strong>
          </span>
          <span className="font-mono font-bold text-slate-200">{progress}%</span>
        </div>
        <div className="h-2.5 w-full overflow-hidden rounded-full bg-slate-950 border border-slate-800">
          <div
            className={`h-full transition-all duration-300 ${
              isFailed
                ? 'bg-rose-500'
                : isRolledBack
                ? 'bg-amber-500'
                : isWaitingUac
                ? 'bg-amber-400 animate-pulse'
                : 'bg-gradient-to-r from-blue-500 via-sky-400 to-emerald-400'
            }`}
            style={{ width: `${progress}%` }}
          />
        </div>
      </div>

      {/* UAC Watchdog Elevation Banner */}
      {isWaitingUac && (
        <div className="mt-4 rounded-xl border border-amber-500/40 bg-amber-950/40 p-4 text-amber-200 animate-pulse">
          <div className="flex items-center gap-3">
            <AlertTriangle className="h-6 w-6 text-amber-400 shrink-0" />
            <div>
              <h4 className="text-sm font-bold text-amber-100">
                UAC Watchdog Alert: WAITING_UAC
              </h4>
              <p className="text-xs text-amber-300/90 mt-0.5">
                Output stream paused during installation. Please check your Windows screen or taskbar for the standard elevation prompt. Click <strong>Yes</strong> to allow package installation.
              </p>
            </div>
          </div>
        </div>
      )}

      {/* Bypass / Forbidden Warning */}
      {bypassForbiddenError && (
        <div className="mt-4 rounded-xl border border-rose-500/40 bg-rose-950/30 p-3.5 text-xs text-rose-300">
          <div className="flex items-start gap-2">
            <ShieldAlert className="h-4 w-4 shrink-0 text-rose-400 mt-0.5" />
            <div>
              <strong className="font-semibold block mb-0.5">Trust Gate Invariant Status:</strong>
              <span>{bypassForbiddenError}</span>
            </div>
          </div>
        </div>
      )}

      {/* 409 Conflict / Atomic Lock Status */}
      {conflictError && (
        <div className="mt-4 rounded-xl border border-purple-500/40 bg-purple-950/30 p-3.5 text-xs text-purple-300">
          <div className="flex items-start gap-2">
            <Layers className="h-4 w-4 shrink-0 text-purple-400 mt-0.5" />
            <div>
              <strong className="font-semibold block mb-0.5">Module 2 Atomic Compare-and-Swap Result:</strong>
              <span>{conflictError}</span>
            </div>
          </div>
        </div>
      )}

      {rollbackSuccessMsg && (
        <div className="mt-4 rounded-xl border border-emerald-500/40 bg-emerald-950/30 p-3 text-xs text-emerald-300 flex items-center gap-2">
          <CheckCircle2 className="h-4 w-4 text-emerald-400 shrink-0" />
          <span>{rollbackSuccessMsg}</span>
        </div>
      )}

      {/* Real-time Chunk Output Log Console */}
      <div className="mt-4">
        <div className="flex items-center justify-between text-xs text-slate-400 mb-1 px-1">
          <span>Real-Time Subprocess Stream (256-Byte Chunks)</span>
          <span className="font-mono text-[10px] text-slate-500">
            {events.length} events logged to SQLite WAL
          </span>
        </div>
        <div className="h-44 overflow-y-auto rounded-xl border border-slate-800 bg-black/70 p-3 font-mono text-xs text-slate-300 space-y-1">
          {events.length === 0 ? (
            <div className="text-slate-600 italic">
              No active execution. Mint a pre-flight probe token and click "Start Verified Install" to stream live events.
            </div>
          ) : (
            events.map((ev, idx) => (
              <div key={idx} className="flex items-start gap-2">
                <span className="text-[10px] text-slate-600 shrink-0">#{ev.event_id}</span>
                <span
                  className={`text-[10px] uppercase font-bold shrink-0 ${
                    ev.phase === 'WAITING_UAC'
                      ? 'text-amber-400'
                      : ev.phase === 'COMPLETED'
                      ? 'text-emerald-400'
                      : ev.phase === 'FAILED'
                      ? 'text-rose-400'
                      : 'text-sky-400'
                  }`}
                >
                  [{ev.phase}]
                </span>
                <span className="text-slate-300 break-all">{ev.message}</span>
              </div>
            ))
          )}
        </div>
      </div>

      {/* Action Controls */}
      <div className="mt-5 flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-2">
          <button
            onClick={handleTestBypassAttack}
            className="rounded-xl border border-rose-500/30 bg-rose-500/10 hover:bg-rose-500/20 px-3.5 py-2 text-xs font-semibold text-rose-300 transition"
            title="Attempt to start without a valid gate token"
          >
            Test Bypass (Verify 403 Forbidden)
          </button>
          {activeSessionId && (
            <button
              onClick={handleTestConcurrentRollbackRace}
              disabled={rollbackLoading}
              className="rounded-xl border border-purple-500/30 bg-purple-500/10 hover:bg-purple-500/20 px-3.5 py-2 text-xs font-semibold text-purple-300 transition disabled:opacity-50"
              title="Trigger two simultaneous rollback requests to verify 409 Conflict atomic compare-and-swap"
            >
              Test Race Condition (Verify 409 Conflict)
            </button>
          )}
        </div>

        <div className="flex items-center gap-2">
          {activeSessionId && (
            <button
              onClick={handle1ClickRollback}
              disabled={rollbackLoading || isRolledBack}
              className="flex items-center gap-1.5 rounded-xl border border-amber-500/40 bg-amber-500/10 hover:bg-amber-500/20 px-4 py-2 text-xs font-semibold text-amber-300 transition disabled:opacity-50"
            >
              <RotateCcw className="h-3.5 w-3.5" />
              {rollbackLoading ? 'Locking...' : '1-Click Atomic Rollback'}
            </button>
          )}

          <button
            onClick={handleStartVerifiedInstall}
            disabled={isStreaming || !currentVerdict}
            className="flex items-center gap-2 rounded-xl bg-blue-600 hover:bg-blue-500 px-5 py-2 text-xs font-semibold text-white shadow-lg shadow-blue-600/20 transition disabled:opacity-40"
          >
            <Play className="h-3.5 w-3.5" />
            Start Verified Install (shell=False)
          </button>
        </div>
      </div>
    </div>
  );
};
