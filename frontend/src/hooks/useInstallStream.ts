/**
 * Module 6: Named-Event SSE Hook & Replay Deduplication
 * 
 * Manages real-time status updates via Server-Sent Events (SSE).
 * Binds event listeners to named backend phases and prevents duplicate rendering
 * if connection retries occur.
 */

import { useState, useEffect, useRef, useCallback } from 'react';

export interface InstallEvent {
  event_id: number;
  session_id: string;
  phase: string;
  progress: number;
  message: string;
  raw_output?: string;
  timestamp?: number | string;
}

export interface UseInstallStreamReturn {
  events: InstallEvent[];
  currentPhase: string;
  progress: number;
  isStreaming: boolean;
  isWaitingUac: boolean;
  isCompleted: boolean;
  isFailed: boolean;
  isRolledBack: boolean;
  error: string | null;
  startStream: (sessionId: string) => void;
  stopStream: () => void;
  resetStream: () => void;
}

const TERMINAL_PHASES = ['COMPLETED', 'FAILED', 'UAC_CANCELLED', 'ROLLED_BACK'];

export function useInstallStream(): UseInstallStreamReturn {
  const [events, setEvents] = useState<InstallEvent[]>([]);
  const [currentPhase, setCurrentPhase] = useState<string>('IDLE');
  const [progress, setProgress] = useState<number>(0);
  const [isStreaming, setIsStreaming] = useState<boolean>(false);
  const [error, setError] = useState<string | null>(null);

  const eventSourceRef = useRef<EventSource | null>(null);
  // Chunk 1: Tracks lastEventId to ignore duplicate progress messages when connection reconnects re-read SQLite event history
  const lastEventIdRef = useRef<number>(0);
  const seenEventIdsRef = useRef<Set<number>>(new Set());

  const stopStream = useCallback(() => {
    if (eventSourceRef.current) {
      eventSourceRef.current.close();
      eventSourceRef.current = null;
    }
    setIsStreaming(false);
  }, []);

  const resetStream = useCallback(() => {
    stopStream();
    setEvents([]);
    setCurrentPhase('IDLE');
    setProgress(0);
    setError(null);
    lastEventIdRef.current = 0;
    seenEventIdsRef.current.clear();
  }, [stopStream]);

  const handleNamedEvent = useCallback((event: MessageEvent, phaseName: string) => {
    try {
      const data: InstallEvent = JSON.parse(event.data);
      const evId = parseInt(event.lastEventId || String(data.event_id), 10);

      // Chunk 1 (Event Deduplication): Check if event ID was already processed
      if (evId && seenEventIdsRef.current.has(evId)) {
        return;
      }
      if (evId) {
        seenEventIdsRef.current.add(evId);
        lastEventIdRef.current = Math.max(lastEventIdRef.current, evId);
      }

      const normalizedEvent: InstallEvent = {
        event_id: evId || data.event_id || Date.now(),
        session_id: data.session_id,
        phase: phaseName || data.phase,
        progress: typeof data.progress === 'number' ? data.progress : 0,
        message: data.message,
        raw_output: data.raw_output,
        timestamp: data.timestamp || Date.now(),
      };

      setEvents((prev) => [...prev, normalizedEvent]);
      setCurrentPhase(normalizedEvent.phase);
      if (typeof normalizedEvent.progress === 'number') {
        setProgress(normalizedEvent.progress);
      }

      // Chunk 2 (Automatic Stream Teardown): Monitors incoming phases for terminal indicators
      // (such as COMPLETED, UAC_CANCELLED, or ROLLED_BACK) and closes the EventSource connection automatically.
      if (TERMINAL_PHASES.includes(normalizedEvent.phase)) {
        stopStream();
      }
    } catch (err) {
      console.error('Failed to parse SSE event data:', err);
    }
  }, [stopStream]);

  const startStream = useCallback((sessionId: string) => {
    stopStream();
    setEvents([]);
    setCurrentPhase('CONNECTING');
    setProgress(0);
    setError(null);
    setIsStreaming(true);
    seenEventIdsRef.current.clear();
    lastEventIdRef.current = 0;

    const streamUrl = `/api/install/stream/${sessionId}?lastEventId=${lastEventIdRef.current}`;
    // Chunk 1: Named Event Listener & Deduplication
    const es = new EventSource(streamUrl);
    eventSourceRef.current = es;

    // Standard message handler
    es.onmessage = (event: MessageEvent) => {
      handleNamedEvent(event, 'MESSAGE');
    };

    // Named event phase listeners
    const phases = [
      'STARTING',
      'DOWNLOADING',
      'VERIFYING_HASH',
      'WAITING_UAC',
      'INSTALLING',
      'COMPLETED',
      'FAILED',
      'UAC_CANCELLED',
      'ROLLING_BACK',
      'ROLLED_BACK',
      'RECOVERY_REQUIRED',
    ];

    phases.forEach((p) => {
      es.addEventListener(p, (event: Event) => {
        handleNamedEvent(event as MessageEvent, p);
      });
    });

    es.addEventListener('CLOSE', () => {
      stopStream();
    });

    es.onerror = (err) => {
      console.warn('SSE EventSource error/retry:', err);
      // EventSource automatically attempts reconnection in browser.
      // Reconnection will pass lastEventId to resume from checkpoint cleanly.
      if (es.readyState === EventSource.CLOSED) {
        setIsStreaming(false);
      }
    };
  }, [handleNamedEvent, stopStream]);

  useEffect(() => {
    return () => {
      if (eventSourceRef.current) {
        eventSourceRef.current.close();
      }
    };
  }, []);

  return {
    events,
    currentPhase,
    progress,
    isStreaming,
    isWaitingUac: currentPhase === 'WAITING_UAC',
    isCompleted: currentPhase === 'COMPLETED',
    isFailed: currentPhase === 'FAILED',
    isRolledBack: currentPhase === 'ROLLED_BACK',
    error,
    startStream,
    stopStream,
    resetStream,
  };
}
