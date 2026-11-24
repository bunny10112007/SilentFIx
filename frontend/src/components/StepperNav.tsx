import React from 'react';
import { motion } from 'framer-motion';
import {
  ShieldAlert,
  ShieldCheck,
  Play,
  Wrench,
  EyeOff,
  Database,
  Lock,
  Check,
} from 'lucide-react';
import {
  WorkflowStep,
  WORKFLOW_STEPS,
  WorkflowState,
  getStepStatus,
  canNavigateTo,
} from '../workflow/WorkflowFSM';

const STEP_ICONS: Record<WorkflowStep, React.ElementType> = {
  [WorkflowStep.RECOVERY]: ShieldAlert,
  [WorkflowStep.TRUST_GATE]: ShieldCheck,
  [WorkflowStep.INSTALL]: Play,
  [WorkflowStep.RESILIENCE]: Wrench,
  [WorkflowStep.INSPECT]: EyeOff,
  [WorkflowStep.LEDGER]: Database,
};

interface StepperNavProps {
  state: WorkflowState;
  onNavigate: (step: WorkflowStep) => void;
}

export const StepperNav: React.FC<StepperNavProps> = ({ state, onNavigate }) => {
  const totalSteps = WORKFLOW_STEPS.length;
  const completedCount = state.completedSteps.size;
  const progressPct = Math.round((completedCount / totalSteps) * 100);

  return (
    <nav className="flex flex-col gap-1 py-4 px-3" aria-label="Workflow Steps">
      {/* Progress header */}
      <div className="flex items-center justify-between px-2 mb-3">
        <span className="text-[10px] font-mono font-semibold text-slate-500 uppercase tracking-wider">
          Workflow
        </span>
        <span className="text-[10px] font-mono text-indigo-400">
          {completedCount}/{totalSteps}
        </span>
      </div>

      {/* Progress bar */}
      <div className="mx-2 mb-4 h-1 w-auto rounded-full bg-[rgba(255,255,255,0.06)] overflow-hidden">
        <motion.div
          className="h-full progress-gradient rounded-full"
          initial={{ width: 0 }}
          animate={{ width: `${progressPct}%` }}
          transition={{ duration: 0.5, ease: 'easeOut' }}
        />
      </div>

      {/* Steps */}
      {WORKFLOW_STEPS.map((stepDef) => {
        const status = getStepStatus(stepDef.id, state);
        const isNavigable = canNavigateTo(stepDef.id, state);
        const Icon = STEP_ICONS[stepDef.id];
        const isActive = status === 'active';
        const isCompleted = status === 'completed';
        const isLocked = status === 'locked';

        return (
          <button
            key={stepDef.id}
            onClick={() => isNavigable && onNavigate(stepDef.id)}
            disabled={isLocked}
            aria-disabled={isLocked}
            aria-current={isActive ? 'step' : undefined}
            className={`
              group relative flex items-center gap-3 rounded-lg px-3 py-2.5 text-left transition-all duration-200
              ${isActive
                ? 'bg-indigo-500/10 border border-indigo-500/30'
                : isCompleted
                  ? 'bg-surface hover:bg-surface-hover border border-transparent hover:border-glass-hover cursor-pointer'
                  : 'border border-transparent opacity-40 cursor-not-allowed'
              }
            `}
          >
            {/* Step icon */}
            <div
              className={`
                flex h-8 w-8 items-center justify-center rounded-lg shrink-0 transition-colors
                ${isActive
                  ? 'bg-indigo-500/20 text-indigo-400'
                  : isCompleted
                    ? 'bg-emerald-500/15 text-emerald-400'
                    : 'bg-[rgba(255,255,255,0.04)] text-slate-600'
                }
              `}
            >
              {isCompleted ? (
                <Check className="h-4 w-4" />
              ) : isLocked ? (
                <Lock className="h-3.5 w-3.5" />
              ) : (
                <Icon className="h-4 w-4" />
              )}
            </div>

            {/* Label */}
            <div className="flex-1 min-w-0">
              <div
                className={`text-xs font-semibold truncate ${
                  isActive ? 'text-indigo-300' : isCompleted ? 'text-slate-300' : 'text-slate-600'
                }`}
              >
                {stepDef.shortLabel}
              </div>
            </div>

            {/* Active indicator */}
            {isActive && (
              <motion.div
                layoutId="activeStepIndicator"
                className="absolute left-0 top-1/2 -translate-y-1/2 w-[3px] h-5 rounded-r-full bg-indigo-500"
                transition={{ type: 'spring', stiffness: 500, damping: 30 }}
              />
            )}
          </button>
        );
      })}
    </nav>
  );
};
