import { useState, useCallback, useRef } from 'react';
import { WorkflowStep, WorkflowState, canNavigateTo } from './WorkflowFSM';

export interface TelemetryEntry {
  id: string;
  timestamp: number;
  step: WorkflowStep;
  level: 'info' | 'success' | 'warning' | 'error';
  message: string;
  detail?: string;
}

export function useWorkflow() {
  const [state, setState] = useState<WorkflowState>({
    currentStep: WorkflowStep.RECOVERY,
    completedSteps: new Set<WorkflowStep>(),
  });

  const [telemetry, setTelemetry] = useState<TelemetryEntry[]>([]);
  const idCounter = useRef(0);

  const log = useCallback((
    step: WorkflowStep,
    level: TelemetryEntry['level'],
    message: string,
    detail?: string,
  ) => {
    const entry: TelemetryEntry = {
      id: `tel-${++idCounter.current}`,
      timestamp: Date.now(),
      step,
      level,
      message,
      detail,
    };
    setTelemetry(prev => [...prev.slice(-199), entry]);
  }, []);

  const completeStep = useCallback((step: WorkflowStep) => {
    setState(prev => {
      const next = new Set(prev.completedSteps);
      next.add(step);
      const nextStep = Math.min(step + 1, WorkflowStep.LEDGER) as WorkflowStep;
      return {
        completedSteps: next,
        currentStep: next.has(nextStep) ? prev.currentStep : nextStep,
      };
    });
    log(step, 'success', `Step completed`);
  }, [log]);

  const navigateTo = useCallback((target: WorkflowStep) => {
    setState(prev => {
      if (!canNavigateTo(target, prev)) return prev;
      return { ...prev, currentStep: target };
    });
  }, []);

  const skipStep = useCallback((step: WorkflowStep) => {
    completeStep(step);
    log(step, 'info', 'Step skipped (no action required)');
  }, [completeStep, log]);

  return {
    state,
    telemetry,
    log,
    completeStep,
    navigateTo,
    skipStep,
  };
}
