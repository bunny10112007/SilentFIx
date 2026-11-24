export interface FixCardData {
  title: string;
  explanation: string;
  command: string | null;
  filter_status: "VERIFIED_SAFE" | "SANDBOX_PASSED" | "BLOCKED_UNSAFE" | "INFO_ONLY";
  filter_notes: string[];
}

export interface ChatMessage {
  id: string;
  role: "user" | "assistant";
  text: string;
  fixCard?: FixCardData | null;
  timestamp: string;
}

export interface RepairSession {
  id: string;
  title: string;
  folderPath: string | null;
  messages: ChatMessage[];
}

export interface TerminalEntry {
  id: string;
  cwd: string;
  command: string;
  stdout: string;
  stderr: string;
  exitCode: number;
  blocked: boolean;
}
