import React, { useEffect, useState } from 'react';
import { AlertTriangle, RefreshCw, RotateCcw, XCircle } from 'lucide-react';

interface RecoverySession {
  session_id: string;
  package_id: string;
  previous_status?: string;
  status?: string;
  updated_at?: string;
}

interface RecoveryBannerProps {
  onRollbackTriggered?: (sessionId: string) => void;
}

export const RecoveryBanner: React.FC<RecoveryBannerProps> = ({ onRollbackTriggered }) => {
  const [recoveries, setRecoveries] = useState<RecoverySession[]>([]);
  const [loading, setLoading] = useState<boolean>(false);
  const [actionMessage, setActionMessage] = useState<string | null>(null);

  const checkRecoveries = async () => {
    try {
      const res = await fetch('/api/recovery/pending');
      if (res.ok) {
        const data = await res.json();
        setRecoveries(data.sessions || []);
      }
    } catch (err) {
      console.warn('Failed to fetch pending recoveries:', err);
    }
  };

  useEffect(() => {
    checkRecoveries();
  }, []);

  const handleResolve = async (sessionId: string, action: 'rollback' | 'dismiss') => {
    setLoading(true);
    try {
      const res = await fetch(`/api/recovery/resolve/${sessionId}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action }),
      });
      if (res.ok) {
        const data = await res.json();
        setActionMessage(data.message);
        checkRecoveries();
        if (action === 'rollback' && onRollbackTriggered) {
          onRollbackTriggered(sessionId);
        }
      }
    } catch (err) {
      console.error('Failed to resolve recovery:', err);
    } finally {
      setLoading(false);
    }
  };

  if (recoveries.length === 0 && !actionMessage) {
    return null;
  }

  return (
    <div className="mb-6 rounded-xl border border-amber-500/40 bg-amber-950/30 p-4 backdrop-blur shadow-lg shadow-amber-950/20">
      <div className="flex items-start justify-between gap-4">
        <div className="flex items-start gap-3">
          <div className="rounded-lg bg-amber-500/20 p-2 text-amber-400">
            <AlertTriangle className="h-6 w-6 animate-pulse" />
          </div>
          <div>
            <h3 className="text-base font-semibold text-amber-200">
              Module 1: Crash Recovery Sweep Detected Interrupted Installation
            </h3>
            <p className="mt-1 text-sm text-amber-300/80">
              SilentFix startup sweep detected {recoveries.length} session(s) left in <code className="text-amber-100 bg-amber-900/60 px-1 py-0.5 rounded">EXECUTING</code> or <code className="text-amber-100 bg-amber-900/60 px-1 py-0.5 rounded">SNAPSHOTTED</code> state prior to reboot.
            </p>
            {actionMessage && (
              <div className="mt-2 text-sm text-emerald-300 font-mono">
                ✓ {actionMessage}
              </div>
            )}
            <div className="mt-3 flex flex-wrap gap-2">
              {recoveries.map((s) => (
                <div
                  key={s.session_id}
                  className="flex items-center gap-3 rounded-lg border border-amber-600/30 bg-black/40 px-3 py-1.5 text-xs text-slate-200"
                >
                  <span className="font-mono font-bold text-amber-400">{s.package_id}</span>
                  <span className="text-slate-400">({s.session_id})</span>
                  <button
                    disabled={loading}
                    onClick={() => handleResolve(s.session_id, 'rollback')}
                    className="flex items-center gap-1 rounded bg-rose-600/80 hover:bg-rose-600 px-2 py-0.5 text-white transition disabled:opacity-50"
                  >
                    <RotateCcw className="h-3 w-3" />
                    1-Click Rollback
                  </button>
                  <button
                    disabled={loading}
                    onClick={() => handleResolve(s.session_id, 'dismiss')}
                    className="flex items-center gap-1 rounded bg-slate-700/80 hover:bg-slate-700 px-2 py-0.5 text-slate-300 transition disabled:opacity-50"
                  >
                    <XCircle className="h-3 w-3" />
                    Dismiss
                  </button>
                </div>
              ))}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
};
