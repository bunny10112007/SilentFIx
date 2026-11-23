import React, { useState, useEffect } from 'react';
import { Database, Cloud, RefreshCw, CheckCircle2, Shield, HardDrive, Server } from 'lucide-react';

interface SessionRecord {
  session_id: string;
  package_id: string;
  package_name?: string;
  source: string;
  version?: string;
  status: string;
  created_at: string;
  updated_at: string;
}

interface CloudAuditRecord {
  id: number;
  entity_type: string;
  entity_id: string;
  sync_status: string;
  dynamo_synced_at?: string | null;
  s3_synced_at?: string | null;
  payload: string;
  created_at: string;
}

interface CloudLedgerSectionProps {
  refreshTrigger?: number;
}

export const CloudLedgerSection: React.FC<CloudLedgerSectionProps> = ({ refreshTrigger }) => {
  const [sessions, setSessions] = useState<SessionRecord[]>([]);
  const [auditRecords, setAuditRecords] = useState<CloudAuditRecord[]>([]);
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
    } catch (err) {
      console.warn('Could not load ledger sessions:', err);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchLedger();
  }, [refreshTrigger]);

  return (
    <div className="rounded-2xl border border-slate-800 bg-slate-900/60 p-6 backdrop-blur">
      <div className="flex items-center justify-between pb-4 border-b border-slate-800">
        <div className="flex items-center gap-3">
          <div className="rounded-xl bg-teal-500/10 p-2.5 text-teal-400 border border-teal-500/20">
            <Database className="h-6 w-6" />
          </div>
          <div>
            <h2 className="text-lg font-bold text-slate-100">
              State Ledger & AWS Cloud Audit Architecture
            </h2>
            <p className="text-xs text-slate-400">
              Combines local <code className="text-teal-400 font-mono">WAL SQLite</code> with background off-thread <code className="text-teal-400 font-mono">AWS DynamoDB</code> audit replication and S3 PII-redacted inspection archiving.
            </p>
          </div>
        </div>
        <button
          onClick={fetchLedger}
          disabled={loading}
          className="flex items-center gap-1.5 rounded-lg border border-slate-700 bg-slate-800 hover:bg-slate-700 px-3 py-1.5 text-xs text-slate-300 transition disabled:opacity-50"
        >
          <RefreshCw className={`h-3.5 w-3.5 ${loading ? 'animate-spin' : ''}`} />
          Refresh Ledger
        </button>
      </div>

      {/* Cloud & Local Status Cards */}
      <div className="mt-5 grid grid-cols-1 sm:grid-cols-3 gap-3">
        <div className="rounded-xl border border-slate-800 bg-black/40 p-3.5">
          <div className="flex items-center gap-2 text-teal-400 text-xs font-semibold mb-1">
            <HardDrive className="h-4 w-4" />
            <span>SQLite WAL Mode</span>
          </div>
          <p className="text-xs text-slate-300">
            Write-Ahead Logging enabled. Readers never lock writers during concurrent SSE installs.
          </p>
          <span className="mt-2 inline-block rounded bg-teal-950/60 px-2 py-0.5 text-[10px] font-mono text-teal-300 border border-teal-800/40">
            PRAGMA journal_mode=WAL
          </span>
        </div>

        <div className="rounded-xl border border-slate-800 bg-black/40 p-3.5">
          <div className="flex items-center gap-2 text-sky-400 text-xs font-semibold mb-1">
            <Cloud className="h-4 w-4" />
            <span>Off-Thread DynamoDB</span>
          </div>
          <p className="text-xs text-slate-300">
            Replicated off-thread via <code className="text-[10px]">asyncio.to_thread</code>. Missing credentials degrade gracefully.
          </p>
          <span className="mt-2 inline-block rounded bg-sky-950/60 px-2 py-0.5 text-[10px] font-mono text-sky-300 border border-sky-800/40">
            Audit Ledger Sync
          </span>
        </div>

        <div className="rounded-xl border border-slate-800 bg-black/40 p-3.5">
          <div className="flex items-center gap-2 text-purple-400 text-xs font-semibold mb-1">
            <Shield className="h-4 w-4" />
            <span>S3 PII-Redacted Archive</span>
          </div>
          <p className="text-xs text-slate-300">
            Only 16px Gaussian blurred screen captures are archived. Unredacted data never leaves RAM.
          </p>
          <span className="mt-2 inline-block rounded bg-purple-950/60 px-2 py-0.5 text-[10px] font-mono text-purple-300 border border-purple-800/40">
            Privacy-Preserving S3
          </span>
        </div>
      </div>

      {/* Tabs */}
      <div className="mt-5 flex items-center justify-between border-b border-slate-800 pb-2">
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

      {/* Table Content */}
      <div className="mt-3 overflow-x-auto rounded-xl border border-slate-800 bg-black/40">
        {activeTab === 'sessions' ? (
          <table className="w-full text-left text-xs text-slate-300">
            <thead className="bg-slate-950/80 text-[11px] font-semibold uppercase text-slate-400 border-b border-slate-800">
              <tr>
                <th className="px-4 py-2.5">Session ID</th>
                <th className="px-4 py-2.5">Package</th>
                <th className="px-4 py-2.5">Source</th>
                <th className="px-4 py-2.5">Status</th>
                <th className="px-4 py-2.5">Timestamp</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-800/60 font-mono text-[11px]">
              {sessions.length === 0 ? (
                <tr>
                  <td colSpan={5} className="px-4 py-6 text-center text-slate-600 italic">
                    No installation sessions recorded yet. Mint a token and start an install to populate ledger.
                  </td>
                </tr>
              ) : (
                sessions.map((s) => (
                  <tr key={s.session_id} className="hover:bg-slate-900/40 transition">
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
            <thead className="bg-slate-950/80 text-[11px] font-semibold uppercase text-slate-400 border-b border-slate-800">
              <tr>
                <th className="px-4 py-2.5">Entity Type</th>
                <th className="px-4 py-2.5">Entity ID</th>
                <th className="px-4 py-2.5">Sync Status</th>
                <th className="px-4 py-2.5">DynamoDB Synced</th>
                <th className="px-4 py-2.5">S3 Synced</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-800/60 font-mono text-[11px]">
              {auditRecords.length === 0 ? (
                <tr>
                  <td colSpan={5} className="px-4 py-6 text-center text-slate-600 italic">
                    No cloud audit replication records yet.
                  </td>
                </tr>
              ) : (
                auditRecords.map((r) => (
                  <tr key={r.id} className="hover:bg-slate-900/40 transition">
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
  );
};
