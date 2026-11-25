// frontend/src/App.tsx
import React, { useState } from "react";
import { MotionConfig } from "framer-motion";
import { Sidebar } from "./components/Sidebar";
import { AIChatbot } from "./components/AIChatbot";
import { TerminalPane } from "./components/TerminalPane";
import { useSilentFixChat } from "./hooks/useSilentFixChat";
import type { TerminalEntry } from "./types/workspace";

export function App() {
  const chat = useSilentFixChat();
  const [terminalOpen, setTerminalOpen] = useState(true);
  const [terminalCwd, setTerminalCwd] = useState("C:\\Users\\User\\Downloads\\SILENTFIX");
  const [terminalEntries, setTerminalEntries] = useState<TerminalEntry[]>([]);
  const [terminalDraft, setTerminalDraft] = useState("");
  const [isRunningCmd, setIsRunningCmd] = useState(false);

  const handleRunTerminalCommand = async (cmd: string) => {
    setTerminalOpen(true);
    setIsRunningCmd(true);
    try {
      const res = await fetch("/api/terminal/exec", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          session_id: chat.activeSession.id,
          command: cmd,
          cwd: chat.activeSession.folderPath ?? terminalCwd,
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
    } finally {
      setIsRunningCmd(false);
    }
  };

  return (
    <MotionConfig reducedMotion="user">
      <div className="h-screen w-screen overflow-hidden flex bg-[#0B0D12] text-zinc-100">
        <Sidebar
          sessions={chat.sessions.map((s) => ({
            id: s.id,
            title: s.title,
            folderPath: s.folderPath,
            messages: [],
          }))}
          activeSessionId={chat.activeId}
          onSelectSession={chat.setActiveId}
          onNewSession={chat.newSession}
          onRepairFolder={chat.runFolderScan}
          isRepairingFolder={chat.isThinking}
        />

        <AIChatbot
          messages={chat.activeSession.messages}
          activeFolder={chat.activeSession.folderPath}
          isThinking={chat.isThinking}
          thinkingStage={chat.thinkingStage}
          terminalOpen={terminalOpen}
          onToggleTerminal={() => setTerminalOpen((v) => !v)}
          onSendMessage={chat.sendMessage}
          onCancelRequest={chat.cancelRequest}
          onAttachFolder={chat.setFolderContext}
          onPasteToTerminal={(cmd) => {
            setTerminalOpen(true);
            setTerminalDraft(cmd);
          }}
          onRunInTerminal={(cmd) => void handleRunTerminalCommand(cmd)}
          onTriggerSandbox={chat.runCloudPretest}
          onTriggerFolderScan={chat.runFolderScan}
        />

        {terminalOpen && (
          <TerminalPane
            sessionId={chat.activeSession.id}
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
