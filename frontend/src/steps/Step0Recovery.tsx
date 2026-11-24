import React, { useEffect, useState } from 'react';
import { motion } from 'framer-motion';
import {
  AlertTriangle,
  RotateCcw,
  XCircle,
  CheckCircle2,
  RefreshCw,
  ArrowRight,
  ShieldCheck,
  Activity,
} from 'lucide-react';
import { WorkflowStep } from '../workflow/WorkflowFSM';

interface RecoverySession {
  session_id: string;
  package_id: string;
  previous_status?: string;
  status?: string;
  updated_at?: string;
}

interface Step0RecoveryProps {
  onComplete: () => void;
  onLog: (step: WorkflowStep, level: 'info' | 'success' | 'warning' | 'error', msg: string, detail?: string) => void;
  onVoiceAlert?: (text: string, type: string) => void;
}

export const Step0Recovery: React.FC<Step0RecoveryProps> = ({
  onComplete,
  onLog,
  onVoiceAlert,
}) => {
  const [recoveries, setRecoveries] = useState<RecoverySession[]>([]);
  const [loading, setLoading] = useState<boolean>(true);
  const [resolvingId, setResolvingId] = useState<string | null>(null);
  const [actionMessage, setActionMessage] = useState<string | null>(null);

  const checkRecoveries = async () => {
    setLoading(true);
    try {
      const res = await fetch('/api/recovery/pending');
      if (res.ok) {
        const data = await res.json();
        const sess = data.sessions || [];
        setRecoveries(sess);
        if (sess.length > 0) {
          onLog(WorkflowStep.RECOVERY, 'warning', `Crash sweep detected ${sess.length} interrupted session(s)`, sess.map((s: any) => s.package_id).join(', '));
        } else {
          onLog(WorkflowStep.RECOVERY, 'info', 'Startup sweep complete: zero interrupted sessions found');
        }
      }
    } catch (err: any) {
      onLog(WorkflowStep.RECOVERY, 'error', 'Failed to fetch pending recoveries', err.message);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    checkRecoveries();
  }, []);

  const handleResolve = async (sessionId: string, action: 'rollback' | 'dismiss') => {
    setResolvingId(sessionId);
    try {
      const res = await fetch(`/api/recovery/resolve/${sessionId}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action }),
      });
      if (res.ok) {
        const data = await res.json();
        setActionMessage(data.message);
        onLog(WorkflowStep.RECOVERY, 'success', `Session ${sessionId} resolved with ${action}`, data.message);
        if (onVoiceAlert) {
          onVoiceAlert(`Interrupted session ${sessionId} resolved with ${action}. System integrity restored.`, 'RECOVERY_RESOLVED');
        }
        await checkRecoveries();
      } else {
        const err = await res.json();
        onLog(WorkflowStep.RECOVERY, 'error', `Resolution failed: ${err.detail || res.statusText}`);
      }
    } catch (err: any) {
      onLog(WorkflowStep.RECOVERY, 'error', `Network error during recovery resolve`, err.message);
    } finally {
      setResolvingId(null);
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
            <div className="flex h-11 w-11 items-center justify-center rounded-xl bg-amber-500/10 border border-amber-500/20 text-amber-400 shrink-0">
              <AlertTriangle className="h-5 w-5" />
            </div>
            <div>
              <div className="flex items-center gap-2">
                <span className="text-[11px] font-mono uppercase tracking-wider text-amber-400 font-semibold">
                  Step 1 of 6
                </span>
                <span className="rounded bg-amber-500/10 border border-amber-500/20 px-1.5 py-0.2 text-[10px] font-mono text-amber-300">
                  WAL Startup Sweep
                </span>
              </div>
              <h2 className="text-lg font-bold text-slate-100 mt-1">
                Crash Recovery &amp; State Sanity Verification
              </h2>
              <p className="text-xs text-slate-400 mt-1 max-w-2xl leading-relaxed">
                SilentFix queries the transactional SQLite WAL database (<code className="text-amber-300 font-mono">install_executions</code>) for orphaned packages left in <code className="text-amber-300 font-mono">EXECUTING</code> or <code className="text-amber-300 font-mono">SNAPSHOTTED</code> states from system crashes or sudden reboots.
              </p>
            </div>
          </div>

          <button
            onClick={checkRecoveries}
            disabled={loading}
            className="btn-secondary shrink-0"
            title="Re-run sweep"
          >
            <RefreshCw className={`h-3.5 w-3.5 ${loading ? 'animate-spin' : ''}`} />
            Sweep Now
          </button>
        </div>
      </div>

      {/* Action Notification Banner */}
      {actionMessage && (
        <motion.div
          initial={{ opacity: 0, height: 0 }}
          animate={{ opacity: 1, height: 'auto' }}
          className="rounded-xl border border-emerald-500/30 bg-emerald-950/20 p-4 flex items-center justify-between text-xs text-emerald-300"
        >
          <div className="flex items-center gap-2">
            <CheckCircle2 className="h-4 w-4 text-emerald-400 shrink-0" />
            <span className="font-mono">{actionMessage}</span>
          </div>
          <button
            onClick={() => setActionMessage(null)}
            className="text-slate-400 hover:text-slate-200 text-xs px-2 py-0.5 rounded border border-slate-700/60"
          >
            Dismiss
          </button>
        </motion.div>
      )}

      {/* Status Box */}
      {recoveries.length > 0 ? (
        <div className="glass-card border-amber-500/30 bg-amber-950/15 p-6 space-y-4">
          <div className="flex items-center gap-2.5 text-amber-300 font-semibold text-sm">
            <Activity className="h-4 w-4 animate-pulse text-amber-400" />
            <span>{recoveries.length} Interrupted Session(s) Requiring Attention</span>
          </div>
          <p className="text-xs text-slate-300">
            The following installations were detected in an unfinished state prior to launch. You can execute an atomic rollback to remove residual files or dismiss the recovery session.
          </p>

          <div className="space-y-3 pt-2">
            {recoveries.map((s) => (
              <div
                key={s.session_id}
                className="flex flex-wrap items-center justify-between gap-3 rounded-lg border border-amber-500/20 bg-black/40 p-3.5"
              >
                <div className="space-y-1">
                  <div className="flex items-center gap-2">
                    <span className="font-mono font-bold text-amber-300 text-xs">{s.package_id}</span>
                    <span className="rounded bg-amber-500/10 px-1.5 py-0.5 text-[10px] font-mono text-amber-400 border border-amber-500/20">
                      {s.status || s.previous_status || 'INTERRUPTED'}
                    </span>
                  </div>
                  <div className="text-[11px] font-mono text-slate-500">
                    Session ID: {s.session_id}
                  </div>
                </div>

                <div className="flex items-center gap-2">
                  <button
                    disabled={resolvingId === s.session_id}
                    onClick={() => handleResolve(s.session_id, 'rollback')}
                    className="btn-danger"
                  >
                    <RotateCcw className={`h-3.5 w-3.5 ${resolvingId === s.session_id ? 'animate-spin' : ''}`} />
                    1-Click Rollback
                  </button>
                  <button
                    disabled={resolvingId === s.session_id}
                    onClick={() => handleResolve(s.session_id, 'dismiss')}
                    className="btn-secondary"
                  >
                    <XCircle className="h-3.5 w-3.5 text-slate-400" />
                    Dismiss
                  </button>
                </div>
              </div>
            ))}
          </div>
        </div>
      ) : (
        <div className="glass-card p-6 flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-emerald-500/10 border border-emerald-500/20 text-emerald-400">
              <ShieldCheck className="h-5 w-5" />
            </div>
            <div>
              <div className="text-sm font-semibold text-slate-200">
                System State Verified Clean
              </div>
              <div className="text-xs text-slate-400 mt-0.5">
                No incomplete operations or corrupt transactions found in SQLite WAL ledger.
              </div>
            </div>
          </div>
          <span className="rounded-full border border-emerald-500/30 bg-emerald-500/10 px-3 py-1 text-xs font-mono font-medium text-emerald-400">
            ALL SYSTEMS NOMINAL
          </span>
        </div>
      )}

      {/* Navigation Controls */}
      <div className="flex items-center justify-between pt-2">
        <div className="text-xs text-slate-500">
          Gate Requirement: System sweep must be reviewed before pre-flight token minting.
        </div>
        <button
          onClick={onComplete}
          className="btn-primary"
        >
          <span>Acknowledge &amp; Proceed to Trust Gate</span>
          <ArrowRight className="h-4 w-4" />
        </button>
      </div>
    </motion.div>
  );
};
