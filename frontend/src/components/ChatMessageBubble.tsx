import React, { useState } from "react";
import { motion } from "framer-motion";
import {
  ArrowRight,
  Check,
  Cloud,
  Copy,
  FolderSearch,
  HelpCircle,
  Play,
  ShieldAlert,
  ShieldCheck,
  Terminal,
} from "lucide-react";
import type { BotMessage, IntentKind } from "../types/chatbot";

const INTENT_LABELS: Record<IntentKind, string> = {
  cli_error: "CLI Error Repair",
  install_software: "Verified Install",
  configure_git: "Git Configuration",
  legacy_compat: "Win11 Compatibility",
  repair_folder: "Broken Folder Repair",
  general_help: "Assistant",
};

interface ChatMessageBubbleProps {
  message: BotMessage;
  isLatest: boolean;
  onQuickReply: (text: string) => void;
  onPasteToTerminal: (cmd: string) => void;
  onRunInTerminal: (cmd: string) => void;
  onTriggerSandbox: (packageId: string) => void;
  onTriggerFolderScan: (folderPath: string) => void;
}

export const ChatMessageBubble: React.FC<ChatMessageBubbleProps> = ({
  message,
  isLatest,
  onQuickReply,
  onPasteToTerminal,
  onRunInTerminal,
  onTriggerSandbox,
  onTriggerFolderScan,
}) => {
  const [copied, setCopied] = useState(false);

  const handleCopy = async (cmd: string) => {
    await navigator.clipboard.writeText(cmd);
    setCopied(true);
    window.setTimeout(() => setCopied(false), 1600);
  };

  if (message.role === "user") {
    return (
      <motion.div
        initial={{ opacity: 0, y: 8 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.16 }}
        className="flex justify-end"
      >
        <div className="max-w-[82%] px-4 py-2.5 rounded-2xl bg-indigo-500/15 border border-indigo-400/25 text-sm text-zinc-100 whitespace-pre-wrap">
          {message.text}
        </div>
      </motion.div>
    );
  }

  const action = message.action;

  return (
    <motion.div
      initial={{ opacity: 0, y: 10 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.18 }}
      className="space-y-3"
    >
      <div className="flex items-center gap-2">
        {message.intent && (
          <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-md bg-white/5 border border-white/10 text-[11px] font-medium text-zinc-300">
            <Terminal className="w-3 h-3 text-indigo-400" />
            {INTENT_LABELS[message.intent]}
          </span>
        )}
        {message.needsClarification && (
          <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-md bg-amber-500/10 border border-amber-500/25 text-[11px] font-medium text-amber-300">
            <HelpCircle className="w-3 h-3" />
            Needs Info
          </span>
        )}
      </div>

      <p className="text-sm leading-relaxed text-zinc-200 whitespace-pre-wrap">
        {message.text}
      </p>

      {action && (
        <div className="rounded-xl bg-[#11141C] border border-white/10 p-4 space-y-3">
          <div className="flex items-center justify-between gap-2">
            <span className="text-xs font-semibold text-zinc-100">{action.label}</span>
            <span
              className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[11px] font-medium ${
                action.safety_status === "BLOCKED_UNSAFE"
                  ? "bg-rose-500/15 text-rose-300 border border-rose-500/30"
                  : "bg-emerald-500/15 text-emerald-300 border border-emerald-500/30"
              }`}
            >
              {action.safety_status === "BLOCKED_UNSAFE" ? (
                <ShieldAlert className="w-3 h-3" />
              ) : (
                <ShieldCheck className="w-3 h-3" />
              )}
              {action.safety_status === "BLOCKED_UNSAFE" ? "Blocked Unsafe" : "Verified Safe"}
            </span>
          </div>

          {action.command && (
            <div className="rounded-lg bg-[#090B0F] border border-white/10 p-3 flex flex-col sm:flex-row sm:items-center justify-between gap-3">
              <code className="font-mono text-xs text-indigo-200 break-all">
                {action.command}
              </code>
              <div className="flex items-center gap-1.5 shrink-0">
                <button
                  type="button"
                  onClick={() => handleCopy(action.command!)}
                  className="inline-flex items-center gap-1 px-2.5 py-1.5 rounded-md bg-white/5 hover:bg-white/10 text-xs text-zinc-200 transition"
                >
                  {copied ? (
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
                  onClick={() => onPasteToTerminal(action.command!)}
                  className="inline-flex items-center gap-1 px-2.5 py-1.5 rounded-md bg-white/5 hover:bg-white/10 text-xs text-zinc-200 transition"
                >
                  Paste
                  <ArrowRight className="w-3.5 h-3.5" />
                </button>
                <button
                  type="button"
                  onClick={() => onRunInTerminal(action.command!)}
                  className="inline-flex items-center gap-1 px-2.5 py-1.5 rounded-md bg-indigo-500 hover:bg-indigo-400 text-xs font-medium text-white transition"
                >
                  <Play className="w-3 h-3" />
                  Run
                </button>
              </div>
            </div>
          )}

          <div className="flex flex-wrap items-center gap-2">
            {action.kind === "cloud_pretest" && action.package_id && (
              <button
                type="button"
                onClick={() => onTriggerSandbox(action.package_id!)}
                className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-indigo-500/15 hover:bg-indigo-500/25 border border-indigo-400/30 text-xs font-medium text-indigo-200 transition"
              >
                <Cloud className="w-3.5 h-3.5" />
                Pre-Test {action.package_id} in AWS Sandbox
              </button>
            )}
            {action.kind === "repair_folder" && action.folder_path && (
              <button
                type="button"
                onClick={() => onTriggerFolderScan(action.folder_path!)}
                className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-indigo-500/15 hover:bg-indigo-500/25 border border-indigo-400/30 text-xs font-medium text-indigo-200 transition"
              >
                <FolderSearch className="w-3.5 h-3.5" />
                Scan Folder & Pre-Test in AWS
              </button>
            )}
          </div>

          {action.safety_notes.length > 0 && (
            <p className="text-[11px] text-zinc-500">{action.safety_notes.join(" · ")}</p>
          )}
        </div>
      )}

      {isLatest && message.quickReplies && message.quickReplies.length > 0 && (
        <div className="flex flex-wrap gap-2 pt-1">
          {message.quickReplies.map((option) => (
            <button
              key={option}
              type="button"
              onClick={() => onQuickReply(option)}
              className="px-3 py-1.5 rounded-full bg-white/5 hover:bg-white/10 border border-white/10 text-xs text-zinc-300 hover:text-zinc-100 transition"
            >
              {option}
            </button>
          ))}
        </div>
      )}
    </motion.div>
  );
};
