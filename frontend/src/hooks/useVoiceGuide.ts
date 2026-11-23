/**
 * Module 8: ElevenLabs Voice Accessibility Proxy & Hook
 * 
 * Streams low-latency MP3 audio from ElevenLabs to read aloud pre-flight
 * Trust Gate verdicts, UAC prompts, and scam-popup warnings for vision-impaired
 * or non-technical users.
 * 
 * Chunk 2 (Client Audio Queue): Manages HTML5 audio element lifecycles cleanly
 * to play voice alerts without blocking user interactions.
 */

import { useState, useRef, useCallback, useEffect } from 'react';

export interface VoiceQueueItem {
  id: string;
  text: string;
  alertType?: string;
}

export interface UseVoiceGuideReturn {
  isPlaying: boolean;
  queueSize: number;
  currentAlert: string | null;
  volume: number;
  isMuted: boolean;
  speak: (text: string, alertType?: string) => Promise<void>;
  stopAudio: () => void;
  setVolume: (val: number) => void;
  toggleMute: () => void;
}

export function useVoiceGuide(): UseVoiceGuideReturn {
  const [isPlaying, setIsPlaying] = useState<boolean>(false);
  const [queueSize, setQueueSize] = useState<number>(0);
  const [currentAlert, setCurrentAlert] = useState<string | null>(null);
  const [volume, setVolumeState] = useState<number>(0.9);
  const [isMuted, setIsMuted] = useState<boolean>(false);

  const audioQueueRef = useRef<VoiceQueueItem[]>([]);
  const currentAudioRef = useRef<HTMLAudioElement | null>(null);
  const isProcessingRef = useRef<boolean>(false);

  // Chunk 2 (Client Audio Queue): Process pending audio alerts sequentially
  const processNextInQueue = useCallback(async () => {
    if (isProcessingRef.current || audioQueueRef.current.length === 0) {
      if (audioQueueRef.current.length === 0) {
        setIsPlaying(false);
        setCurrentAlert(null);
      }
      return;
    }

    isProcessingRef.current = true;
    const item = audioQueueRef.current.shift()!;
    setQueueSize(audioQueueRef.current.length);
    setCurrentAlert(item.alertType || item.text.slice(0, 30));

    try {
      // Chunk 1: Calls ElevenLabs Audio Proxy. Returns HTTP 204 if no key is configured
      const response = await fetch('/api/voice/speak', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          text: item.text,
          alert_type: item.alertType,
        }),
      });

      // If backend returned HTTP 204 No Content, maintain silent UI execution
      if (response.status === 204) {
        console.log('[VoiceGuide] Silent UI execution (No ElevenLabs key configured).');
        isProcessingRef.current = false;
        processNextInQueue();
        return;
      }

      if (!response.ok) {
        console.warn(`[VoiceGuide] Backend returned ${response.status}`);
        isProcessingRef.current = false;
        processNextInQueue();
        return;
      }

      const audioBlob = await response.blob();
      if (audioBlob.size === 0) {
        isProcessingRef.current = false;
        processNextInQueue();
        return;
      }

      const blobUrl = URL.createObjectURL(audioBlob);
      const audio = new Audio(blobUrl);
      currentAudioRef.current = audio;
      audio.volume = isMuted ? 0 : volume;

      audio.onplay = () => {
        setIsPlaying(true);
      };

      const cleanupAndContinue = () => {
        URL.revokeObjectURL(blobUrl);
        currentAudioRef.current = null;
        isProcessingRef.current = false;
        processNextInQueue();
      };

      audio.onended = cleanupAndContinue;
      audio.onerror = (e) => {
        console.warn('[VoiceGuide] Audio playback error:', e);
        cleanupAndContinue();
      };

      await audio.play().catch((playErr) => {
        console.log('[VoiceGuide] Autoplay blocked or interrupted:', playErr);
        cleanupAndContinue();
      });
    } catch (err) {
      console.warn('[VoiceGuide] Failed to fetch or play speech:', err);
      isProcessingRef.current = false;
      processNextInQueue();
    }
  }, [isMuted, volume]);

  const speak = useCallback(
    async (text: string, alertType?: string) => {
      const id = Math.random().toString(36).substring(2, 9);
      audioQueueRef.current.push({ id, text, alertType });
      setQueueSize(audioQueueRef.current.length);

      if (!isProcessingRef.current) {
        processNextInQueue();
      }
    },
    [processNextInQueue]
  );

  const stopAudio = useCallback(() => {
    if (currentAudioRef.current) {
      currentAudioRef.current.pause();
      currentAudioRef.current = null;
    }
    audioQueueRef.current = [];
    setQueueSize(0);
    setIsPlaying(false);
    setCurrentAlert(null);
    isProcessingRef.current = false;
  }, []);

  const setVolume = useCallback((val: number) => {
    const clamped = Math.max(0, Math.min(1, val));
    setVolumeState(clamped);
    if (currentAudioRef.current) {
      currentAudioRef.current.volume = isMuted ? 0 : clamped;
    }
  }, [isMuted]);

  const toggleMute = useCallback(() => {
    setIsMuted((prev) => {
      const next = !prev;
      if (currentAudioRef.current) {
        currentAudioRef.current.volume = next ? 0 : volume;
      }
      return next;
    });
  }, [volume]);

  useEffect(() => {
    return () => {
      if (currentAudioRef.current) {
        currentAudioRef.current.pause();
      }
    };
  }, []);

  return {
    isPlaying,
    queueSize,
    currentAlert,
    volume,
    isMuted,
    speak,
    stopAudio,
    setVolume,
    toggleMute,
  };
}
