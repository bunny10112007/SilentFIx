/**
 * WorkflowFSM — Strict deterministic finite state machine for the SilentFix multi-step workflow.
 *
 * Steps are sequential. A step is "unlocked" only when the previous step is "completed".
 * No URL/state jumping is allowed.
 */

export enum WorkflowStep {
  RECOVERY   = 0,
  TRUST_GATE = 1,
  INSTALL    = 2,
  RESILIENCE = 3,
  INSPECT    = 4,
  LEDGER     = 5,
}

export const WORKFLOW_STEPS: {
  id: WorkflowStep;
  label: string;
  shortLabel: string;
  description: string;
}[] = [
  {
    id: WorkflowStep.RECOVERY,
    label: 'Crash Recovery',
    shortLabel: 'Recovery',
    description: 'Scan for interrupted installations and resolve pending sessions',
  },
  {
    id: WorkflowStep.TRUST_GATE,
    label: 'Pre-Flight Trust Gate',
    shortLabel: 'Trust Gate',
    description: 'Verify HTTPS source, validate SHA-256 hash, mint execution token',
  },
  {
    id: WorkflowStep.INSTALL,
    label: 'Deterministic Install',
    shortLabel: 'Install',
    description: 'Non-shell winget execution with live SSE streaming and UAC watchdog',
  },
  {
    id: WorkflowStep.RESILIENCE,
    label: 'Resilience Pillars',
    shortLabel: 'Resilience',
    description: 'CLI Healer, Win11 Compatibility Engine, and AWS Sandbox pre-test',
  },
  {
    id: WorkflowStep.INSPECT,
    label: 'Screen Guard & AI Brain',
    shortLabel: 'Inspect',
    description: 'PII blurring, injection guard, and Gemini AI-powered Git executor',
  },
  {
    id: WorkflowStep.LEDGER,
    label: 'State Ledger & Cloud Sync',
    shortLabel: 'Ledger',
    description: 'SQLite WAL session ledger with AWS DynamoDB/S3 audit replication',
  },
];

export type StepStatus = 'locked' | 'active' | 'completed';

export interface WorkflowState {
  currentStep: WorkflowStep;
  completedSteps: Set<WorkflowStep>;
}

export function getStepStatus(
  step: WorkflowStep,
  state: WorkflowState
): StepStatus {
  if (state.completedSteps.has(step)) return 'completed';
  if (step === state.currentStep) return 'active';
  return 'locked';
}

export function canAdvanceTo(
  target: WorkflowStep,
  state: WorkflowState
): boolean {
  if (target === 0) return true;
  // All steps before target must be completed
  for (let i = 0; i < target; i++) {
    if (!state.completedSteps.has(i)) return false;
  }
  return true;
}

export function canNavigateTo(
  target: WorkflowStep,
  state: WorkflowState
): boolean {
  // Can navigate to completed steps or the current active step
  if (state.completedSteps.has(target)) return true;
  if (target === state.currentStep) return true;
  return canAdvanceTo(target, state);
}
