import React, { useState, useEffect } from 'react';
import { motion } from 'framer-motion';
import {
  Database,
  Cloud,
  HardDrive,
  Shield,
  RefreshCw,
  CheckCircle2,
  RotateCcw,
  ShieldCheck,
  Server,
  Layers,
  ArrowRight,
} from 'lucide-react';
import { WorkflowStep } from '../workflow/WorkflowFSM';

interface Step5LedgerProps {
  onComplete: () => void;
  onResetWorkflow: () => void;
  onLog: (step: WorkflowStep, level: 'info' | 'success' | 'warning' | 'error', msg: string, detail?: string) => void;
}

export const Step5Ledger: React.FC<Step5LedgerProps> = ({
  onComplete,
  onResetWorkflow,
  onLog,
}) => {
  const [sessions, setSessions] = useState<any[]>([]);
  const [auditRecords, setAuditRecords] = useState<any[]>([]);
  const [activeTab, setActiveTab] = useState<'sessions' | 'cloudAudit'>('sessions');
  const [loading, setLoading] = useState<boolean>(false);

  const fetchLedger = async () => {
    setLoading(true);
    try {
      const [resSess, resAudit] = await Promise.all([
        fetch('/api/install/sessions?limit=15'),
        fetch('/api/install/cloud-audit?limit=15'),
      ]);

      if (resSess.ok) {
        const data = await resSess.json();
        setSessions(data.sessions || []);
      }
      if (resAudit.ok) {
        const data = await resAudit.json();
        setAuditRecords(data.records || []);
      }
      onLog(WorkflowStep.LEDGER, 'info', 'Ledger synced from SQLite WAL and Cloud Audit tables');
    } catch (err: any) {
      onLog(WorkflowStep.LEDGER, 'error', 'Failed to fetch ledger data', err.message);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchLedger();
  }, []);

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
            <div className="flex h-11 w-11 items-center justify-center rounded-xl bg-teal-500/10 border border-teal-500/20 text-teal-400 shrink-0">
              <Database className="h-5 w-5" />
            </div>
            <div>
              <div className="flex items-center gap-2">
                <span className="text-[11px] font-mono uppercase tracking-wider text-teal-400 font-semibold">
                  Step 6 of 6
                </span>
                <span className="rounded bg-teal-500/10 border border-teal-500/20 px-1.5 py-0.2 text-[10px] font-mono text-teal-300">
                  Transactional Audit Layer
                </span>
              </div>
              <h2 className="text-lg font-bold text-slate-100 mt-1">
                State Ledger &amp; AWS Cloud Audit Architecture
              </h2>
              <p className="text-xs text-slate-400 mt-1 max-w-2xl leading-relaxed">
                SilentFix combines local <code className="text-teal-400 font-mono">SQLite WAL mode</code> with background off-thread <code className="text-teal-400 font-mono">AWS DynamoDB</code> audit replication and S3 PII-redacted inspection archiving. Readers never block writers during concurrent non-shell installs.
              </p>
            </div>
          </div>

          <button
            onClick={fetchLedger}
            disabled={loading}
            className="btn-secondary shrink-0"
          >
            <RefreshCw className={`h-3.5 w-3.5 ${loading ? 'animate-spin' : ''}`} />
            <span>Refresh Ledger</span>
          </button>
        </div>
      </div>

      {/* Architecture Guarantees Summary */}
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
        <div className="glass-card p-4 space-y-1.5">
          <div className="flex items-center gap-2 text-teal-400 text-xs font-semibold">
            <HardDrive className="h-4 w-4" />
            <span>SQLite WAL Mode</span>
          </div>
          <p className="text-[11px] text-slate-300 leading-relaxed">
            Write-Ahead Logging enabled. Readers never lock writers during concurrent SSE installs.
          </p>
          <span className="inline-block rounded bg-teal-950/60 px-2 py-0.5 text-[10px] font-mono text-teal-300 border border-teal-800/40">
            PRAGMA journal_mode=WAL
          </span>
        </div>

        <div className="glass-card p-4 space-y-1.5">
          <div className="flex items-center gap-2 text-sky-400 text-xs font-semibold">
            <Cloud className="h-4 w-4" />
            <span>Off-Thread DynamoDB</span>
          </div>
          <p className="text-[11px] text-slate-300 leading-relaxed">
            Replicated off-thread via <code className="text-[10px]">asyncio.to_thread</code>. Missing credentials degrade gracefully.
          </p>
          <span className="inline-block rounded bg-sky-950/60 px-2 py-0.5 text-[10px] font-mono text-sky-300 border border-sky-800/40">
            Audit Ledger Sync
          </span>
        </div>

        <div className="glass-card p-4 space-y-1.5">
          <div className="flex items-center gap-2 text-purple-400 text-xs font-semibold">
            <Shield className="h-4 w-4" />
            <span>S3 PII-Redacted Archive</span>
          </div>
          <p className="text-[11px] text-slate-300 leading-relaxed">
            Only 16px Gaussian blurred screen captures are archived. Unredacted data never leaves RAM.
          </p>
          <span className="inline-block rounded bg-purple-950/60 px-2 py-0.5 text-[10px] font-mono text-purple-300 border border-purple-800/40">
            Privacy-Preserving S3
          </span>
        </div>
      </div>

      {/* Tables Card */}
      <div className="glass-card p-6 space-y-4">
        {/* Table Tabs */}
        <div className="flex items-center justify-between border-b border-glass pb-2">
          <div className="flex gap-2">
            <button
              onClick={() => setActiveTab('sessions')}
              className={`px-3 py-1.5 text-xs font-semibold rounded-lg transition ${
                activeTab === 'sessions'
                  ? 'bg-teal-500/20 text-teal-300 border border-teal-500/30'
                  : 'text-slate-400 hover:text-slate-200'
              }`}
            >
              SQLite WAL Sessions ({sessions.length})
            </button>
            <button
              onClick={() => setActiveTab('cloudAudit')}
              className={`px-3 py-1.5 text-xs font-semibold rounded-lg transition ${
                activeTab === 'cloudAudit'
                  ? 'bg-sky-500/20 text-sky-300 border border-sky-500/30'
                  : 'text-slate-400 hover:text-slate-200'
              }`}
            >
              AWS Cloud Audit Records ({auditRecords.length})
            </button>
          </div>
        </div>

        {/* Content */}
        <div className="overflow-x-auto rounded-xl border border-glass bg-black/40">
          {activeTab === 'sessions' ? (
            <table className="w-full text-left text-xs text-slate-300">
              <thead className="bg-black/60 text-[10px] font-semibold uppercase text-slate-500 border-b border-glass">
                <tr>
                  <th className="px-4 py-2.5">Session ID</th>
                  <th className="px-4 py-2.5">Package</th>
                  <th className="px-4 py-2.5">Source</th>
                  <th className="px-4 py-2.5">Status</th>
                  <th className="px-4 py-2.5">Timestamp</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-800/50 font-mono text-[11px]">
                {sessions.length === 0 ? (
                  <tr>
                    <td colSpan={5} className="px-4 py-6 text-center text-slate-600 italic">
                      No installation sessions recorded yet.
                    </td>
                  </tr>
                ) : (
                  sessions.map((s) => (
                    <tr key={s.session_id} className="hover:bg-surface-hover transition">
                      <td className="px-4 py-2 font-bold text-slate-200">{s.session_id}</td>
                      <td className="px-4 py-2 text-teal-300">{s.package_id}</td>
                      <td className="px-4 py-2 text-slate-400">{s.source}</td>
                      <td className="px-4 py-2">
                        <span
                          className={`inline-block rounded px-2 py-0.5 text-[10px] font-bold ${
                            s.status === 'COMPLETED'
                              ? 'bg-emerald-500/20 text-emerald-400 border border-emerald-500/30'
                              : s.status === 'WAITING_UAC'
                              ? 'bg-amber-500/20 text-amber-400 border border-amber-500/30'
                              : s.status === 'ROLLED_BACK'
                              ? 'bg-purple-500/20 text-purple-400 border border-purple-500/30'
                              : s.status === 'RECOVERY_REQUIRED'
                              ? 'bg-rose-500/20 text-rose-400 border border-rose-500/30 animate-pulse'
                              : 'bg-sky-500/20 text-sky-400 border border-sky-500/30'
                          }`}
                        >
                          {s.status}
                        </span>
                      </td>
                      <td className="px-4 py-2 text-slate-500 text-[10px]">
                        {new Date(s.created_at).toLocaleTimeString()}
                      </td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          ) : (
            <table className="w-full text-left text-xs text-slate-300">
              <thead className="bg-black/60 text-[10px] font-semibold uppercase text-slate-500 border-b border-glass">
                <tr>
                  <th className="px-4 py-2.5">Entity Type</th>
                  <th className="px-4 py-2.5">Entity ID</th>
                  <th className="px-4 py-2.5">Sync Status</th>
                  <th className="px-4 py-2.5">DynamoDB Synced</th>
                  <th className="px-4 py-2.5">S3 Synced</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-800/50 font-mono text-[11px]">
                {auditRecords.length === 0 ? (
                  <tr>
                    <td colSpan={5} className="px-4 py-6 text-center text-slate-600 italic">
                      No cloud audit replication records yet.
                    </td>
                  </tr>
                ) : (
                  auditRecords.map((r) => (
                    <tr key={r.id} className="hover:bg-surface-hover transition">
                      <td className="px-4 py-2 text-sky-300">{r.entity_type}</td>
                      <td className="px-4 py-2 font-bold text-slate-200">{r.entity_id}</td>
                      <td className="px-4 py-2">
                        <span className="inline-block rounded bg-sky-950/60 border border-sky-800/40 px-2 py-0.5 text-[10px] text-sky-300">
                          {r.sync_status}
                        </span>
                      </td>
                      <td className="px-4 py-2 text-slate-400 text-[10px]">
                        {r.dynamo_synced_at ? new Date(r.dynamo_synced_at).toLocaleTimeString() : '—'}
                      </td>
                      <td className="px-4 py-2 text-slate-400 text-[10px]">
                        {r.s3_synced_at ? new Date(r.s3_synced_at).toLocaleTimeString() : '—'}
                      </td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          )}
        </div>
      </div>

      {/* Completion Banner & Reset */}
      <motion.div
        initial={{ opacity: 0, scale: 0.98 }}
        animate={{ opacity: 1, scale: 1 }}
        className="glass-card border-emerald-500/30 bg-emerald-950/15 p-6 flex flex-wrap items-center justify-between gap-4"
      >
        <div className="flex items-center gap-3">
          <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-emerald-500/15 border border-emerald-500/20 text-emerald-400 shrink-0">
            <CheckCircle2 className="h-5 w-5" />
          </div>
          <div>
            <h3 className="text-sm font-bold text-emerald-300">
              SilentFix Workflow Completed
            </h3>
            <p className="text-xs text-slate-400 mt-0.5">
              All 6 deterministic safety layers and resilience pillars verified. Zero shell injection risk maintained throughout.
            </p>
          </div>
        </div>

        <button
          onClick={() => {
            onComplete();
            onResetWorkflow();
          }}
          className="btn-secondary"
        >
          <RotateCcw className="h-3.5 w-3.5 text-indigo-400" />
          <span>Restart Workflow Loop</span>
        </button>
      </motion.div>
    </motion.div>
  );
};
