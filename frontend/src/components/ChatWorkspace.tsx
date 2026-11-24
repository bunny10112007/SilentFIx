import React, { useRef, useState } from "react";
import { AnimatePresence, motion } from "framer-motion";
import {
  ArrowRight,
  Check,
  Copy,
  Folder,
  Mic,
  MicOff,
  PanelRightClose,
  PanelRightOpen,
  Send,
  ShieldAlert,
  ShieldCheck,
} from "lucide-react";
import type { ChatMessage } from "../types/workspace";

interface ChatWorkspaceProps {
  messages: ChatMessage[];
  activeFolder: string | null;
  isLoading: boolean;
  terminalOpen: boolean;
  onToggleTerminal: () => void;
  onSendMessage: (text: string) => Promise<void>;
  onPasteToTerminal: (cmd: string) => void;
}

export const ChatWorkspace: React.FC<ChatWorkspaceProps> = ({
  messages,
  activeFolder,
  isLoading,
  terminalOpen,
  onToggleTerminal,
  onSendMessage,
  onPasteToTerminal,
}) => {
  const [input, setInput] = useState("");
  const [copiedId, setCopiedId] = useState<string | null>(null);
  const [recording, setRecording] = useState(false);
  const [voiceNote, setVoiceNote] = useState<string | null>(null);
  const mediaRecorderRef = useRef<MediaRecorder | null>(null);
  const chunksRef = useRef<Blob[]>([]);

  const handleCopy = async (id: string, cmd: string) => {
    await navigator.clipboard.writeText(cmd);
    setCopiedId(id);
    setTimeout(() => setCopiedId(null), 1600);
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    const cleaned = input.trim();
    if (!cleaned || isLoading) return;
    setInput("");
    await onSendMessage(cleaned);
  };

  const startBrowserSpeechFallback = () => {
    const SpeechRec =
      (window as unknown as Record<string, unknown>).SpeechRecognition ||
      (window as unknown as Record<string, unknown>).webkitSpeechRecognition;
    if (!SpeechRec) {
      setVoiceNote("Voice input requires ElevenLabs API key or Chrome/Edge Speech API.");
      return;
    }
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const recognition = new (SpeechRec as any)();
    recognition.lang = "en-US";
    recognition.interimResults = false;
    setRecording(true);
    setVoiceNote("Listening (browser voice fallback)...");
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    recognition.onresult = (event: any) => {
      const transcript = event.results?.[0]?.[0]?.transcript ?? "";
      if (transcript) setInput((prev) => (prev ? `${prev} ${transcript}` : transcript));
      setRecording(false);
      setVoiceNote(null);
    };
    recognition.onerror = () => {
      setRecording(false);
      setVoiceNote("Could not capture audio.");
    };
    recognition.onend = () => setRecording(false);
    recognition.start();
  };

  const toggleMicrophone = async () => {
    setVoiceNote(null);
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
        form.append("file", blob, "voice-command.webm");
        setVoiceNote("Transcribing with ElevenLabs...");

        try {
          const res = await fetch("/api/voice/transcribe", { method: "POST", body: form });
          if (res.status === 503) {
            setVoiceNote("ElevenLabs offline — switching to browser voice.");
            startBrowserSpeechFallback();
            return;
          }
          if (!res.ok) throw new Error("Transcription failed");
          const data = (await res.json()) as { text: string };
          if (data.text) {
            setInput((prev) => (prev ? `${prev} ${data.text}` : data.text));
          }
          setVoiceNote(null);
        } catch {
          setVoiceNote("Could not transcribe audio.");
        }
      };

      mediaRecorderRef.current = recorder;
      recorder.start();
      setRecording(true);
      setVoiceNote("Recording... click mic again to type.");
    } catch {
      startBrowserSpeechFallback();
    }
  };

  return (
    <main className="flex-1 flex flex-col bg-[#0B0D12] min-w-0">
      <header className="h-10 px-4 border-b border-white/10 flex items-center justify-between">
        <div className="flex items-center gap-2 text-xs text-zinc-400">
          {activeFolder ? (
            <>
              <Folder className="w-3.5 h-3.5 text-indigo-400" />
              <span className="truncate max-w-md text-zinc-200">{activeFolder}</span>
            </>
          ) : (
            <span>SilentFix Assistant</span>
          )}
        </div>
        <button
          type="button"
          onClick={onToggleTerminal}
          className="flex items-center gap-1.5 px-2.5 py-1 rounded-md bg-white/5 hover:bg-white/10 text-xs text-zinc-300 transition"
        >
          {terminalOpen ? (
            <>
              <PanelRightClose className="w-3.5 h-3.5" />
              <span>Hide Terminal</span>
            </>
          ) : (
            <>
              <PanelRightOpen className="w-3.5 h-3.5" />
              <span>Open Terminal</span>
            </>
          )}
        </button>
      </header>

      <div className="flex-1 overflow-y-auto px-6 py-6">
        {messages.length === 0 ? (
          <div className="h-full flex flex-col items-center justify-center text-center max-w-lg mx-auto space-y-3">
            <div className="w-12 h-12 rounded-2xl bg-white/5 border border-white/10 flex items-center justify-center">
              <ShieldCheck className="w-6 h-6 text-indigo-400" />
            </div>
            <h1 className="text-2xl font-semibold tracking-tight text-zinc-100">
              What error should we fix today?
            </h1>
            <p className="text-sm text-zinc-400">
              Describe an error, speak with the microphone, or open a broken folder on the left.
              SilentFix checks every fix through security and AWS sandbox filters first.
            </p>
          </div>
        ) : (
          <div className="max-w-2xl mx-auto space-y-5">
            <AnimatePresence initial={false}>
              {messages.map((msg) => (
                <motion.div
                  key={msg.id}
                  initial={{ opacity: 0, y: 10 }}
                  animate={{ opacity: 1, y: 0 }}
                  transition={{ duration: 0.18 }}
                  className={msg.role === "user" ? "flex justify-end" : "space-y-3"}
                >
                  {msg.role === "user" ? (
                    <div className="max-w-[85%] px-4 py-2.5 rounded-2xl bg-white/10 text-sm text-zinc-100">
                      {msg.text}
                    </div>
                  ) : (
                    <div className="space-y-3">
                      <p className="text-sm leading-relaxed text-zinc-200">{msg.text}</p>

                      {msg.fixCard && (
                        <div className="rounded-xl bg-[#11141C] border border-white/10 p-4 space-y-3">
                          <div className="flex items-center justify-between gap-2">
                            <span className="text-xs font-semibold text-zinc-100">
                              {msg.fixCard.title}
                            </span>
                            <span
                              className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[11px] font-medium ${
                                msg.fixCard.filter_status === "BLOCKED_UNSAFE"
                                  ? "bg-rose-500/15 text-rose-300 border border-rose-500/30"
                                  : "bg-emerald-500/15 text-emerald-300 border border-emerald-500/30"
                              }`}
                            >
                              {msg.fixCard.filter_status === "BLOCKED_UNSAFE" ? (
                                <ShieldAlert className="w-3 h-3" />
                              ) : (
                                <ShieldCheck className="w-3 h-3" />
                              )}
                              {msg.fixCard.filter_status === "SANDBOX_PASSED"
                                ? "AWS Sandbox Passed"
                                : msg.fixCard.filter_status === "BLOCKED_UNSAFE"
                                ? "Blocked Unsafe"
                                : "Verified Safe"}
                            </span>
                          </div>

                          {msg.fixCard.command && (
                            <div className="rounded-lg bg-[#090B0F] border border-white/10 p-3 flex items-center justify-between gap-3">
                              <code className="font-mono text-xs text-indigo-200 break-all">
                                {msg.fixCard.command}
                              </code>
                              <div className="flex items-center gap-1.5 shrink-0">
                                <button
                                  type="button"
                                  onClick={() => handleCopy(msg.id, msg.fixCard!.command!)}
                                  className="inline-flex items-center gap-1 px-2.5 py-1.5 rounded-md bg-white/5 hover:bg-white/10 text-xs text-zinc-200 transition"
                                >
                                  {copiedId === msg.id ? (
                                    <>
                                      <Check className="w-3.5 h-3.5 text-emerald-400" />
                                      Copied
                                    </>
                                  ) : (
                                    <>
                                      <Copy className="w-3.5 h-3.5" />
                                      Copy
                                    </>
                                  )}
                                </button>
                                <button
                                  type="button"
                                  onClick={() => onPasteToTerminal(msg.fixCard!.command!)}
                                  className="inline-flex items-center gap-1 px-2.5 py-1.5 rounded-md bg-indigo-500 hover:bg-indigo-400 text-xs font-medium text-white transition"
                                >
                                  Paste
                                  <ArrowRight className="w-3.5 h-3.5" />
                                </button>
                              </div>
                            </div>
                          )}

                          {msg.fixCard.filter_notes.length > 0 && (
                            <div className="text-[11px] text-zinc-500">
                              {msg.fixCard.filter_notes.join(" · ")}
                            </div>
                          )}
                        </div>
                      )}
                    </div>
                  )}
                </motion.div>
              ))}
            </AnimatePresence>

            {isLoading && (
              <div className="text-xs text-zinc-400 animate-pulse">
                Analyzing error and verifying command safety...
              </div>
            )}
          </div>
        )}
      </div>

      <div className="p-4 border-t border-white/10">
        <form
          onSubmit={handleSubmit}
          className="max-w-2xl mx-auto rounded-2xl bg-[#12151E] border border-white/10 p-3 space-y-2.5 focus-within:border-indigo-500/50 transition"
        >
          <input
            type="text"
            value={input}
            onChange={(e) => setInput(e.target.value)}
            placeholder="Describe your error or paste terminal output..."
            className="w-full bg-transparent text-sm text-zinc-100 placeholder:text-zinc-500 focus:outline-none px-1"
          />
          <div className="flex items-center justify-between pt-1">
            <span className="text-[11px] text-zinc-500 px-1">
              {voiceNote ?? "Gemini 3.5 Flash Lite · Backend Safety Filters On"}
            </span>
            <div className="flex items-center gap-2">
              <button
                type="button"
                onClick={toggleMicrophone}
                title="Voice to Text (ElevenLabs)"
                className={`p-2 rounded-full transition ${
                  recording
                    ? "bg-rose-500/20 text-rose-300 border border-rose-500/40"
                    : "bg-white/5 hover:bg-white/10 text-zinc-300"
                }`}
              >
                {recording ? <MicOff className="w-4 h-4" /> : <Mic className="w-4 h-4" />}
              </button>
              <button
                type="submit"
                disabled={isLoading || !input.trim()}
                className="p-2 rounded-full bg-zinc-100 hover:bg-white text-zinc-950 disabled:opacity-40 transition"
              >
                <Send className="w-4 h-4" />
              </button>
            </div>
          </div>
        </form>
      </div>
    </main>
  );
};
