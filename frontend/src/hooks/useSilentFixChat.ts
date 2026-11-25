import { useCallback, useEffect, useRef, useState } from "react";
import type { BotMessage, ChatSession, IntentKind, ProposedAction } from "../types/chatbot";

const STORAGE_KEY = "silentfix_chat_sessions_v1";

function createFreshSession(): ChatSession {
  return {
    id: `sf_${Math.random().toString(36).slice(2, 10)}`,
    title: "New Troubleshooting Chat",
    folderPath: null,
    updatedAt: new Date().toISOString(),
    messages: [],
  };
}

function loadInitialSessions(): ChatSession[] {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return [createFreshSession()];
    const parsed = JSON.parse(raw) as ChatSession[];
    return Array.isArray(parsed) && parsed.length > 0 ? parsed : [createFreshSession()];
  } catch {
    return [createFreshSession()];
  }
}

export function useSilentFixChat() {
  const [sessions, setSessions] = useState<ChatSession[]>(loadInitialSessions);
  const [activeId, setActiveId] = useState<string>(() => sessions[0].id);
  const [isThinking, setIsThinking] = useState(false);
  const [thinkingStage, setThinkingStage] = useState("Analyzing request...");
  const abortRef = useRef<AbortController | null>(null);

  useEffect(() => {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(sessions.slice(0, 25)));
    } catch {
      // Ignore quota errors in private mode
    }
  }, [sessions]);

  const activeSession = sessions.find((s) => s.id === activeId) ?? sessions[0];

  const updateSession = useCallback(
    (sessionId: string, updater: (session: ChatSession) => ChatSession) => {
      setSessions((prev) =>
        prev.map((s) => (s.id === sessionId ? updater(s) : s))
      );
    },
    []
  );

  const newSession = useCallback(() => {
    const fresh = createFreshSession();
    setSessions((prev) => [fresh, ...prev]);
    setActiveId(fresh.id);
  }, []);

  const deleteSession = useCallback(
    (sessionId: string) => {
      setSessions((prev) => {
        const remaining = prev.filter((s) => s.id !== sessionId);
        if (remaining.length === 0) {
          const fresh = createFreshSession();
          setActiveId(fresh.id);
          return [fresh];
        }
        if (sessionId === activeId) {
          setActiveId(remaining[0].id);
        }
        return remaining;
      });
    },
    [activeId]
  );

  const setFolderContext = useCallback(
    (folderPath: string | null) => {
      updateSession(activeSession.id, (s) => ({
        ...s,
        folderPath,
        updatedAt: new Date().toISOString(),
      }));
    },
    [activeSession.id, updateSession]
  );

  const cancelRequest = useCallback(() => {
    abortRef.current?.abort();
    abortRef.current = null;
    setIsThinking(false);
  }, []);

  const sendMessage = useCallback(
    async (rawText: string) => {
      const text = rawText.trim();
      if (!text || isThinking) return;

      const sessionId = activeSession.id;
      const priorHistory = activeSession.messages.slice(-12).map((m) => ({
        role: m.role,
        text: m.text,
      }));

      const userMsg: BotMessage = {
        id: `u_${Date.now()}`,
        role: "user",
        text,
        timestamp: new Date().toISOString(),
      };

      updateSession(sessionId, (s) => ({
        ...s,
        title: s.messages.length === 0 ? text.slice(0, 36) : s.title,
        updatedAt: new Date().toISOString(),
        messages: [...s.messages, userMsg],
      }));

      const controller = new AbortController();
      abortRef.current = controller;
      setIsThinking(true);
      setThinkingStage("Running safety filters & local probe...");

      const stageTimer = window.setTimeout(() => {
        setThinkingStage("Understanding context with Gemini...");
      }, 650);

      try {
        const res = await fetch("/api/chatbot/message", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          signal: controller.signal,
          body: JSON.stringify({
            session_id: sessionId,
            message: text,
            history: priorHistory,
            folder_path: activeSession.folderPath,
          }),
        });

        if (!res.ok) {
          throw new Error(`Backend responded with HTTP ${res.status}`);
        }

        const data = (await res.json()) as {
          intent: IntentKind;
          needs_clarification: boolean;
          reply: string;
          quick_replies: string[];
          action?: ProposedAction | null;
        };

        const botMsg: BotMessage = {
          id: `a_${Date.now()}`,
          role: "assistant",
          text: data.reply,
          intent: data.intent,
          needsClarification: data.needs_clarification,
          quickReplies: data.quick_replies,
          action: data.action ?? null,
          timestamp: new Date().toISOString(),
        };

        updateSession(sessionId, (s) => ({
          ...s,
          updatedAt: new Date().toISOString(),
          messages: [...s.messages, botMsg],
        }));
      } catch (err) {
        if ((err as Error).name === "AbortError") {
          updateSession(sessionId, (s) => ({
            ...s,
            messages: [
              ...s.messages,
              {
                id: `a_${Date.now()}_cancel`,
                role: "assistant",
                text: "Request cancelled.",
                timestamp: new Date().toISOString(),
              },
            ],
          }));
        } else {
          updateSession(sessionId, (s) => ({
            ...s,
            messages: [
              ...s.messages,
              {
                id: `a_${Date.now()}_err`,
                role: "assistant",
                text: "Could not reach the SilentFix backend on port 8000. Verify FastAPI is running.",
                timestamp: new Date().toISOString(),
              },
            ],
          }));
        }
      } finally {
        window.clearTimeout(stageTimer);
        abortRef.current = null;
        setIsThinking(false);
      }
    },
    [activeSession, isThinking, updateSession]
  );

  const runCloudPretest = useCallback(
    async (packageId: string) => {
      setIsThinking(true);
      setThinkingStage(`Pre-testing ${packageId} in AWS Sandbox...`);
      try {
        const res = await fetch("/api/sandbox/pretest", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ package_id: packageId, source: "winget", scope: "user" }),
        });
        const report = (await res.json()) as {
          verdict: string;
          backend: string;
          summary: string;
        };
        updateSession(activeSession.id, (s) => ({
          ...s,
          messages: [
            ...s.messages,
            {
              id: `sbx_${Date.now()}`,
              role: "assistant",
              intent: "install_software",
              text: `${report.summary} (Verdict: ${report.verdict} via ${report.backend}).`,
              action: {
                kind: "run_terminal",
                label: `Install Verified Package (${packageId})`,
                command: `winget install --id ${packageId} --exact --scope user --silent`,
                package_id: packageId,
                folder_path: null,
                executable_path: null,
                safety_status: "VERIFIED_SAFE",
                safety_notes: [`AWS Sandbox: ${report.verdict}`],
              },
              timestamp: new Date().toISOString(),
            },
          ],
        }));
      } finally {
        setIsThinking(false);
      }
    },
    [activeSession.id, updateSession]
  );

  const runFolderScan = useCallback(
    async (folderPath: string) => {
      setFolderContext(folderPath);
      setIsThinking(true);
      setThinkingStage("Scanning manifests & pre-testing in AWS Sandbox...");
      try {
        const res = await fetch("/api/workspace/repair-folder", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ folder_path: folderPath }),
        });
        if (!res.ok) {
          const err = (await res.json()) as { detail?: string };
          throw new Error(err.detail || "Folder scan failed.");
        }
        const data = (await res.json()) as {
          folder_path: string;
          detected_files: string[];
          plain_explanation: string;
          sandbox_verdict: string;
          sandbox_backend: string;
          safe_commands: string[];
        };

        updateSession(activeSession.id, (s) => ({
          ...s,
          title: folderPath.split(/[\\/]/).pop() || s.title,
          messages: [
            ...s.messages,
            {
              id: `fld_${Date.now()}`,
              role: "assistant",
              intent: "repair_folder",
              text: data.plain_explanation,
              action: {
                kind: "run_terminal",
                label: `Clean Package Fix (${data.detected_files.slice(0, 3).join(", ") || "Scanned"})`,
                command: data.safe_commands[0] ?? null,
                package_id: null,
                folder_path: data.folder_path,
                executable_path: null,
                safety_status: "VERIFIED_SAFE",
                safety_notes: [
                  `AWS Sandbox: ${data.sandbox_verdict} (${data.sandbox_backend})`,
                  "Filtered by backend safety rules",
                ],
              },
              timestamp: new Date().toISOString(),
            },
          ],
        }));
      } catch (err) {
        updateSession(activeSession.id, (s) => ({
          ...s,
          messages: [
            ...s.messages,
            {
              id: `fld_err_${Date.now()}`,
              role: "assistant",
              text: err instanceof Error ? err.message : "Could not scan folder.",
              timestamp: new Date().toISOString(),
            },
          ],
        }));
      } finally {
        setIsThinking(false);
      }
    },
    [activeSession.id, setFolderContext, updateSession]
  );

  return {
    sessions,
    activeSession,
    activeId,
    setActiveId,
    isThinking,
    thinkingStage,
    newSession,
    deleteSession,
    setFolderContext,
    sendMessage,
    cancelRequest,
    runCloudPretest,
    runFolderScan,
  };
}
