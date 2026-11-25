import React, { useEffect, useRef, useState } from "react";
import { AnimatePresence } from "framer-motion";
import {
  Folder,
  FolderPlus,
  Loader2,
  Mic,
  MicOff,
  PanelRightClose,
  PanelRightOpen,
  Send,
  ShieldCheck,
  Square,
  X,
} from "lucide-react";
import { ChatMessageBubble } from "./ChatMessageBubble";
import type { BotMessage } from "../types/chatbot";

const STARTER_PROMPTS = [
  {
    title: "Fix 'not recognized' error",
    prompt: "'git' is not recognized as an internal or external command",
  },
  {
    title: "Configure Git on new PC",
    prompt: "Help me configure Git on this new Windows laptop",
  },
  {
    title: "Fix old app on Windows 11",
    prompt: "My old Windows app looks blurry and crashes with VCRUNTIME140.dll missing",
  },
  {
    title: "Repair a broken folder",
    prompt: "My project folder has broken dependencies and won't start",
  },
];

interface AIChatbotProps {
  messages: BotMessage[];
  activeFolder: string | null;
  isThinking: boolean;
  thinkingStage: string;
  terminalOpen: boolean;
  onToggleTerminal: () => void;
  onSendMessage: (text: string) => Promise<void>;
  onCancelRequest: () => void;
  onAttachFolder: (path: string | null) => void;
  onPasteToTerminal: (cmd: string) => void;
  onRunInTerminal: (cmd: string) => void;
  onTriggerSandbox: (packageId: string) => void;
  onTriggerFolderScan: (folderPath: string) => void;
}

export const AIChatbot: React.FC<AIChatbotProps> = ({
  messages,
  activeFolder,
  isThinking,
  thinkingStage,
  terminalOpen,
  onToggleTerminal,
  onSendMessage,
  onCancelRequest,
  onAttachFolder,
  onPasteToTerminal,
  onRunInTerminal,
  onTriggerSandbox,
  onTriggerFolderScan,
}) => {
  const [input, setInput] = useState("");
  const [folderDraft, setFolderDraft] = useState("");
  const [showFolderBar, setShowFolderBar] = useState(false);
  const [recording, setRecording] = useState(false);
  const [voiceStatus, setVoiceStatus] = useState<string | null>(null);
  const bottomRef = useRef<HTMLDivElement>(null);
  const mediaRecorderRef = useRef<MediaRecorder | null>(null);
  const chunksRef = useRef<Blob[]>([]);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages, isThinking]);

  const submitCurrent = async () => {
    const cleaned = input.trim();
    if (!cleaned || isThinking) return;
    setInput("");
    await onSendMessage(cleaned);
  };

  const handleKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      void submitCurrent();
    }
  };

  const startBrowserSpeechFallback = () => {
    const SpeechRec =
      (window as unknown as Record<string, unknown>).SpeechRecognition ||
      (window as unknown as Record<string, unknown>).webkitSpeechRecognition;
    if (!SpeechRec) {
      setVoiceStatus("Voice input needs ElevenLabs key or Chrome/Edge Speech API.");
      return;
    }
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const rec = new (SpeechRec as any)();
    rec.lang = "en-US";
    rec.interimResults = false;
    setRecording(true);
    setVoiceStatus("Listening (browser speech)...");
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    rec.onresult = (ev: any) => {
      const spoken = ev.results?.[0]?.[0]?.transcript ?? "";
      if (spoken) setInput((prev) => (prev ? `${prev} ${spoken}` : spoken));
      setRecording(false);
      setVoiceStatus(null);
    };
    rec.onerror = () => {
      setRecording(false);
      setVoiceStatus("Microphone input failed.");
    };
    rec.onend = () => setRecording(false);
    rec.start();
  };

  const toggleMic = async () => {
    setVoiceStatus(null);
    if (recording && mediaRecorderRef.current) {
      mediaRecorderRef.current.stop();
      setRecording(false);
      return;
    }

    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      const recorder = new MediaRecorder(stream);
      chunksRef.current = [];
      recorder.ondataavailable = (ev) => {
        if (ev.data.size > 0) chunksRef.current.push(ev.data);
      };
      recorder.onstop = async () => {
        stream.getTracks().forEach((t) => t.stop());
        const blob = new Blob(chunksRef.current, { type: "audio/webm" });
        const form = new FormData();
        form.append("file", blob, "voice.webm");
        setVoiceStatus("Transcribing with ElevenLabs...");
        try {
          const res = await fetch("/api/voice/transcribe", { method: "POST", body: form });
          if (res.status === 503) {
            startBrowserSpeechFallback();
            return;
          }
          if (!res.ok) throw new Error("STT error");
          const data = (await res.json()) as { text: string };
          if (data.text) setInput((prev) => (prev ? `${prev} ${data.text}` : data.text));
          setVoiceStatus(null);
        } catch {
          setVoiceStatus("Transcription failed.");
        }
      };
      mediaRecorderRef.current = recorder;
      recorder.start();
      setRecording(true);
      setVoiceStatus("Recording... click mic again to transcribe.");
    } catch {
      startBrowserSpeechFallback();
    }
  };

  return (
    <main className="flex-1 flex flex-col bg-[#0B0D12] min-w-0">
      <header className="h-11 px-4 border-b border-white/10 flex items-center justify-between">
        <div className="flex items-center gap-2 text-xs text-zinc-400 min-w-0">
          <ShieldCheck className="w-4 h-4 text-indigo-400 shrink-0" />
          <span className="font-medium text-zinc-200">SilentFix AI</span>
          {activeFolder && (
            <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded bg-white/5 border border-white/10 text-[11px] text-zinc-300 truncate max-w-xs">
              <Folder className="w-3 h-3 text-indigo-400 shrink-0" />
              <span className="truncate">{activeFolder}</span>
              <button
                type="button"
                onClick={() => onAttachFolder(null)}
                className="hover:text-white ml-1"
                title="Detach folder"
              >
                <X className="w-3 h-3" />
              </button>
            </span>
          )}
        </div>

        <button
          type="button"
          onClick={onToggleTerminal}
          className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-md bg-white/5 hover:bg-white/10 text-xs text-zinc-300 transition shrink-0"
        >
          {terminalOpen ? (
            <>
              <PanelRightClose className="w-3.5 h-3.5" />
              Hide Terminal
            </>
          ) : (
            <>
              <PanelRightOpen className="w-3.5 h-3.5" />
              Open Terminal
            </>
          )}
        </button>
      </header>

      <div className="flex-1 overflow-y-auto px-6 py-6">
        {messages.length === 0 ? (
          <div className="h-full flex flex-col items-center justify-center max-w-xl mx-auto space-y-6">
            <div className="text-center space-y-2">
              <h1 className="text-2xl font-semibold tracking-tight text-zinc-100">
                What can SilentFix help you solve today?
              </h1>
              <p className="text-sm text-zinc-400">
                Ask naturally, paste any terminal error, or speak with the microphone.
                Every fix is filtered for safety before you run it.
              </p>
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-2.5 w-full">
              {STARTER_PROMPTS.map((item) => (
                <button
                  key={item.title}
                  type="button"
                  onClick={() => void onSendMessage(item.prompt)}
                  className="text-left p-3.5 rounded-xl bg-[#11141C] hover:bg-[#161A24] border border-white/10 transition space-y-1"
                >
                  <p className="text-xs font-medium text-zinc-100">{item.title}</p>
                  <p className="text-[11px] text-zinc-400 line-clamp-2">{item.prompt}</p>
                </button>
              ))}
            </div>
          </div>
        ) : (
          <div className="max-w-2xl mx-auto space-y-6">
            <AnimatePresence initial={false}>
              {messages.map((msg, idx) => (
                <ChatMessageBubble
                  key={msg.id}
                  message={msg}
                  isLatest={idx === messages.length - 1 && !isThinking}
                  onQuickReply={(txt) => void onSendMessage(txt)}
                  onPasteToTerminal={onPasteToTerminal}
                  onRunInTerminal={onRunInTerminal}
                  onTriggerSandbox={(pkg) => void onTriggerSandbox(pkg)}
                  onTriggerFolderScan={(fp) => void onTriggerFolderScan(fp)}
                />
              ))}
            </AnimatePresence>

            {isThinking && (
              <div className="flex items-center gap-2 text-xs text-zinc-400">
                <Loader2 className="w-3.5 h-3.5 animate-spin text-indigo-400" />
                <span>{thinkingStage}</span>
              </div>
            )}
            <div ref={bottomRef} />
          </div>
        )}
      </div>

      <div className="p-4 border-t border-white/10">
        <div className="max-w-2xl mx-auto space-y-2">
          {showFolderBar && (
            <form
              onSubmit={(e) => {
                e.preventDefault();
                if (folderDraft.trim()) {
                  onAttachFolder(folderDraft.trim());
                  setFolderDraft("");
                  setShowFolderBar(false);
                }
              }}
              className="flex items-center gap-2 p-2 rounded-xl bg-[#12151E] border border-white/10"
            >
              <input
                type="text"
                value={folderDraft}
                onChange={(e) => setFolderDraft(e.target.value)}
                placeholder="Paste project folder path (e.g. C:\Users\User\Downloads\app)"
                className="flex-1 bg-transparent text-xs text-zinc-100 placeholder:text-zinc-500 focus:outline-none px-1.5"
              />
              <button
                type="submit"
                className="px-3 py-1 rounded-lg bg-indigo-500 hover:bg-indigo-400 text-xs font-medium text-white"
              >
                Attach
              </button>
            </form>
          )}

          <div className="rounded-2xl bg-[#12151E] border border-white/10 p-3 space-y-2 focus-within:border-indigo-500/50 transition">
            <textarea
              rows={2}
              value={input}
              onChange={(e) => setInput(e.target.value)}
              onKeyDown={handleKeyDown}
              placeholder="Describe what you need or paste an error... (Enter to send, Shift+Enter for new line)"
              className="w-full resize-none bg-transparent text-sm text-zinc-100 placeholder:text-zinc-500 focus:outline-none px-1"
            />
            <div className="flex items-center justify-between pt-1">
              <div className="flex items-center gap-2">
                <button
                  type="button"
                  onClick={() => setShowFolderBar((v) => !v)}
                  className="inline-flex items-center gap-1 px-2 py-1 rounded-md bg-white/5 hover:bg-white/10 text-[11px] text-zinc-300 transition"
                >
                  <FolderPlus className="w-3.5 h-3.5 text-zinc-400" />
                  Folder
                </button>
                <span className="text-[11px] text-zinc-500">
                  {voiceStatus ?? "Safety Filters & Local Probe Active"}
                </span>
              </div>

              <div className="flex items-center gap-2">
                <button
                  type="button"
                  onClick={() => void toggleMic()}
                  title="Speech to Text (ElevenLabs)"
                  className={`p-2 rounded-full transition ${
                    recording
                      ? "bg-rose-500/20 text-rose-300 border border-rose-500/40"
                      : "bg-white/5 hover:bg-white/10 text-zinc-300"
                  }`}
                >
                  {recording ? <MicOff className="w-4 h-4" /> : <Mic className="w-4 h-4" />}
                </button>

                {isThinking ? (
                  <button
                    type="button"
                    onClick={onCancelRequest}
                    title="Stop response"
                    className="p-2 rounded-full bg-rose-500/20 hover:bg-rose-500/30 text-rose-200 transition"
                  >
                    <Square className="w-4 h-4" />
                  </button>
                ) : (
                  <button
                    type="button"
                    onClick={() => void submitCurrent()}
                    disabled={!input.trim()}
                    title="Send message"
                    className="p-2 rounded-full bg-zinc-100 hover:bg-white text-zinc-950 disabled:opacity-40 transition"
                  >
                    <Send className="w-4 h-4" />
                  </button>
                )}
              </div>
            </div>
          </div>
        </div>
      </div>
    </main>
  );
};
