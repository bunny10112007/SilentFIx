import React, { useState, useEffect } from 'react';
import { motion } from 'framer-motion';
import {
  ShieldCheck,
  Lock,
  CheckCircle2,
  AlertOctagon,
  Key,
  ArrowRight,
  Fingerprint,
  Link2,
  Layers,
} from 'lucide-react';
import { WorkflowStep } from '../workflow/WorkflowFSM';

export interface PreFlightVerdict {
  verified: boolean;
  package_id: string;
  package_name: string;
  source_url: string;
  sha256_hash: string;
  version: string;
  probe_token: string;
  expires_in_seconds: number;
  security_verdict: string;
}

interface Step1TrustGateProps {
  verdict: PreFlightVerdict | null;
  onTokenMinted: (verdict: PreFlightVerdict) => void;
  onComplete: () => void;
  onLog: (step: WorkflowStep, level: 'info' | 'success' | 'warning' | 'error', msg: string, detail?: string) => void;
  onVoiceAlert?: (text: string, type: string) => void;
}

export const Step1TrustGate: React.FC<Step1TrustGateProps> = ({
  verdict,
  onTokenMinted,
  onComplete,
  onLog,
  onVoiceAlert,
}) => {
  const [catalog, setCatalog] = useState<Record<string, any>>({});
  const [selectedPkg, setSelectedPkg] = useState<string>('Git.Git');
  const [sourceUrl, setSourceUrl] = useState<string>('https://github.com/git-for-windows/git/releases');
  const [sha256Hash, setSha256Hash] = useState<string>('4b92cbf54a61b8fbc04de90ef9929845d58f33989c565d7764d36ef9662b249b');
  const [version, setVersion] = useState<string>('2.56.0');
  const [loading, setLoading] = useState<boolean>(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    fetch('/api/install/catalog')
      .then((r) => r.json())
      .then((d) => {
        if (d.catalog) {
          setCatalog(d.catalog);
        }
      })
      .catch((err) => {
        onLog(WorkflowStep.TRUST_GATE, 'warning', 'Could not load package catalog from backend', err.message);
      });
  }, [onLog]);

  const handleSelectPackage = (pkgId: string) => {
    setSelectedPkg(pkgId);
    setError(null);
    if (catalog[pkgId]) {
      const item = catalog[pkgId];
      setSourceUrl(item.source);
      setSha256Hash(item.sha256);
      setVersion(item.version);
      onLog(WorkflowStep.TRUST_GATE, 'info', `Loaded verified manifest for ${item.name}`, `SHA-256: ${item.sha256.substring(0, 16)}...`);
    }
  };

  const handleRunPreFlight = async () => {
    setLoading(true);
    setError(null);

    try {
      const res = await fetch('/api/install/probe', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          package_id: selectedPkg,
          source_url: sourceUrl,
          sha256_hash: sha256Hash,
          version: version,
        }),
      });

      if (!res.ok) {
        const errJson = await res.json();
        throw new Error(errJson.detail || 'Pre-flight probe validation failed');
      }

      const data: PreFlightVerdict = await res.json();
      onTokenMinted(data);
      onLog(
        WorkflowStep.TRUST_GATE,
        'success',
        `Pre-flight token minted for ${data.package_name}`,
        `Token: ${data.probe_token.substring(0, 16)}... | TTL: ${data.expires_in_seconds}s`
      );

      if (onVoiceAlert) {
        onVoiceAlert(
          `Pre-flight trust gate passed for ${data.package_name}. HTTPS source confirmed, SHA-256 manifest hash validated. Single-use execution token issued.`,
          'TRUST_GATE_PASSED'
        );
      }
    } catch (err: any) {
      setError(err.message || 'Pre-flight probe failed');
      onLog(WorkflowStep.TRUST_GATE, 'error', 'Pre-flight probe rejected', err.message);
    } finally {
      setLoading(false);
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
            <div className="flex h-11 w-11 items-center justify-center rounded-xl bg-emerald-500/10 border border-emerald-500/20 text-emerald-400 shrink-0">
              <ShieldCheck className="h-5 w-5" />
            </div>
            <div>
              <div className="flex items-center gap-2">
                <span className="text-[11px] font-mono uppercase tracking-wider text-emerald-400 font-semibold">
                  Step 2 of 6
                </span>
                <span className="rounded bg-emerald-500/10 border border-emerald-500/20 px-1.5 py-0.2 text-[10px] font-mono text-emerald-300">
                  Cryptographic Trust Gate
                </span>
              </div>
              <h2 className="text-lg font-bold text-slate-100 mt-1">
                Deterministic Pre-Flight Verification &amp; Token Minting
              </h2>
              <p className="text-xs text-slate-400 mt-1 max-w-2xl leading-relaxed">
                SilentFix enforces strict boundary conditions: all packages must originate from HTTPS sources, match exactly 64-character SHA-256 cryptographic manifests, and obtain a short-lived (<code className="text-emerald-400 font-mono">300s</code>) single-use execution token before system modification is permitted.
              </p>
            </div>
          </div>

          <span className="rounded-full border border-emerald-500/30 bg-emerald-500/10 px-3 py-1 text-xs font-mono font-semibold text-emerald-400 shrink-0">
            ENFORCED BOUNDARY
          </span>
        </div>
      </div>

      {/* Package Form Card */}
      <div className="glass-card p-6 space-y-5">
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          {/* Package Selector */}
          <div>
            <label className="block text-xs font-medium text-slate-300 mb-1.5 flex items-center gap-1.5">
              <Layers className="h-3.5 w-3.5 text-indigo-400" />
              <span>Verified Catalog Package</span>
            </label>
            <select
              value={selectedPkg}
              onChange={(e) => handleSelectPackage(e.target.value)}
              className="glass-input cursor-pointer"
            >
              {Object.keys(catalog).length > 0 ? (
                Object.keys(catalog).map((id) => (
                  <option key={id} value={id} className="bg-slate-950 text-slate-200">
                    {catalog[id].name} ({id})
                  </option>
                ))
              ) : (
                <>
                  <option value="Git.Git" className="bg-slate-950 text-slate-200">Git for Windows (Git.Git)</option>
                  <option value="GitHub.cli" className="bg-slate-950 text-slate-200">GitHub CLI (GitHub.cli)</option>
                  <option value="Microsoft.VisualStudioCode" className="bg-slate-950 text-slate-200">Visual Studio Code</option>
                </>
              )}
            </select>
          </div>

          {/* Source URL */}
          <div>
            <label className="block text-xs font-medium text-slate-300 mb-1.5 flex items-center justify-between">
              <span className="flex items-center gap-1.5">
                <Link2 className="h-3.5 w-3.5 text-indigo-400" />
                <span>Package Source URL</span>
              </span>
              <span className="text-[10px] text-emerald-400 font-mono">HTTPS Required</span>
            </label>
            <input
              type="text"
              value={sourceUrl}
              onChange={(e) => setSourceUrl(e.target.value)}
              placeholder="https://..."
              className="glass-input"
            />
          </div>

          {/* SHA-256 Hash */}
          <div className="md:col-span-2">
            <label className="block text-xs font-medium text-slate-300 mb-1.5 flex items-center justify-between">
              <span className="flex items-center gap-1.5">
                <Fingerprint className="h-3.5 w-3.5 text-indigo-400" />
                <span>Manifest SHA-256 Hash (64 Hex Characters)</span>
              </span>
              <span className="text-[10px] text-slate-500 font-mono">
                {sha256Hash.length}/64 characters
              </span>
            </label>
            <input
              type="text"
              value={sha256Hash}
              onChange={(e) => setSha256Hash(e.target.value)}
              placeholder="64-character hexadecimal hash"
              className="glass-input text-xs"
            />
          </div>
        </div>

        {error && (
          <div className="flex items-center gap-2 rounded-lg border border-rose-500/30 bg-rose-950/20 p-3 text-xs text-rose-300">
            <AlertOctagon className="h-4 w-4 shrink-0 text-rose-400" />
            <span>{error}</span>
          </div>
        )}

        <div className="flex justify-end pt-2">
          <button
            onClick={handleRunPreFlight}
            disabled={loading || !selectedPkg || sha256Hash.length !== 64}
            className="btn-primary"
          >
            <Lock className="h-4 w-4" />
            <span>{loading ? 'Validating Manifest...' : 'Verify Pre-Flight Gate & Mint Token'}</span>
          </button>
        </div>
      </div>

      {/* Minted Verdict Card */}
      {verdict && (
        <motion.div
          initial={{ opacity: 0, scale: 0.98 }}
          animate={{ opacity: 1, scale: 1 }}
          className="glass-card border-emerald-500/30 bg-emerald-950/15 p-6 space-y-4"
        >
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2 text-emerald-400 font-semibold text-sm">
              <CheckCircle2 className="h-4 w-4" />
              <span>Pre-Flight Verification Succeeded</span>
            </div>
            <span className="text-xs font-mono text-slate-400">
              TTL: {verdict.expires_in_seconds}s
            </span>
          </div>

          <p className="text-xs text-slate-300 leading-relaxed">
            {verdict.security_verdict}
          </p>

          <div className="flex flex-wrap items-center justify-between gap-3 rounded-lg bg-black/50 border border-slate-800 p-3">
            <div className="flex items-center gap-2">
              <Key className="h-4 w-4 text-amber-400 shrink-0" />
              <span className="text-xs text-slate-400">Single-Use Execution Token:</span>
              <code className="text-xs font-mono font-bold text-amber-300 bg-amber-950/40 px-2 py-0.5 rounded border border-amber-500/20">
                {verdict.probe_token}
              </code>
            </div>
            <span className="text-[10px] font-mono text-slate-500">
              Bound to {verdict.package_id} ({verdict.version})
            </span>
          </div>
        </motion.div>
      )}

      {/* Navigation Controls */}
      <div className="flex items-center justify-between pt-2">
        <div className="text-xs text-slate-500">
          Gate Status: {verdict ? 'Token minted. Step 3 unlocked.' : 'Mint execution token to unlock installation step.'}
        </div>
        <button
          onClick={onComplete}
          disabled={!verdict}
          className="btn-primary"
        >
          <span>Proceed to Non-Shell Install</span>
          <ArrowRight className="h-4 w-4" />
        </button>
      </div>
    </motion.div>
  );
};
