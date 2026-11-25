export type IntentKind =
  | "cli_error"
  | "install_software"
  | "configure_git"
  | "legacy_compat"
  | "repair_folder"
  | "general_help";

export type ActionKind =
  | "none"
  | "run_terminal"
  | "repair_folder"
  | "apply_compat_shim"
  | "cloud_pretest"
  | "configure_git";

export interface ProposedAction {
  kind: ActionKind;
  label: string;
  command: string | null;
  package_id: string | null;
  folder_path: string | null;
  executable_path: string | null;
  safety_status: "VERIFIED_SAFE" | "BLOCKED_UNSAFE" | "INFO_ONLY";
  safety_notes: string[];
}

export interface BotMessage {
  id: string;
  role: "user" | "assistant";
  text: string;
  timestamp: string;
  intent?: IntentKind;
  needsClarification?: boolean;
  quickReplies?: string[];
  action?: ProposedAction | null;
}

export interface ChatSession {
  id: string;
  title: string;
  folderPath: string | null;
  updatedAt: string;
  messages: BotMessage[];
}
