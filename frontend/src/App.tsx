// frontend/src/App.tsx
import React, { useState } from "react";
import { MotionConfig } from "framer-motion";
import { Sidebar } from "./components/Sidebar";
import { AIChatbot } from "./components/AIChatbot";
import { CliIsolatorPanel } from "./components/CliIsolatorPanel";
import { TerminalPane } from "./components/TerminalPane";
import { FolderRepairPanel } from "./components/FolderRepairPanel";
import { CliIsolatorMode } from "./components/CliIsolatorMode";
import { TerminalAssistantMode } from "./components/TerminalAssistantMode";
import { useSilentFixChat } from "./hooks/useSilentFixChat";
import type { TerminalEntry } from "./types/workspace";

type PillarMode = "folder_repair" | "cli_isolator" | "terminal_assistant";

const PILLAR_NAV: { id: PillarMode; label: string; subtitle: string; icon: React.ReactNode }[] = [
  {
    id: "folder_repair",
    label: "Folder & Legacy Repair",
    subtitle: "AWS VM scan, display fit & diff",
    icon: <FolderOpen className="w-4 h-4" />,
  },
  {
    id: "cli_isolator",
    label: "Broken CLI Isolator",
    subtitle: "Mirror env & test hypotheses",
    icon: <Wrench className="w-4 h-4" />,
  },
  {
    id: "terminal_assistant",
    label: "Terminal Assistant",
    subtitle: "AST-verified PowerShell guide",
    icon: <Terminal className="w-4 h-4" />,
  },
];

export function App() {
  const [activePillar, setActivePillar] = useState<PillarMode>("folder_repair");
  const [sessionId] = useState(() => `sf_${Math.random().toString(36).slice(2, 10)}`);
  const [terminalOpen, setTerminalOpen] = useState(true);
  const [terminalCwd, setTerminalCwd] = useState("C:\\Users\\User\\Downloads\\SILENTFIX");
  const [terminalEntries, setTerminalEntries] = useState<TerminalEntry[]>([]);
  const [terminalDraft, setTerminalDraft] = useState("");
  const [isRunningCmd, setIsRunningCmd] = useState(false);

  const handlePasteToTerminal = (cmd: string) => {
    setTerminalOpen(true);
    setTerminalDraft(cmd);
  };

  const handleRunTerminalCommand = async (cmd: string) => {
    setTerminalOpen(true);
    setIsRunningCmd(true);
    try {
      const res = await fetch("/api/terminal/exec", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          session_id: sessionId,
          command: cmd,
          cwd: terminalCwd,
        }),
      });
      const data = (await res.json()) as {
        command: string;
        cwd: string;
        stdout: string;
        stderr: string;
        exit_code: number;
        blocked: boolean;
      };
      setTerminalCwd(data.cwd);
      setTerminalEntries((prev) => [
        ...prev,
        {
          id: `t_${Date.now()}`,
          cwd: data.cwd,
          command: data.command,
          stdout: data.stdout,
          stderr: data.stderr,
          exitCode: data.exit_code,
          blocked: data.blocked,
        },
      ]);
    } catch {
      setTerminalEntries((prev) => [
        ...prev,
        {
          id: `t_${Date.now()}_err`,
          cwd: terminalCwd,
          command: cmd,
          stdout: "",
          stderr: "Could not reach /api/terminal/exec on port 8000.",
          exitCode: 500,
          blocked: false,
        },
      ]);
    } finally {
      setIsRunningCmd(false);
    }
  };

  return (
    <MotionConfig reducedMotion="user">
      <div className="h-screen w-screen overflow-hidden flex bg-[#0B0D12] text-zinc-100">
        <Sidebar
          activeMode={activeMode}
          onSelectMode={setActiveMode}
          sessions={chat.sessions.map((s) => ({
            id: s.id,
            title: s.title,
            folderPath: s.folderPath,
            messages: [],
          }))}
          activeSessionId={chat.activeId}
          onSelectSession={(id) => {
            chat.setActiveId(id);
            setActiveMode("chat");
          }}
          onNewSession={chat.newSession}
          onRepairFolder={async (folderPath) => {
            await chat.runFolderScan(folderPath);
            setActiveMode("chat");
          }}
          isRepairingFolder={chat.isThinking}
        />

        {activeMode === "folder_repair" && (
          <FolderRepairPanel
            onSelectWorkingDir={(folderPath) => {
              setTerminalCwd(folderPath);
              chat.setFolderContext(folderPath);
            }}
            onPasteToTerminal={handlePasteToTerminal}
            onRunInTerminal={(cmd) => void handleRunTerminalCommand(cmd)}
          />
        )}

          <div className="pt-3 border-t border-white/10 px-2 text-[11px] text-zinc-500 space-y-1">
            <div className="flex items-center gap-1.5 text-emerald-400">
              <ShieldCheck className="w-3.5 h-3.5" />
              <span>Zero-Hallucination Guards On</span>
            </div>
            <p className="font-mono text-[10px] text-zinc-600 truncate">{terminalCwd}</p>
          </div>
        </aside>

        {/* Center Active Pillar Workspace */}
        <div className="flex-1 flex flex-col min-w-0">
          <header className="h-10 px-4 border-b border-white/10 flex items-center justify-between bg-[#0B0D12]">
            <span className="text-xs font-medium text-zinc-300">
              {PILLAR_NAV.find((p) => p.id === activePillar)?.label}
            </span>
            <button
              type="button"
              onClick={() => setTerminalOpen((v) => !v)}
              className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-md bg-white/5 hover:bg-white/10 text-xs text-zinc-300 transition"
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

          {activePillar === "folder_repair" && (
            <FolderRepairPanel
              onSelectWorkingDir={(dir) => setTerminalCwd(dir)}
              onPasteToTerminal={handlePasteToTerminal}
              onRunInTerminal={(cmd) => void handleRunTerminalCommand(cmd)}
            />
          )}

          {activePillar === "cli_isolator" && (
            <CliIsolatorPanel
              activeFolder={terminalCwd}
              onPasteToTerminal={handlePasteToTerminal}
              onRunInTerminal={(cmd) => void handleRunTerminalCommand(cmd)}
            />
          )}

          {activePillar === "terminal_assistant" && (
            <TerminalAssistantPanel
              onPasteToTerminal={handlePasteToTerminal}
              onRunInTerminal={(cmd) => void handleRunTerminalCommand(cmd)}
            />
          )}
        </div>

        {/* Right Half-Window Filtered PowerShell Terminal */}
        {terminalOpen && (
          <TerminalPane
            sessionId={sessionId}
            cwd={terminalCwd}
            entries={terminalEntries}
            draftCommand={terminalDraft}
            onDraftChange={setTerminalDraft}
            onRunCommand={handleRunTerminalCommand}
            onClear={() => setTerminalEntries([])}
            isRunning={isRunningCmd}
          />
        )}
      </div>
    </MotionConfig>
  );
}

export default App;
