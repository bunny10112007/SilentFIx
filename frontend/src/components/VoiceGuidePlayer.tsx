import React from 'react';
import { Volume2, VolumeX, Mic, Activity, Disc, Sparkles } from 'lucide-react';
import { UseVoiceGuideReturn } from '../hooks/useVoiceGuide';

interface VoiceGuidePlayerProps {
  voiceGuide: UseVoiceGuideReturn;
}

export const VoiceGuidePlayer: React.FC<VoiceGuidePlayerProps> = ({ voiceGuide }) => {
  const {
    isPlaying,
    queueSize,
    currentAlert,
    volume,
    isMuted,
    speak,
    stopAudio,
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
    <div className="rounded-2xl border border-slate-800 bg-slate-900/60 p-5 backdrop-blur">
      <div className="flex flex-wrap items-center justify-between gap-4">
        <div className="flex items-center gap-3">
          <div className="relative rounded-xl bg-pink-500/10 p-2.5 text-pink-400 border border-pink-500/20">
            <Mic className="h-5 w-5" />
            {isPlaying && (
              <span className="absolute -top-1 -right-1 flex h-3 w-3">
                <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-pink-400 opacity-75"></span>
                <span className="relative inline-flex rounded-full h-3 w-3 bg-pink-500"></span>
              </span>
            )}
          </div>
          <div>
            <div className="flex items-center gap-2">
              <h3 className="text-sm font-bold text-slate-100">
                ElevenLabs Voice Accessibility Engine
              </h3>
              <span className="text-[10px] font-mono text-pink-400 bg-pink-950/50 border border-pink-500/30 px-2 py-0.5 rounded">
                eleven_flash_v2_5 (&lt;300ms)
              </span>
            </div>
            <p className="text-xs text-slate-400">
              Low-latency spoken narration for vision-impaired and non-technical users. Returns silent HTTP 204 if key is empty.
            </p>
          </div>
        </div>

        {/* Audio Player Controls */}
        <div className="flex items-center gap-4">
          {isPlaying && (
            <div className="flex items-center gap-2 text-xs text-pink-300 font-medium">
              <Activity className="h-4 w-4 animate-pulse text-pink-400" />
              <span>Playing: {currentAlert || 'Voice Guide'}</span>
            </div>
          )}

          <div className="flex items-center gap-2">
            <button
              onClick={toggleMute}
              className="rounded-lg border border-slate-700 bg-slate-800 p-2 text-slate-300 hover:text-white transition"
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
              className="h-1.5 w-20 accent-pink-500 bg-slate-800 rounded-lg cursor-pointer"
            />
          </div>
        </div>
      </div>

      {/* Preset Voice Narration Trigger Chips */}
      <div className="mt-3 pt-3 border-t border-slate-800/80 flex flex-wrap items-center gap-2">
        <span className="text-[11px] text-slate-500 mr-1">Accessibility Presets:</span>
        {presets.map((p, idx) => (
          <button
            key={idx}
            onClick={() => speak(p.text, p.type)}
            className="rounded-lg border border-slate-800 bg-black/40 hover:bg-slate-800 px-2.5 py-1 text-[11px] text-slate-300 hover:text-pink-300 transition flex items-center gap-1.5"
          >
            <Disc className="h-3 w-3 text-pink-400" />
            {p.label}
          </button>
        ))}
      </div>
    </div>
  );
};
