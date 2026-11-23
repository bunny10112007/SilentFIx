import React, { useState } from 'react';
import {
  Shield,
  Terminal,
  Database,
  EyeOff,
  Sparkles,
  Volume2,
  CheckCircle2,
  Lock,
  Cpu,
  Layers,
  Radio,
  ExternalLink,
  Wrench,
  Monitor,
  Cloud,
} from 'lucide-react';

import { RecoveryBanner } from './components/RecoveryBanner';
import { TrustGateSection } from './components/TrustGateSection';
import { InstallStreamSection } from './components/InstallStreamSection';
import { ScreenGuardSection } from './components/ScreenGuardSection';
import { GeminiBrainSection } from './components/GeminiBrainSection';
import { CloudLedgerSection } from './components/CloudLedgerSection';
import { VoiceGuidePlayer } from './components/VoiceGuidePlayer';
import { CliHealerSection } from './components/CliHealerSection';
import { Win11CompatSection } from './components/Win11CompatSection';
import { AwsSandboxSection } from './components/AwsSandboxSection';
import { useVoiceGuide } from './hooks/useVoiceGuide';

export function App() {
  const [currentVerdict, setCurrentVerdict] = useState<any>(null);
  const [ledgerRefreshCount, setLedgerRefreshCount] = useState<number>(0);
  const voiceGuide = useVoiceGuide();

  const handleVoiceAlert = (text: string, type: string) => {
    voiceGuide.speak(text, type);
  };

  const triggerLedgerRefresh = () => {
    setLedgerRefreshCount((c) => c + 1);
  };

  return (
    <div className="min-h-screen bg-[#020617] text-slate-100 flex flex-col">
      {/* Top Navigation / Header */}
      <header className="sticky top-0 z-50 border-b border-slate-800 bg-slate-950/80 backdrop-blur-md">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-3.5 flex flex-wrap items-center justify-between gap-4">
          <div className="flex items-center gap-3">
            <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-gradient-to-tr from-emerald-500 to-sky-500 text-slate-950 font-black shadow-lg shadow-emerald-500/20">
              SF
            </div>
            <div>
              <div className="flex items-center gap-2">
                <h1 className="text-base font-bold tracking-tight text-white">SilentFix</h1>
                <span className="rounded bg-emerald-500/10 border border-emerald-500/20 px-1.5 py-0.5 text-[10px] font-mono text-emerald-400">
                  v2.0 Resilience Blueprint
                </span>
              </div>
              <p className="text-xs text-slate-400">Deterministic Privilege Boundary, CLI Healer &amp; Win 11 Compat</p>
            </div>
          </div>

          {/* Architecture Badge Tags */}
          <div className="flex flex-wrap items-center gap-2 text-[11px] font-mono font-semibold">
            <span className="rounded-lg border border-sky-500/30 bg-sky-500/10 px-2.5 py-1 text-sky-300">
              AGENTIC AI FOR EVERYONE
            </span>
            <span className="rounded-lg border border-emerald-500/30 bg-emerald-500/10 px-2.5 py-1 text-emerald-300">
              ZERO SHELL INJECTION
            </span>
            <span className="rounded-lg border border-purple-500/30 bg-purple-500/10 px-2.5 py-1 text-purple-300">
              AWS + ELEVENLABS + GEMINI + WINGET
            </span>
          </div>
        </div>
      </header>

      {/* Main Container */}
      <main className="flex-1 max-w-7xl w-full mx-auto px-4 sm:px-6 lg:px-8 py-8 space-y-8">
        {/* Module 1: Crash Recovery Sweep Banner */}
        <RecoveryBanner onRollbackTriggered={triggerLedgerRefresh} />

        {/* Module 8: Voice Accessibility Banner / Audio Controls */}
        <VoiceGuidePlayer voiceGuide={voiceGuide} />

        {/* System Architecture Invariant Hero Callout */}
        <div className="rounded-2xl border border-slate-800 bg-gradient-to-r from-slate-900/90 via-slate-900/60 to-slate-950/90 p-5 backdrop-blur">
          <div className="flex items-start gap-3">
            <div className="rounded-lg bg-sky-500/10 p-2 text-sky-400 border border-sky-500/20 shrink-0">
              <Shield className="h-5 w-5" />
            </div>
            <div>
              <h3 className="text-sm font-bold text-sky-200">
                Core Architectural Safety Invariant &amp; Resilience Guarantees
              </h3>
              <p className="mt-1 text-xs text-slate-300 leading-relaxed">
                SilentFix acts as a deterministic privilege boundary. The AI model handles intent translation and parameter gathering; all system mutations—package querying, SHA-256 verification, DynamoDB sync, ElevenLabs TTS, and Git configuration—are owned entirely by deterministic Python code with non-shell execution (<code className="font-mono text-emerald-400">shell=False</code>). Added resilience pillars provide zero-shell CLI error healing, non-destructive Windows 11 compatibility shims, and isolated AWS CodeBuild pre-test sandboxing.
              </p>
            </div>
          </div>
        </div>

        {/* 2-Column Responsive Layout for Primary Core Layers */}
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-8">
          {/* Module 3: Pre-Flight Trust Gate */}
          <TrustGateSection
            onTokenMinted={(v) => {
              setCurrentVerdict(v);
              triggerLedgerRefresh();
            }}
            onVoiceAlert={handleVoiceAlert}
          />

          {/* Module 4: Non-Shell Winget Subprocess Execution & UAC Watchdog */}
          <InstallStreamSection
            currentVerdict={currentVerdict}
            onVoiceAlert={handleVoiceAlert}
            onRollbackComplete={triggerLedgerRefresh}
          />
        </div>

        {/* Section Divider: Resilience Pillars */}
        <div className="pt-2">
          <div className="flex items-center gap-2 pb-1 text-xs font-mono font-bold text-slate-400 uppercase tracking-wider">
            <span className="h-1.5 w-1.5 rounded-full bg-emerald-400" />
            Resilience Pillars: Terminal CLI Healer &amp; Win 11 Compatibility Engine
          </div>
          <div className="h-px w-full bg-slate-800" />
        </div>

        {/* 2-Column Responsive Layout for Pillar 1 & Pillar 2 */}
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-8">
          {/* Pillar 1: Terminal CLI Error Healer */}
          <CliHealerSection onVoiceAlert={handleVoiceAlert} />

          {/* Pillar 2: Windows 11 Compatibility Shim Engine */}
          <Win11CompatSection onVoiceAlert={handleVoiceAlert} />
        </div>

        {/* Pillar 3: AWS Cloud Pre-Test Sandbox */}
        <AwsSandboxSection onVoiceAlert={handleVoiceAlert} />

        {/* Module 5: Screen Privacy Guard (RapidOCR PII Blurring & Injection Guard) */}
        <ScreenGuardSection onVoiceAlert={handleVoiceAlert} />

        {/* Module 9: Gemini AI Brain & Safe Git Terminal Executor */}
        <GeminiBrainSection onVoiceAlert={handleVoiceAlert} />

        {/* Module 2 & 7: Transactional SQLite WAL Ledger & AWS Cloud Sync */}
        <CloudLedgerSection refreshTrigger={ledgerRefreshCount} />
      </main>

      {/* Footer */}
      <footer className="border-t border-slate-800/80 bg-slate-950 py-6 text-xs text-slate-500 text-center">
        <div className="max-w-7xl mx-auto px-4 flex flex-col sm:flex-row items-center justify-between gap-2">
          <span>
            SilentFix Software Repair Agent &amp; Architecture Blueprint • Zero Shell Injection Privilege Boundary
          </span>
          <span className="font-mono text-[11px] text-slate-400">
            FastAPI • SQLite WAL • RapidOCR • AWS DynamoDB/S3/CodeBuild • ElevenLabs • Gemini 3.5 Flash Lite • AppCompatFlags
          </span>
        </div>
      </footer>
    </div>
  );
}
export default App;
