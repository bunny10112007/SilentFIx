import React, { useState } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import {
  Shield,
  Terminal,
  Activity,
  Layers,
  Sparkles,
  ChevronRight,
  Sidebar,
  Volume2,
  Lock,
} from 'lucide-react';

import { WorkflowStep, WORKFLOW_STEPS } from './workflow/WorkflowFSM';
import { useWorkflow } from './workflow/useWorkflow';
import { StepperNav } from './components/StepperNav';
import { TelemetryPanel } from './components/TelemetryPanel';
import { VoiceGuidePlayer } from './components/VoiceGuidePlayer';
import { useVoiceGuide } from './hooks/useVoiceGuide';

// Steps
import { Step0Recovery } from './steps/Step0Recovery';
import { Step1TrustGate, PreFlightVerdict } from './steps/Step1TrustGate';
import { Step2Install } from './steps/Step2Install';
import { Step3Resilience } from './steps/Step3Resilience';
import { Step4Inspect } from './steps/Step4Inspect';
import { Step5Ledger } from './steps/Step5Ledger';

export function App() {
  const { state, telemetry, log, completeStep, navigateTo } = useWorkflow();
  const voiceGuide = useVoiceGuide();
  const [currentVerdict, setCurrentVerdict] = useState<PreFlightVerdict | null>(null);
  const [showTelemetry, setShowTelemetry] = useState<boolean>(true);

  const handleVoiceAlert = (text: string, type: string) => {
    voiceGuide.speak(text, type);
  };

  const handleResetWorkflow = () => {
    navigateTo(WorkflowStep.RECOVERY);
  };

  return (
    <div className="h-screen w-screen bg-obsidian text-slate-100 flex flex-col overflow-hidden select-none">
      {/* Top Application Bar */}
      <header className="h-14 shrink-0 border-b border-glass bg-obsidian/90 backdrop-blur-md px-4 flex items-center justify-between gap-4 z-40">
        <div className="flex items-center gap-3">
          <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-gradient-to-tr from-indigo-500 to-violet-600 text-white font-bold shadow-glow-indigo">
            <Shield className="h-4 w-4" />
          </div>
          <div>
            <div className="flex items-center gap-2">
              <span className="font-bold text-sm tracking-tight text-white">SilentFix</span>
              <span className="rounded bg-indigo-500/10 border border-indigo-500/20 px-1.5 py-0.2 text-[9px] font-mono text-indigo-300">
                v2.0 Resilience Blueprint
              </span>
            </div>
            <p className="text-[10px] text-slate-500 font-mono">
              Deterministic Privilege Boundary &bull; shell=False
            </p>
          </div>
        </div>

        {/* Center Active Step Breadcrumb */}
        <div className="hidden md:flex items-center gap-2 text-xs font-mono">
          <span className="text-slate-500">Step {state.currentStep + 1} of {WORKFLOW_STEPS.length}:</span>
          <span className="font-bold text-indigo-300">
            {WORKFLOW_STEPS[state.currentStep].label}
          </span>
        </div>

        {/* Right Badges & Controls */}
        <div className="flex items-center gap-2">
          <div className="hidden lg:flex items-center gap-1.5 text-[10px] font-mono font-semibold">
            <span className="rounded-md border border-indigo-500/30 bg-indigo-500/10 px-2 py-0.5 text-indigo-300">
              ZERO SHELL INJECTION
            </span>
            <span className="rounded-md border border-emerald-500/30 bg-emerald-500/10 px-2 py-0.5 text-emerald-300">
              WAL RECOVERY READY
            </span>
          </div>

          <button
            onClick={() => setShowTelemetry(!showTelemetry)}
            className={`flex items-center gap-1.5 rounded-lg border px-2.5 py-1 text-xs font-mono transition ${
              showTelemetry
                ? 'border-indigo-500/40 bg-indigo-950/40 text-indigo-300'
                : 'border-glass bg-black/40 text-slate-400 hover:text-slate-200'
            }`}
            title="Toggle Live Telemetry Inspector"
          >
            <Activity className="h-3.5 w-3.5 text-indigo-400" />
            <span className="hidden sm:inline">Telemetry</span>
            <span className="text-[10px] text-indigo-400 font-bold">({telemetry.length})</span>
          </button>
        </div>
      </header>

      {/* Main IDE-style Workspace Layout */}
      <div className="flex-1 flex overflow-hidden">
        {/* Left Sidebar: Workflow Stepper FSM Navigation */}
        <aside className="w-56 shrink-0 border-r border-glass bg-black/30 flex flex-col justify-between overflow-y-auto">
          <StepperNav state={state} onNavigate={navigateTo} />

          {/* Sidebar Footer Safety Summary */}
          <div className="p-3 border-t border-glass text-[10px] text-slate-500 font-mono space-y-1">
            <div className="flex items-center gap-1 text-indigo-400 font-semibold">
              <Lock className="h-3 w-3" />
              <span>Privilege Boundary</span>
            </div>
            <p className="leading-tight">
              Steps unlock sequentially. Future actions cannot be called out of order.
            </p>
          </div>
        </aside>

        {/* Center Panel: Active Step Content Area */}
        <main className="flex-1 overflow-y-auto p-6 space-y-6">
          {/* Voice Accessibility Bar */}
          <VoiceGuidePlayer voiceGuide={voiceGuide} />

          {/* Step Execution Area with AnimatePresence */}
          <AnimatePresence mode="wait">
            {state.currentStep === WorkflowStep.RECOVERY && (
              <Step0Recovery
                key="step-recovery"
                onComplete={() => completeStep(WorkflowStep.RECOVERY)}
                onLog={log}
                onVoiceAlert={handleVoiceAlert}
              />
            )}

            {state.currentStep === WorkflowStep.TRUST_GATE && (
              <Step1TrustGate
                key="step-trust-gate"
                verdict={currentVerdict}
                onTokenMinted={(v) => setCurrentVerdict(v)}
                onComplete={() => completeStep(WorkflowStep.TRUST_GATE)}
                onLog={log}
                onVoiceAlert={handleVoiceAlert}
              />
            )}

            {state.currentStep === WorkflowStep.INSTALL && (
              <Step2Install
                key="step-install"
                currentVerdict={currentVerdict}
                onComplete={() => completeStep(WorkflowStep.INSTALL)}
                onLog={log}
                onVoiceAlert={handleVoiceAlert}
              />
            )}

            {state.currentStep === WorkflowStep.RESILIENCE && (
              <Step3Resilience
                key="step-resilience"
                onComplete={() => completeStep(WorkflowStep.RESILIENCE)}
                onLog={log}
                onVoiceAlert={handleVoiceAlert}
              />
            )}

            {state.currentStep === WorkflowStep.INSPECT && (
              <Step4Inspect
                key="step-inspect"
                onComplete={() => completeStep(WorkflowStep.INSPECT)}
                onLog={log}
                onVoiceAlert={handleVoiceAlert}
              />
            )}

            {state.currentStep === WorkflowStep.LEDGER && (
              <Step5Ledger
                key="step-ledger"
                onComplete={() => completeStep(WorkflowStep.LEDGER)}
                onResetWorkflow={handleResetWorkflow}
                onLog={log}
              />
            )}
          </AnimatePresence>
        </main>

        {/* Right Sidebar: Live Telemetry & Inspector Panel */}
        {showTelemetry && (
          <aside className="w-80 shrink-0 border-l border-glass bg-black/40 flex flex-col overflow-hidden">
            <TelemetryPanel entries={telemetry} />
          </aside>
        )}
      </div>

      {/* Footer System Status Bar */}
      <footer className="h-7 shrink-0 border-t border-glass bg-obsidian px-4 flex items-center justify-between text-[10px] font-mono text-slate-500 z-40">
        <div className="flex items-center gap-3">
          <span className="flex items-center gap-1.5">
            <span className="h-1.5 w-1.5 rounded-full bg-emerald-400" />
            <span>FastAPI Backend: Online</span>
          </span>
          <span className="text-slate-700">&bull;</span>
          <span>SQLite WAL: Ready</span>
          <span className="text-slate-700">&bull;</span>
          <span>ElevenLabs: Connected</span>
        </div>

        <div className="flex items-center gap-3">
          <span>Non-Shell Subprocess Executor Active</span>
          <span className="text-slate-700">&bull;</span>
          <span className="text-indigo-400">SilentFix Architecture v2.0</span>
        </div>
      </footer>
    </div>
  );
}

export default App;
