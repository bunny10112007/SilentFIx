import React from 'react';
import { Volume2, VolumeX, Mic, Activity, Disc } from 'lucide-react';
import { UseVoiceGuideReturn } from '../hooks/useVoiceGuide';

interface VoiceGuidePlayerProps {
  voiceGuide: UseVoiceGuideReturn;
}

export const VoiceGuidePlayer: React.FC<VoiceGuidePlayerProps> = ({ voiceGuide }) => {
  const {
    isPlaying,
    currentAlert,
    volume,
    isMuted,
    speak,
    setVolume,
    toggleMute,
  } = voiceGuide;

  const presets = [
    {
      label: 'Spoken Trust Gate Verdict',
      text: 'SilentFix pre-flight trust gate verified. HTTPS package source confirmed and SHA-256 manifest hash validated. Installation is authorized to proceed.',
      type: 'TRUST_GATE_PASSED',
    },
    {
      label: 'Spoken UAC Elevation Alert',
      text: 'Attention: Windows User Account Control requires your approval. Please look at your screen and click Yes on the elevation prompt to proceed.',
      type: 'WAITING_UAC',
    },
    {
      label: 'Spoken Scam Popup Warning',
      text: 'Warning: Potential scam popup detected on screen. Prompt injection commands have been blocked and sensitive payment details have been blurred.',
      type: 'SCAM_POPUP_ALERT',
    },
  ];

  return (
    <div className="glass-card p-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-3">
          <div className="relative flex h-9 w-9 items-center justify-center rounded-lg bg-pink-500/10 border border-pink-500/20 text-pink-400 shrink-0">
            <Mic className="h-4 w-4" />
            {isPlaying && (
              <span className="absolute -top-0.5 -right-0.5 flex h-2.5 w-2.5">
                <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-pink-400 opacity-75"></span>
                <span className="relative inline-flex rounded-full h-2.5 w-2.5 bg-pink-500"></span>
              </span>
            )}
          </div>
          <div>
            <div className="flex items-center gap-2">
              <span className="text-xs font-bold text-slate-200">
                ElevenLabs Voice Accessibility Proxy
              </span>
              <span className="text-[9px] font-mono text-pink-300 bg-pink-950/40 border border-pink-500/30 px-1.5 py-0.2 rounded">
                eleven_flash_v2_5
              </span>
            </div>
            <p className="text-[11px] text-slate-400">
              Low-latency narration for vision-impaired users. Silent HTTP 204 fallback when unconfigured.
            </p>
          </div>
        </div>

        {/* Audio Controls */}
        <div className="flex items-center gap-3">
          {isPlaying && (
            <div className="flex items-center gap-1.5 text-xs text-pink-300 font-medium">
              <Activity className="h-3.5 w-3.5 animate-pulse text-pink-400" />
              <span className="truncate max-w-[140px] text-[11px]">{currentAlert || 'Playing'}</span>
            </div>
          )}

          <div className="flex items-center gap-2">
            <button
              onClick={toggleMute}
              className="rounded-lg border border-glass bg-black/40 p-1.5 text-slate-300 hover:text-white transition"
              title={isMuted ? 'Unmute' : 'Mute'}
            >
              {isMuted ? <VolumeX className="h-4 w-4 text-rose-400" /> : <Volume2 className="h-4 w-4" />}
            </button>
            <input
              type="range"
              min="0"
              max="1"
              step="0.05"
              value={volume}
              onChange={(e) => setVolume(parseFloat(e.target.value))}
              className="h-1.5 w-16 accent-pink-500 bg-slate-800 rounded-lg cursor-pointer"
            />
          </div>
        </div>
      </div>

      {/* Preset Chips */}
      <div className="mt-2.5 pt-2.5 border-t border-glass flex flex-wrap items-center gap-2">
        <span className="text-[10px] text-slate-500 font-mono">Accessibility Presets:</span>
        {presets.map((p, idx) => (
          <button
            key={idx}
            onClick={() => speak(p.text, p.type)}
            className="rounded-md border border-glass bg-black/40 hover:bg-surface-hover px-2 py-0.5 text-[10px] font-mono text-slate-300 hover:text-pink-300 transition flex items-center gap-1.5"
          >
            <Disc className="h-2.5 w-2.5 text-pink-400" />
            {p.label}
          </button>
        ))}
      </div>
    </div>
  );
};
