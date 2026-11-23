import React, { useState, useEffect } from 'react';
import { ShieldCheck, Lock, CheckCircle2, AlertOctagon, Key, ArrowRight } from 'lucide-react';

interface PreFlightVerdict {
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

interface TrustGateSectionProps {
  onTokenMinted: (verdict: PreFlightVerdict) => void;
  onVoiceAlert?: (text: string, type: string) => void;
}

export const TrustGateSection: React.FC<TrustGateSectionProps> = ({ onTokenMinted, onVoiceAlert }) => {
  const [catalog, setCatalog] = useState<Record<string, any>>({});
  const [selectedPkg, setSelectedPkg] = useState<string>('Git.Git');
  const [sourceUrl, setSourceUrl] = useState<string>('https://github.com/git-for-windows/git/releases');
  const [sha256Hash, setSha256Hash] = useState<string>('4b92cbf54a61b8fbc04de90ef9929845d58f33989c565d7764d36ef9662b249b');
  const [version, setVersion] = useState<string>('2.56.0');
  const [verdict, setVerdict] = useState<PreFlightVerdict | null>(null);
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
      .catch((err) => console.warn('Could not load package catalog:', err));
  }, []);

  const handleSelectPackage = (pkgId: string) => {
    setSelectedPkg(pkgId);
    setError(null);
    if (catalog[pkgId]) {
      const item = catalog[pkgId];
      setSourceUrl(item.source);
      setSha256Hash(item.sha256);
      setVersion(item.version);
    }
  };

  const handleRunPreFlight = async () => {
    setLoading(true);
    setError(null);
    setVerdict(null);

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
        throw new Error(errJson.detail || 'Pre-flight probe failed');
      }

      const data: PreFlightVerdict = await res.json();
      setVerdict(data);
      onTokenMinted(data);

      if (onVoiceAlert) {
        onVoiceAlert(
          `Pre-flight trust gate passed for ${data.package_name}. HTTPS source confirmed, SHA-256 manifest hash validated. Single-use execution token issued.`,
          'TRUST_GATE_PASSED'
        );
      }
    } catch (err: any) {
      setError(err.message || 'Pre-flight probe failed');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="rounded-2xl border border-slate-800 bg-slate-900/60 p-6 backdrop-blur">
      <div className="flex items-center justify-between pb-4 border-b border-slate-800">
        <div className="flex items-center gap-3">
          <div className="rounded-xl bg-emerald-500/10 p-2.5 text-emerald-400 border border-emerald-500/20">
            <ShieldCheck className="h-6 w-6" />
          </div>
          <div>
            <h2 className="text-lg font-bold text-slate-100">Layer 1: Pre-Flight Trust Gate</h2>
            <p className="text-xs text-slate-400">
              Enforces HTTPS sources, validates SHA-256 manifest hashes, issues single-use 5-minute <code className="text-emerald-400 font-mono">probe_tokens</code>. Blocks direct calls with 403 Forbidden.
            </p>
          </div>
        </div>
        <span className="rounded-full border border-emerald-500/30 bg-emerald-500/10 px-3 py-1 text-xs font-semibold text-emerald-400">
          Enforced Boundary
        </span>
      </div>

      <div className="mt-5 grid grid-cols-1 md:grid-cols-2 gap-4">
        {/* Package Selector */}
        <div>
          <label className="block text-xs font-medium text-slate-300 mb-1.5">
            Select Verified Package
          </label>
          <select
            value={selectedPkg}
            onChange={(e) => handleSelectPackage(e.target.value)}
            className="w-full rounded-lg border border-slate-700 bg-slate-950 px-3 py-2 text-sm text-slate-200 focus:border-emerald-500 focus:outline-none"
          >
            {Object.keys(catalog).length > 0 ? (
              Object.keys(catalog).map((id) => (
                <option key={id} value={id}>
                  {catalog[id].name} ({id})
                </option>
              ))
            ) : (
              <>
                <option value="Git.Git">Git for Windows (Git.Git)</option>
                <option value="GitHub.cli">GitHub CLI (GitHub.cli)</option>
                <option value="Microsoft.VisualStudioCode">Visual Studio Code</option>
              </>
            )}
          </select>
        </div>

        {/* Source URL (Enforces HTTPS) */}
        <div>
          <label className="block text-xs font-medium text-slate-300 mb-1.5 flex items-center justify-between">
            <span>Package Source URL</span>
            <span className="text-[10px] text-emerald-400 font-mono">HTTPS Required</span>
          </label>
          <input
            type="text"
            value={sourceUrl}
            onChange={(e) => setSourceUrl(e.target.value)}
            placeholder="https://..."
            className="w-full rounded-lg border border-slate-700 bg-slate-950 px-3 py-2 text-sm text-slate-200 font-mono focus:border-emerald-500 focus:outline-none"
          />
        </div>

        {/* SHA-256 Hash */}
        <div className="md:col-span-2">
          <label className="block text-xs font-medium text-slate-300 mb-1.5 flex items-center justify-between">
            <span>Manifest SHA-256 Hash (64 Hex Characters)</span>
            <span className="text-[10px] text-slate-400">Deterministic integrity check</span>
          </label>
          <input
            type="text"
            value={sha256Hash}
            onChange={(e) => setSha256Hash(e.target.value)}
            placeholder="64-character hex hash"
            className="w-full rounded-lg border border-slate-700 bg-slate-950 px-3 py-2 text-xs font-mono text-slate-300 focus:border-emerald-500 focus:outline-none"
          />
        </div>
      </div>

      {error && (
        <div className="mt-4 flex items-center gap-2 rounded-lg border border-rose-500/30 bg-rose-950/30 p-3 text-xs text-rose-300">
          <AlertOctagon className="h-4 w-4 shrink-0 text-rose-400" />
          <span>{error}</span>
        </div>
      )}

      {verdict && (
        <div className="mt-4 rounded-xl border border-emerald-500/30 bg-emerald-950/20 p-4">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2 text-emerald-400 font-semibold text-sm">
              <CheckCircle2 className="h-4 w-4" />
              <span>Pre-Flight Verification Succeeded</span>
            </div>
            <span className="text-xs text-slate-400">TTL: 300 seconds</span>
          </div>

          <p className="mt-1 text-xs text-slate-300">{verdict.security_verdict}</p>

          <div className="mt-3 flex items-center justify-between rounded-lg bg-black/40 border border-slate-800 p-2.5">
            <div className="flex items-center gap-2">
              <Key className="h-4 w-4 text-amber-400" />
              <span className="text-xs text-slate-400">Single-Use Token:</span>
              <code className="text-xs font-mono font-bold text-amber-300">
                {verdict.probe_token}
              </code>
            </div>
            <span className="text-[10px] text-slate-500">Bound to {verdict.package_id}</span>
          </div>
        </div>
      )}

      <div className="mt-5 flex justify-end">
        <button
          onClick={handleRunPreFlight}
          disabled={loading}
          className="flex items-center gap-2 rounded-xl bg-emerald-600 hover:bg-emerald-500 px-5 py-2.5 text-sm font-semibold text-white shadow-lg shadow-emerald-600/20 transition disabled:opacity-50"
        >
          <Lock className="h-4 w-4" />
          {loading ? 'Validating Manifest...' : 'Verify Pre-Flight Gate & Mint Token'}
          <ArrowRight className="h-4 w-4" />
        </button>
      </div>
    </div>
  );
};
