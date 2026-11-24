"""Module 4 Helper: Pre-Install Environment Snapshot & Safe Rollback Deltas.

Captures HKCU\\Environment variables (specifically PATH) and shallow listings
of %LOCALAPPDATA%\\Programs and %APPDATA% prior to package installation.
Diffs snapshots after rollback uninstallation to safely restore PATH deltas
and identify candidate orphan directories for opt-in user approval.
"""

from __future__ import annotations

import logging
import os
import sys
from pathlib import Path
from typing import Any

logger = logging.getLogger("silentfix.winget_rollback")

if sys.platform == "win32":
    import winreg
else:
    winreg = None


def read_user_environment_registry() -> dict[str, str]:
    """Read all values from HKCU\\Environment."""
    env_vars: dict[str, str] = {}
    if winreg is None:
        # Fallback for non-Windows or test environments
        return {"PATH": os.environ.get("PATH", "")}

    try:
        with winreg.OpenKey(winreg.HKEY_CURRENT_USER, r"Environment", 0, winreg.KEY_READ) as key:
            index = 0
            while True:
                try:
                    name, val, _ = winreg.EnumValue(key, index)
                    env_vars[name] = str(val)
                    index += 1
                except OSError:
                    break
    except Exception as err:
        logger.debug("Could not read HKCU\\Environment: %s", err)
        env_vars["PATH"] = os.environ.get("PATH", "")

    return env_vars


def capture_shallow_directory_listing(base_path: str) -> list[str]:
    """Capture top-level subdirectories in a given folder."""
    p = Path(os.path.expandvars(base_path))
    if not p.is_dir():
        return []
    try:
        return [str(child.resolve()) for child in p.iterdir() if child.is_dir()]
    except Exception:
        return []


def capture_user_env_snapshot() -> dict[str, Any]:
    """Capture complete pre-installation environment and program directories."""
    env_vars = read_user_environment_registry()
    known_dirs: list[str] = []

    # Check common program locations
    program_roots = [
        r"%LOCALAPPDATA%\Programs",
        r"%APPDATA%",
    ]
    for root in program_roots:
        known_dirs.extend(capture_shallow_directory_listing(root))

    return {
        "env_vars": env_vars,
        "known_dirs": known_dirs,
    }


def diff_env_snapshots(before: dict[str, Any], after: dict[str, Any]) -> dict[str, Any]:
    """Diff pre-install and post-install snapshots to identify PATH deltas

    and newly created candidate orphan directories.
    """
    before_env = before.get("env_vars", {})
    after_env = after.get("env_vars", {})

    before_path = [p.strip() for p in before_env.get("PATH", "").split(";") if p.strip()]
    after_path = [p.strip() for p in after_env.get("PATH", "").split(";") if p.strip()]

    added_paths = [p for p in after_path if p not in before_path]
    removed_paths = [p for p in before_path if p not in after_path]

    before_dirs = set(before.get("known_dirs", []))
    after_dirs = set(after.get("known_dirs", []))
    candidate_orphan_dirs = sorted(list(after_dirs - before_dirs))

    return {
        "added_path_entries": added_paths,
        "removed_path_entries": removed_paths,
        "candidate_orphan_dirs": candidate_orphan_dirs,
    }


def restore_user_path_delta(target_path_str: str) -> bool:
    """Restore the user's HKCU\\Environment\\PATH variable safely."""
    if winreg is None:
        return False
    try:
        with winreg.OpenKey(
            winreg.HKEY_CURRENT_USER, r"Environment", 0, winreg.KEY_SET_VALUE
        ) as key:
            winreg.SetValueEx(key, "PATH", 0, winreg.REG_EXPAND_SZ, target_path_str)
        logger.info("Successfully restored user HKCU\\Environment\\PATH")
        return True
    except Exception as exc:
        logger.warning("Failed to restore user PATH in registry: %s", exc)
        return False
