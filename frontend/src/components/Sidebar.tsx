import React, { useState } from "react";
import { FolderOpen, MessageSquare, Plus, ShieldCheck, Wrench } from "lucide-react";
import type { RepairSession } from "../types/workspace";

interface SidebarProps {
  sessions: RepairSession[];
  activeSessionId: string;
  onSelectSession: (id: string) => void;
  onNewSession: () => void;
  onRepairFolder: (folderPath: string) => Promise<void>;
  isRepairingFolder: boolean;
}

export const Sidebar: React.FC<SidebarProps> = ({
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
    <aside className="w-60 shrink-0 bg-[#0E1015] border-r border-white/10 flex flex-col justify-between select-none">
      <div className="p-3 space-y-3">
        <div className="flex items-center gap-2 px-2 py-1.5">
          <ShieldCheck className="w-5 h-5 text-indigo-400" />
          <span className="font-semibold tracking-tight text-sm text-zinc-100">SilentFix</span>
        </div>

        <button
          type="button"
          onClick={onNewSession}
          className="w-full flex items-center gap-2 px-3 py-2 rounded-lg bg-white/5 hover:bg-white/10 border border-white/10 text-xs font-medium text-zinc-100 transition"
        >
          <Plus className="w-4 h-4 text-zinc-300" />
          New Conversation
        </button>

        <button
          type="button"
          onClick={() => setShowFolderInput((v) => !v)}
          className="w-full flex items-center gap-2 px-3 py-2 rounded-lg bg-indigo-500/10 hover:bg-indigo-500/20 border border-indigo-500/30 text-xs font-medium text-indigo-200 transition"
        >
          <FolderOpen className="w-4 h-4 text-indigo-300" />
          Open Broken Folder
        </button>

        {showFolderInput && (
          <form onSubmit={handleFolderSubmit} className="space-y-2 p-2.5 rounded-lg bg-black/40 border border-white/10">
            <label className="block text-[11px] text-zinc-400">
              Folder path to scan & AWS pre-test
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
              {isRepairingFolder ? "Scanning in AWS Sandbox..." : "Scan & Fix Packages"}
            </button>
          </form>
        )}

        <div className="pt-2">
          <p className="px-2 pb-1.5 text-[11px] font-medium uppercase tracking-wider text-zinc-500">
            Repair Sessions
          </p>
          <div className="space-y-1 max-h-[55vh] overflow-y-auto">
            {sessions.map((sess) => {
              const active = sess.id === activeSessionId;
              return (
                <button
                  key={sess.id}
                  type="button"
                  onClick={() => onSelectSession(sess.id)}
                  className={`w-full flex items-center gap-2 px-2.5 py-2 rounded-lg text-left text-xs truncate transition ${
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

      <div className="p-3 border-t border-white/10 text-[11px] text-zinc-500 flex items-center gap-2">
        <Wrench className="w-3.5 h-3.5 text-emerald-400" />
        <span>Backend Filters Active</span>
      </div>
    </aside>
  );
};
