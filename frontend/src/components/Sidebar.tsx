import React, { useState } from "react";
import {
  FlaskConical,
  FolderOpen,
  MessageSquare,
  Plus,
  ShieldCheck,
  Sparkles,
  Wrench,
} from "lucide-react";
import type { RepairSession } from "../types/workspace";
import type { WorkspaceMode } from "../types/pillars";

interface SidebarProps {
  activeMode: WorkspaceMode;
  onSelectMode: (mode: WorkspaceMode) => void;
  sessions: RepairSession[];
  activeSessionId: string;
  onSelectSession: (id: string) => void;
  onNewSession: () => void;
  onRepairFolder: (folderPath: string) => Promise<void>;
  isRepairingFolder: boolean;
}

const MODE_ITEMS: {
  id: WorkspaceMode;
  label: string;
  sublabel: string;
  icon: React.ElementType;
}[] = [
  {
    id: "folder_repair",
    label: "Folder & Legacy Repair",
    sublabel: "VM + Display Fit + Smart Diff",
    icon: FolderOpen,
  },
  {
    id: "cli_isolator",
    label: "Broken CLI Isolator",
    sublabel: "Env Mirror + Hypothesis Matrix",
    icon: FlaskConical,
  },
  {
    id: "terminal_assistant",
    label: "Terminal Assistant",
    sublabel: "PowerShell AST Verified Guide",
    icon: Sparkles,
  },
];

export const Sidebar: React.FC<SidebarProps> = ({
  activeMode,
  onSelectMode,
  sessions,
  activeSessionId,
  onSelectSession,
  onNewSession,
  onRepairFolder,
  isRepairingFolder,
}) => {
  const [showFolderInput, setShowFolderInput] = useState(false);
  const [folderInput, setFolderInput] = useState("");

  const handleFolderSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    const cleaned = folderInput.trim();
    if (!cleaned) return;
    await onRepairFolder(cleaned);
    setFolderInput("");
    setShowFolderInput(false);
  };

  return (
    <aside className="w-64 shrink-0 bg-[#0E1015] border-r border-white/10 flex flex-col justify-between select-none overflow-hidden">
      <div className="p-3 space-y-4 overflow-y-auto">
        {/* Brand */}
        <div className="flex items-center gap-2 px-2 py-1">
          <ShieldCheck className="w-5 h-5 text-indigo-400" />
          <span className="font-semibold tracking-tight text-sm text-zinc-100">SilentFix</span>
        </div>

        {/* 3-Mode Switcher */}
        <div className="space-y-1">
          <p className="px-2 pb-1 text-[10px] font-mono font-semibold uppercase tracking-wider text-zinc-500">
            Engineering Pillars
          </p>
          {MODE_ITEMS.map((item) => {
            const Icon = item.icon;
            const isActive = activeMode === item.id;
            return (
              <button
                key={item.id}
                type="button"
                onClick={() => onSelectMode(item.id)}
                className={`w-full flex items-start gap-2.5 px-2.5 py-2 rounded-lg text-left transition ${
                  isActive
                    ? "bg-indigo-500/15 border border-indigo-500/40 text-zinc-100"
                    : "border border-transparent text-zinc-400 hover:bg-white/5 hover:text-zinc-200"
                }`}
              >
                <Icon
                  className={`w-4 h-4 shrink-0 mt-0.5 ${
                    isActive ? "text-indigo-400" : "text-zinc-500"
                  }`}
                />
                <div className="min-w-0">
                  <div className="text-xs font-medium truncate">{item.label}</div>
                  <div className="text-[10px] text-zinc-500 truncate">{item.sublabel}</div>
                </div>
              </button>
            );
          })}
        </div>

        {/* AI Chat Workspace Section */}
        <div className="pt-2 border-t border-white/10 space-y-2">
          <p className="px-2 text-[10px] font-mono font-semibold uppercase tracking-wider text-zinc-500">
            AI Chat Workspace
          </p>

          <button
            type="button"
            onClick={() => {
              onNewSession();
              onSelectMode("chat");
            }}
            className="w-full flex items-center gap-2 px-3 py-1.5 rounded-lg bg-white/5 hover:bg-white/10 border border-white/10 text-xs font-medium text-zinc-100 transition"
          >
            <Plus className="w-3.5 h-3.5 text-zinc-300" />
            New Conversation
          </button>

          <button
            type="button"
            onClick={() => setShowFolderInput((v) => !v)}
            className="w-full flex items-center gap-2 px-3 py-1.5 rounded-lg bg-indigo-500/10 hover:bg-indigo-500/20 border border-indigo-500/30 text-xs font-medium text-indigo-200 transition"
          >
            <FolderOpen className="w-3.5 h-3.5 text-indigo-300" />
            Quick Chat Folder Scan
          </button>

          {showFolderInput && (
            <form
              onSubmit={handleFolderSubmit}
              className="space-y-2 p-2.5 rounded-lg bg-black/40 border border-white/10"
            >
              <label className="block text-[11px] text-zinc-400">
                Folder path to scan &amp; AWS pre-test
              </label>
              <input
                type="text"
                value={folderInput}
                onChange={(e) => setFolderInput(e.target.value)}
                placeholder="C:\Users\User\Downloads\broken-app"
                className="w-full bg-[#0B0D12] border border-white/10 rounded px-2 py-1.5 text-xs text-zinc-100 placeholder:text-zinc-600 focus:outline-none focus:border-indigo-400"
              />
              <button
                type="submit"
                disabled={isRepairingFolder || !folderInput.trim()}
                className="w-full py-1.5 rounded bg-indigo-500 hover:bg-indigo-400 disabled:opacity-40 text-xs font-medium text-white transition"
              >
                {isRepairingFolder ? "Scanning..." : "Scan in Chat"}
              </button>
            </form>
          )}

          <div className="space-y-1 max-h-[30vh] overflow-y-auto pt-1">
            {sessions.map((sess) => {
              const active = activeMode === "chat" && sess.id === activeSessionId;
              return (
                <button
                  key={sess.id}
                  type="button"
                  onClick={() => {
                    onSelectSession(sess.id);
                    onSelectMode("chat");
                  }}
                  className={`w-full flex items-center gap-2 px-2.5 py-1.5 rounded-lg text-left text-xs truncate transition ${
                    active
                      ? "bg-white/10 text-zinc-100"
                      : "text-zinc-400 hover:bg-white/5 hover:text-zinc-200"
                  }`}
                >
                  <MessageSquare className="w-3.5 h-3.5 shrink-0 text-zinc-500" />
                  <span className="truncate">{sess.title}</span>
                </button>
              );
            })}
          </div>
        </div>
      </div>

      <div className="p-3 border-t border-white/10 text-[11px] text-zinc-500 flex items-center gap-2 shrink-0">
        <Wrench className="w-3.5 h-3.5 text-emerald-400" />
        <span>Zero-Shell Safety Active</span>
      </div>
    </aside>
  );
};
