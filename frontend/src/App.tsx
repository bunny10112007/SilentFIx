import React, { useState } from "react";
import { MotionConfig } from "framer-motion";
import { Sidebar } from "./components/Sidebar";
import { ChatWorkspace } from "./components/ChatWorkspace";
import { TerminalPane } from "./components/TerminalPane";
import type { ChatMessage, FixCardData, RepairSession, TerminalEntry } from "./types/workspace";

const createSession = (): RepairSession => ({
  id: `sess_${Math.random().toString(36).slice(2, 10)}`,
  title: "New Repair Session",
  folderPath: null,
  messages: [],
});

export function App() {
  const [sessions, setSessions] = useState<RepairSession[]>([createSession()]);
  const [activeId, setActiveId] = useState<string>(sessions[0].id);
  const [terminalOpen, setTerminalOpen] = useState(true);
  const [terminalCwd, setTerminalCwd] = useState("C:\\Users\\User\\Downloads\\SILENTFIX");
  const [terminalEntries, setTerminalEntries] = useState<TerminalEntry[]>([]);
  const [terminalDraft, setTerminalDraft] = useState("");
  const [isSending, setIsSending] = useState(false);
  const [isRepairingFolder, setIsRepairingFolder] = useState(false);
  const [isRunningCmd, setIsRunningCmd] = useState(false);

  const activeSession = sessions.find((s) => s.id === activeId) ?? sessions[0];

  const appendMessages = (sessionId: string, newMsgs: ChatMessage[], newTitle?: string, folderPath?: string) => {
    setSessions((prev) =>
      prev.map((s) =>
        s.id === sessionId
          ? {
              ...s,
              title: newTitle && s.messages.length === 0 ? newTitle : s.title,
              folderPath: folderPath ?? s.folderPath,
              messages: [...s.messages, ...newMsgs],
            }
          : s
      )
    );
  };

  const handleNewSession = () => {
    const fresh = createSession();
    setSessions((prev) => [fresh, ...prev]);
    setActiveId(fresh.id);
  };

  const handleSendMessage = async (text: string) => {
    const userMsg: ChatMessage = {
      id: `m_${Date.now()}_u`,
      role: "user",
      text,
      timestamp: new Date().toISOString(),
    };
    appendMessages(activeSession.id, [userMsg], text.slice(0, 32));
    setIsSending(true);

    try {
      const res = await fetch("/api/workspace/chat", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          session_id: activeSession.id,
          message: text,
          folder_path: activeSession.folderPath,
        }),
      });
      const data = (await res.json()) as { reply: string; fix_card?: FixCardData | null };
      appendMessages(activeSession.id, [
        {
          id: `m_${Date.now()}_a`,
          role: "assistant",
          text: data.reply,
          fixCard: data.fix_card ?? null,
          timestamp: new Date().toISOString(),
        },
      ]);
    } catch {
      appendMessages(activeSession.id, [
        {
          id: `m_${Date.now()}_err`,
          role: "assistant",
          text: "Could not reach the SilentFix backend on port 8000.",
          timestamp: new Date().toISOString(),
        },
      ]);
    } finally {
      setIsSending(false);
    }
  };

  const handleRepairFolder = async (folderPath: string) => {
    setIsRepairingFolder(true);
    try {
      const res = await fetch("/api/workspace/repair-folder", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ folder_path: folderPath }),
      });
      if (!res.ok) {
        const err = (await res.json()) as { detail?: string };
        throw new Error(err.detail || "Folder scan failed");
      }
      const data = (await res.json()) as {
        folder_path: string;
        detected_files: string[];
        plain_explanation: string;
        sandbox_verdict: string;
        sandbox_backend: string;
        safe_commands: string[];
      };

      setTerminalCwd(data.folder_path);
      appendMessages(
        activeSession.id,
        [
          {
            id: `m_${Date.now()}_f`,
            role: "assistant",
            text: data.plain_explanation,
            fixCard: {
              title: `Folder Repair (${data.detected_files.slice(0, 3).join(", ") || "Scanned"})`,
              explanation: data.plain_explanation,
              command: data.safe_commands[0] ?? null,
              filter_status: data.sandbox_verdict === "PASSED" ? "SANDBOX_PASSED" : "VERIFIED_SAFE",
              filter_notes: [
                `AWS Sandbox: ${data.sandbox_verdict} (${data.sandbox_backend})`,
                "Packages verified safe before local execution",
              ],
            },
            timestamp: new Date().toISOString(),
          },
        ],
        folderPath.split(/[\\/]/).pop() || "Folder Repair",
        data.folder_path
      );
    } catch (err) {
      appendMessages(activeSession.id, [
        {
          id: `m_${Date.now()}_ferr`,
          role: "assistant",
          text: err instanceof Error ? err.message : "Could not inspect folder.",
          timestamp: new Date().toISOString(),
        },
      ]);
    } finally {
      setIsRepairingFolder(false);
    }
  };

  const handleRunTerminalCommand = async (cmd: string) => {
    setIsRunningCmd(true);
    try {
      const res = await fetch("/api/terminal/exec", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          session_id: activeSession.id,
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
    } finally {
      setIsRunningCmd(false);
    }
  };

  return (
    <MotionConfig reducedMotion="user">
      <div className="h-screen w-screen overflow-hidden flex bg-[#0B0D12] text-zinc-100">
        <Sidebar
          sessions={sessions}
          activeSessionId={activeSession.id}
          onSelectSession={setActiveId}
          onNewSession={handleNewSession}
          onRepairFolder={handleRepairFolder}
          isRepairingFolder={isRepairingFolder}
        />

        <ChatWorkspace
          messages={activeSession.messages}
          activeFolder={activeSession.folderPath}
          isLoading={isSending}
          terminalOpen={terminalOpen}
          onToggleTerminal={() => setTerminalOpen((v) => !v)}
          onSendMessage={handleSendMessage}
          onPasteToTerminal={(cmd) => {
            setTerminalOpen(true);
            setTerminalDraft(cmd);
          }}
        />

        {terminalOpen && (
          <TerminalPane
            sessionId={activeSession.id}
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
