import React, { useEffect, useRef } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import {
  Activity,
  CheckCircle2,
  AlertTriangle,
  Info,
  XCircle,
  Terminal,
} from 'lucide-react';
import { TelemetryEntry } from '../workflow/useWorkflow';
import { WORKFLOW_STEPS } from '../workflow/WorkflowFSM';

const LEVEL_CONFIG = {
  info: { icon: Info, color: 'text-slate-400', dot: 'bg-slate-500' },
  success: { icon: CheckCircle2, color: 'text-emerald-400', dot: 'bg-emerald-500' },
  warning: { icon: AlertTriangle, color: 'text-amber-400', dot: 'bg-amber-500' },
  error: { icon: XCircle, color: 'text-rose-400', dot: 'bg-rose-500' },
};

interface TelemetryPanelProps {
  entries: TelemetryEntry[];
}

export const TelemetryPanel: React.FC<TelemetryPanelProps> = ({ entries }) => {
  const scrollRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (scrollRef.current) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
    }
  }, [entries.length]);

  return (
    <div className="flex flex-col h-full">
      {/* Header */}
      <div className="flex items-center justify-between px-4 py-3 border-b border-glass shrink-0">
        <div className="flex items-center gap-2">
          <Terminal className="h-4 w-4 text-indigo-400" />
          <span className="text-xs font-semibold text-slate-300">Live Telemetry</span>
        </div>
        <div className="flex items-center gap-1.5">
          <Activity className="h-3 w-3 text-indigo-400 animate-pulse" />
          <span className="text-[10px] font-mono text-slate-500">
            {entries.length} events
          </span>
        </div>
      </div>

      {/* Entries */}
      <div
        ref={scrollRef}
        className="flex-1 overflow-y-auto telemetry-scroll px-3 py-2 space-y-1"
      >
        {entries.length === 0 ? (
          <div className="flex flex-col items-center justify-center h-full text-center py-12">
            <Terminal className="h-8 w-8 text-slate-700 mb-3" />
            <p className="text-xs text-slate-600">
              Telemetry events will appear here as you progress through the workflow.
            </p>
          </div>
        ) : (
          <AnimatePresence initial={false}>
            {entries.map((entry) => {
              const cfg = LEVEL_CONFIG[entry.level];
              const Icon = cfg.icon;
              const stepLabel = WORKFLOW_STEPS[entry.step]?.shortLabel || '?';
              const time = new Date(entry.timestamp).toLocaleTimeString('en-US', {
                hour12: false,
                hour: '2-digit',
                minute: '2-digit',
                second: '2-digit',
              });

              return (
                <motion.div
                  key={entry.id}
                  initial={{ opacity: 0, y: 8 }}
                  animate={{ opacity: 1, y: 0 }}
                  exit={{ opacity: 0 }}
                  transition={{ duration: 0.15 }}
                  className="flex items-start gap-2 rounded-md px-2 py-1.5 hover:bg-surface-hover transition-colors group"
                >
                  <div className={`mt-0.5 shrink-0 ${cfg.color}`}>
                    <Icon className="h-3 w-3" />
                  </div>
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2 mb-0.5">
                      <span className="text-[9px] font-mono text-slate-600">{time}</span>
                      <span className="text-[9px] font-mono text-indigo-500/70 bg-indigo-500/10 px-1 rounded">
                        {stepLabel}
                      </span>
                    </div>
                    <p className="text-[11px] text-slate-400 leading-relaxed break-words">
                      {entry.message}
                    </p>
                    {entry.detail && (
                      <p className="text-[10px] text-slate-600 font-mono mt-0.5 break-all">
                        {entry.detail}
                      </p>
                    )}
                  </div>
                </motion.div>
              );
            })}
          </AnimatePresence>
        )}
      </div>
    </div>
  );
};
