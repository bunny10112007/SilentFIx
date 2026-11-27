export type WorkspaceMode =
  | "folder_repair"
  | "cli_isolator"
  | "terminal_assistant"
  | "chat";

// --- Pillar 1: Folder & Legacy Repair ---
export interface FolderIssue {
  severity: "error" | "warning";
  category: "missing_dependency" | "runtime_dll" | "crash_log" | "display_dpi";
  file: string;
  detail: string;
}

export interface MalwareScanReport {
  clean: boolean;
  exit_code: number;
  engine: string;
  summary: string;
}

export interface DisplayPreviewState {
  iteration: number;
  target_width: number;
  target_height: number;
  dpi_scale_percent: number;
  applied_compat_layer: string;
  fits_resolution: boolean | null;
  preview_url: string;
  notes: string;
}

export interface FileDiffEntry {
  relative_path: string;
  status: "added" | "modified" | "unchanged";
  size_bytes: number;
  unified_diff: string | null;
}

export interface FolderRepairJob {
  job_id: string;
  source_folder: string;
  status:
    | "SCANNED"
    | "TESTING_IN_VM"
    | "AWAITING_DISPLAY_CHECK"
    | "READY_TO_APPLY"
    | "THREAT_BLOCKED"
    | "FAILED";
  vm_backend: "aws_ec2_ssm" | "local_mock_vm";
  vm_instance_id: string | null;
  issues: FolderIssue[];
  installed_dependencies: string[];
  malware_report: MalwareScanReport | null;
  crash_test_passed: boolean;
  crash_log_tail: string;
  display_preview: DisplayPreviewState | null;
  verified_zip_path: string | null;
  file_diffs: FileDiffEntry[];
}

export interface SelectiveApplyResult {
  applied_files: string[];
  backup_dir: string;
}

// --- Pillar 2: Broken CLI Isolator ---
export interface EnvSnapshot {
  missing_command: string | null;
  current_path_entries: string[];
  tool_on_disk: string | null;
  in_local_venv_or_node: string | null;
  shell_platform: string;
}

export interface HypothesisTestResult {
  hypothesis_id: string;
  cause_title: string;
  candidate_commands: string[];
  verification_probe: string;
  outcome: "PASSED" | "FAILED" | "SKIPPED";
  evidence: string;
}

export interface CliIsolationReport {
  snapshot: EnvSnapshot;
  mirror_backend: "aws_cloud_sandbox" | "isolated_local_mirror";
  exact_root_cause: string;
  empirically_verified: boolean;
  exact_fix_commands: string[];
  tested_hypotheses: HypothesisTestResult[];
}

// --- Pillar 3: Terminal Assistant ---
export interface FlagExplanation {
  part: string;
  meaning: string;
}

export interface VerifiedStep {
  step_title: string;
  command: string;
  plain_explanation: string;
  flag_breakdown: FlagExplanation[];
  verification_badge:
    | "SYNTAX_AND_CMDLET_VERIFIED"
    | "DETERMINISTIC_RECIPE"
    | "UNVERIFIED_WITHHELD";
}

export interface AssistantGuideResponse {
  task_summary: string;
  grounded: boolean;
  steps: VerifiedStep[];
  clarifying_question: string | null;
  warnings: string[];
}
