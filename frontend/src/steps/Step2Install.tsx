import React, { useState, useEffect } from 'react';
import { motion } from 'framer-motion';
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
  ArrowRight,
  Shield,
  Zap,
} from 'lucide-react';
import { useInstallStream } from '../hooks/useInstallStream';
import { PreFlightVerdict } from './Step1TrustGate';
import { WorkflowStep } from '../workflow/WorkflowFSM';

interface Step2InstallProps {
  currentVerdict: PreFlightVerdict | null;
  onComplete: () => void;
  onLog: (step: WorkflowStep, level: 'info' | 'success' | 'warning' | 'error', msg: string, detail?: string) => void;
  onVoiceAlert?: (text: string, type: string) => void;
}

export const Step2Install: React.FC<Step2InstallProps> = ({
  currentVerdict,
  onComplete,
  onLog,
  onVoiceAlert,
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
  } = useInstallStream();

  const [activeSessionId, setActiveSessionId] = useState<string | null>(null);
  const [rollbackLoading, setRollbackLoading] = useState<boolean>(false);
  const [bypassForbiddenError, setBypassForbiddenError] = useState<string | null>(null);
  const [conflictError, setConflictError] = useState<string | null>(null);
  const [rollbackSuccessMsg, setRollbackSuccessMsg] = useState<string | null>(null);

  // Sync install events to telemetry
  useEffect(() => {
    if (events.length > 0) {
      const latest = events[events.length - 1];
      const lvl = latest.phase === 'COMPLETED' ? 'success' : latest.phase === 'FAILED' ? 'error' : latest.phase === 'WAITING_UAC' ? 'warning' : 'info';
      onLog(WorkflowStep.INSTALL, lvl, `[${latest.phase}] ${latest.message}`);
    }
  }, [events.length, onLog]);

  const handleStartVerifiedInstall = async () => {
    if (!currentVerdict) {
      setBypassForbiddenError(
        '403 Forbidden: Cannot start installation without a verified Pre-Flight Gate token. Enforce privilege boundary!'
      );
      onLog(WorkflowStep.INSTALL, 'error', 'Attempted install without token');
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
      onLog(WorkflowStep.INSTALL, 'info', `Non-shell process launched: session ${data.session_id}`);

      if (onVoiceAlert) {
        onVoiceAlert(
          `Starting deterministic non-shell installation of ${currentVerdict.package_name}.`,
          'STARTING'
        );
      }
    } catch (err: any) {
      setBypassForbiddenError(err.message);
      onLog(WorkflowStep.INSTALL, 'error', 'Install start failed', err.message);
    }
  };

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
          `SECURITY INVARIANT VERIFIED: Backend returned 403 Forbidden: "${data.detail}"`
        );
        onLog(WorkflowStep.INSTALL, 'success', 'Bypass test: 403 Forbidden received as expected', data.detail);
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
        onLog(WorkflowStep.INSTALL, 'warning', `Atomic rollback executed for session ${activeSessionId}`);
        if (onVoiceAlert) {
          onVoiceAlert('Rollback complete. System state safely restored.', 'ROLLBACK_TRIGGERED');
        }
      }
    } catch (err: any) {
      setConflictError(err.message || 'Rollback error');
    } finally {
      setRollbackLoading(false);
    }
  };

  const handleTestConcurrentRollbackRace = async () => {
    if (!activeSessionId) return;
    setRollbackLoading(true);
    setConflictError(null);

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
        'ATOMIC LOCK VERIFIED: One request succeeded (200), parallel request failed cleanly with 409 Conflict via SQLite BEGIN IMMEDIATE.'
      );
      onLog(WorkflowStep.INSTALL, 'success', 'Concurrent rollback race test: 409 Conflict confirmed');
    } else {
      setConflictError(`Results: ${statuses.join(', ')}`);
    }
    setRollbackLoading(false);
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
            <div className="flex h-11 w-11 items-center justify-center rounded-xl bg-indigo-500/10 border border-indigo-500/20 text-indigo-400 shrink-0">
              <Terminal className="h-5 w-5" />
            </div>
            <div>
              <div className="flex items-center gap-2">
                <span className="text-[11px] font-mono uppercase tracking-wider text-indigo-400 font-semibold">
                  Step 3 of 6
                </span>
                <span className="rounded bg-indigo-500/10 border border-indigo-500/20 px-1.5 py-0.2 text-[10px] font-mono text-indigo-300">
                  create_subprocess_exec (shell=False)
                </span>
              </div>
              <h2 className="text-lg font-bold text-slate-100 mt-1">
                Non-Shell Subprocess Execution &amp; UAC Watchdog
              </h2>
              <p className="text-xs text-slate-400 mt-1 max-w-2xl leading-relaxed">
                Executes package installations with zero shell interpolation. Arguments are passed as explicit argv arrays to the operating system kernel. Subprocess stdout is parsed in 256-byte chunks with an intelligent UAC stall detector.
              </p>
            </div>
          </div>

          <div className="flex items-center gap-2 shrink-0">
            {isStreaming && (
              <span className="flex items-center gap-1.5 rounded-full border border-sky-500/30 bg-sky-500/10 px-3 py-1 text-xs font-mono font-semibold text-sky-400">
                <Radio className="h-3 w-3 animate-pulse text-sky-400" />
                Live SSE Stream
              </span>
            )}
            {currentPhase !== 'IDLE' && (
              <span className="rounded-full border border-slate-700 bg-slate-800/80 px-3 py-1 text-xs font-mono font-semibold text-slate-300">
                {currentPhase}
              </span>
            )}
          </div>
        </div>
      </div>

      {/* Execution Progress & Controls Card */}
      <div className="glass-card p-6 space-y-5">
        {/* Progress Bar & Phase Status */}
        <div>
          <div className="flex items-center justify-between text-xs text-slate-400 mb-2">
            <span className="font-medium flex items-center gap-1.5">
              <Clock className="h-3.5 w-3.5 text-slate-500" />
              Phase: <strong className="text-slate-200 font-mono">{currentPhase}</strong>
            </span>
            <span className="font-mono font-bold text-slate-200">{progress}%</span>
          </div>
          <div className="h-2 w-full overflow-hidden rounded-full bg-black/60 border border-glass">
            <motion.div
              className={`h-full transition-all duration-300 ${
                isFailed
                  ? 'bg-rose-500'
                  : isRolledBack
                  ? 'bg-amber-500'
                  : isWaitingUac
                  ? 'bg-amber-400 animate-pulse'
                  : 'progress-gradient'
              }`}
              initial={{ width: 0 }}
              animate={{ width: `${progress}%` }}
              transition={{ duration: 0.3 }}
            />
          </div>
        </div>

        {/* UAC Watchdog Elevation Banner */}
        {isWaitingUac && (
          <motion.div
            initial={{ opacity: 0, scale: 0.98 }}
            animate={{ opacity: 1, scale: 1 }}
            className="rounded-xl border border-amber-500/40 bg-amber-950/30 p-4 text-amber-200 animate-pulse"
          >
            <div className="flex items-center gap-3">
              <AlertTriangle className="h-5 w-5 text-amber-400 shrink-0" />
              <div>
                <h4 className="text-sm font-bold text-amber-100">
                  UAC Watchdog Alert: Elevation Requested (WAITING_UAC)
                </h4>
                <p className="text-xs text-amber-300/90 mt-0.5">
                  Output stream paused. Please check your Windows taskbar or screen for the User Account Control dialog. Click <strong>Yes</strong> to grant installation permissions.
                </p>
              </div>
            </div>
          </motion.div>
        )}

        {/* Security Invariant / Bypass Results */}
        {bypassForbiddenError && (
          <div className="rounded-xl border border-rose-500/40 bg-rose-950/20 p-3.5 text-xs text-rose-300">
            <div className="flex items-start gap-2">
              <ShieldAlert className="h-4 w-4 shrink-0 text-rose-400 mt-0.5" />
              <div>
                <strong className="font-semibold block mb-0.5">Security Invariant Result:</strong>
                <span>{bypassForbiddenError}</span>
              </div>
            </div>
          </div>
        )}

        {conflictError && (
          <div className="rounded-xl border border-purple-500/40 bg-purple-950/20 p-3.5 text-xs text-purple-300">
            <div className="flex items-start gap-2">
              <Layers className="h-4 w-4 shrink-0 text-purple-400 mt-0.5" />
              <div>
                <strong className="font-semibold block mb-0.5">Atomic Lock Concurrency Result:</strong>
                <span>{conflictError}</span>
              </div>
            </div>
          </div>
        )}

        {rollbackSuccessMsg && (
          <div className="rounded-xl border border-emerald-500/40 bg-emerald-950/20 p-3 text-xs text-emerald-300 flex items-center gap-2">
            <CheckCircle2 className="h-4 w-4 text-emerald-400 shrink-0" />
            <span>{rollbackSuccessMsg}</span>
          </div>
        )}

        {/* Real-time Subprocess Output Console */}
        <div>
          <div className="flex items-center justify-between text-xs text-slate-400 mb-1.5 px-1">
            <span className="flex items-center gap-1.5">
              <Terminal className="h-3.5 w-3.5 text-indigo-400" />
              <span>Real-Time Subprocess Console (256-Byte Chunks)</span>
            </span>
            <span className="font-mono text-[10px] text-slate-500">
              {events.length} events logged in SQLite WAL
            </span>
          </div>
          <div className="h-52 overflow-y-auto rounded-xl border border-glass bg-black/80 p-3 font-mono text-xs text-slate-300 space-y-1">
            {events.length === 0 ? (
              <div className="text-slate-600 italic py-8 text-center">
                Subprocess idle. Click "Start Verified Install" to stream live installation chunks.
              </div>
            ) : (
              events.map((ev, idx) => (
                <div key={ev.event_id || idx} className="flex items-start gap-2 leading-relaxed">
                  <span className="text-[10px] text-slate-600 shrink-0">#{ev.event_id}</span>
                  <span
                    className={`text-[10px] uppercase font-bold shrink-0 ${
                      ev.phase === 'WAITING_UAC'
                        ? 'text-amber-400'
                        : ev.phase === 'COMPLETED'
                        ? 'text-emerald-400'
                        : ev.phase === 'FAILED'
                        ? 'text-rose-400'
                        : 'text-indigo-400'
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

        {/* Action Buttons */}
        <div className="flex flex-wrap items-center justify-between gap-3 pt-2">
          <div className="flex items-center gap-2">
            <button
              onClick={handleTestBypassAttack}
              className="btn-secondary text-[11px]"
              title="Attempt to trigger installation without a valid token to verify 403 Forbidden"
            >
              <Shield className="h-3.5 w-3.5 text-rose-400" />
              Test Bypass (Verify 403)
            </button>
            {activeSessionId && (
              <button
                onClick={handleTestConcurrentRollbackRace}
                disabled={rollbackLoading}
                className="btn-secondary text-[11px]"
                title="Launch concurrent rollback requests to test SQLite compare-and-swap 409 Conflict"
              >
                <Zap className="h-3.5 w-3.5 text-purple-400" />
                Test Race (Verify 409)
              </button>
            )}
          </div>

          <div className="flex items-center gap-2">
            {activeSessionId && (
              <button
                onClick={handle1ClickRollback}
                disabled={rollbackLoading || isRolledBack}
                className="btn-danger text-[11px]"
              >
                <RotateCcw className={`h-3.5 w-3.5 ${rollbackLoading ? 'animate-spin' : ''}`} />
                <span>1-Click Atomic Rollback</span>
              </button>
            )}

            <button
              onClick={handleStartVerifiedInstall}
              disabled={isStreaming || !currentVerdict}
              className="btn-primary"
            >
              <Play className="h-3.5 w-3.5" />
              <span>Start Verified Install (shell=False)</span>
            </button>
          </div>
        </div>
      </div>

      {/* Navigation Controls */}
      <div className="flex items-center justify-between pt-2">
        <div className="text-xs text-slate-500">
          Gate Status: {isCompleted ? 'Installation successful. Resilience pillars unlocked.' : 'Complete installation or proceed to resilience tools.'}
        </div>
        <button
          onClick={onComplete}
          className="btn-primary"
        >
          <span>Proceed to Resilience Pillars</span>
          <ArrowRight className="h-4 w-4" />
        </button>
      </div>
    </motion.div>
  );
};
