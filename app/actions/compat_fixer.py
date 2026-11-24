"""Pillar 2: Windows 11 Compatibility Shim Engine.

Applies per-user compatibility shims to
HKCU\\Software\\Microsoft\\Windows NT\\CurrentVersion\\AppCompatFlags\\Layers
to fix legacy app crashes and high-DPI scaling issues without altering binary signatures.
"""

from __future__ import annotations

import logging
import os
import sys
from pathlib import Path
from typing import Literal

from pydantic import BaseModel, ConfigDict, Field

logger = logging.getLogger("silentfix.compat_fixer")

if sys.platform == "win32":
    import winreg
else:
    winreg = None

APPCOMPAT_SUBKEY = r"Software\Microsoft\Windows NT\CurrentVersion\AppCompatFlags\Layers"

OsCompatMode = Literal["WIN8RTM", "WIN7RTM", "VISTASP2", "WINXPSP3"]
DisplayCompatFlag = Literal["HIGHDPIAWARE", "DPIUNAWARE", "GDIDPISCALING", "640X480", "256COLOR"]


class CompatShimParams(BaseModel):
    model_config = ConfigDict(strict=True, extra="forbid")
    executable_path: str = Field(min_length=4, max_length=400)
    os_mode: OsCompatMode | None = "WIN7RTM"
    display_flags: list[DisplayCompatFlag] = Field(default_factory=lambda: ["HIGHDPIAWARE"])
    run_as_admin: bool = False


class CompatShimResult(BaseModel):
    model_config = ConfigDict(strict=True, extra="forbid")
    success: bool
    executable_path: str
    applied_layer: str
    previous_layer: str | None = None
    detail: str
    reg_file_content: str | None = None


def generate_reg_file_snippet(exe_path: str, layer_str: str) -> str:
    """Generate a downloadable Windows .reg registry snippet for manual import."""
    escaped_exe = exe_path.replace("\\", "\\\\")
    return (
        "Windows Registry Editor Version 5.00\r\n\r\n"
        "[HKEY_CURRENT_USER\\Software\\Microsoft\\Windows NT\\CurrentVersion\\AppCompatFlags\\Layers]\r\n"
        f'"{escaped_exe}"="{layer_str}"\r\n'
    )


def build_layer_string(params: CompatShimParams) -> str:
    """Build the AppCompatFlags layer string."""
    tokens: list[str] = ["~"]
    if params.run_as_admin:
        tokens.append("RUNASADMIN")
    for flag in dict.fromkeys(params.display_flags):
        tokens.append(flag)
    if params.os_mode:
        tokens.append(params.os_mode)
    return " ".join(tokens)


def _read_compat_layer(exe_path: str) -> str | None:
    """Read existing AppCompat layer value from registry if present."""
    if winreg is None:
        return None
    try:
        with winreg.OpenKey(winreg.HKEY_CURRENT_USER, APPCOMPAT_SUBKEY, 0, winreg.KEY_READ) as key:
            val, _ = winreg.QueryValueEx(key, exe_path)
            return str(val) if val else None
    except FileNotFoundError:
        return None
    except OSError as err:
        logger.debug("Registry read skipped: %s", err)
        return None


def _write_compat_layer(exe_path: str, layer_value: str | None) -> None:
    """Write or delete AppCompat layer value in HKCU registry."""
    if winreg is None:
        raise RuntimeError("Windows compatibility shims are supported only on Windows.")
    try:
        with winreg.CreateKeyEx(
            winreg.HKEY_CURRENT_USER, APPCOMPAT_SUBKEY, 0, winreg.KEY_SET_VALUE
        ) as key:
            if layer_value is None:
                try:
                    winreg.DeleteValue(key, exe_path)
                except FileNotFoundError:
                    pass
            else:
                winreg.SetValueEx(key, exe_path, 0, winreg.REG_SZ, layer_value)
    except OSError as err:
        logger.warning("Failed to write compatibility layer to registry: %s", err)
        raise


def apply_compatibility_shim(params: CompatShimParams) -> CompatShimResult:
    """Apply compatibility layer flags to the specified executable."""
    target = Path(params.executable_path).resolve()
    if not target.is_file() or target.suffix.lower() != ".exe":
        return CompatShimResult(
            success=False,
            executable_path=str(target),
            applied_layer="",
            detail=f"Blocked: '{target}' must be an existing .exe file.",
        )

    normalized_exe = os.path.normpath(str(target))
    layer_str = build_layer_string(params)

    try:
        previous = _read_compat_layer(normalized_exe)
        _write_compat_layer(normalized_exe, layer_str)
        return CompatShimResult(
            success=True,
            executable_path=normalized_exe,
            applied_layer=layer_str,
            previous_layer=previous,
            detail=f"Applied compatibility shim '{layer_str}' to {target.name}.",
            reg_file_content=generate_reg_file_snippet(normalized_exe, layer_str),
        )
    except Exception as exc:
        reg_snippet = generate_reg_file_snippet(normalized_exe, layer_str)
        return CompatShimResult(
            success=False,
            executable_path=normalized_exe,
            applied_layer="",
            detail=f"Registry operation failed: {str(exc)}",
            reg_file_content=reg_snippet,
        )


def restore_compatibility_shim(executable_path: str, previous_layer: str | None) -> bool:
    """Restore or remove compatibility layer flags for an executable."""
    try:
        _write_compat_layer(os.path.normpath(executable_path), previous_layer)
        return True
    except Exception as exc:
        logger.error("Failed to restore compatibility shim: %s", exc)
        return False
