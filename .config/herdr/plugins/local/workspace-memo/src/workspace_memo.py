#!/usr/bin/env python3
"""Herdr workspace memo: Markdown note lifecycle and sidebar marker."""

from __future__ import annotations

import json
import os
import re
import shlex
import subprocess
import sys
from pathlib import Path
from typing import Any

PLUGIN_ID = "matthias.workspace-memo"
MARKER = "✎"
SAFE_WORKSPACE_ID = re.compile(r"^[A-Za-z0-9:_-]+$")


class MemoStore:
    def __init__(self, state_dir: Path) -> None:
        self.state_dir = state_dir
        self.memos_dir = state_dir / "memos"
        self.open_dir = state_dir / "open"
        self.memos_dir.mkdir(parents=True, exist_ok=True)
        self.open_dir.mkdir(parents=True, exist_ok=True)

    def path_for(self, workspace_id: str) -> Path:
        if not SAFE_WORKSPACE_ID.fullmatch(workspace_id):
            raise ValueError(f"unsafe workspace id: {workspace_id!r}")
        return self.memos_dir / f"{workspace_id}.md"

    def open_path_for(self, workspace_id: str) -> Path:
        if not SAFE_WORKSPACE_ID.fullmatch(workspace_id):
            raise ValueError(f"unsafe workspace id: {workspace_id!r}")
        return self.open_dir / workspace_id

    def has_memo(self, workspace_id: str) -> bool:
        path = self.path_for(workspace_id)
        return path.is_file() and bool(path.read_text(encoding="utf-8").strip())

    def finalize(self, workspace_id: str) -> bool:
        path = self.path_for(workspace_id)
        if path.exists() and not path.read_text(encoding="utf-8").strip():
            path.unlink()
        return self.has_memo(workspace_id)

    def existing_workspace_ids(self) -> set[str]:
        if not self.memos_dir.exists():
            return set()
        return {
            path.stem
            for path in self.memos_dir.glob("*.md")
            if SAFE_WORKSPACE_ID.fullmatch(path.stem) and path.read_text(encoding="utf-8").strip()
        }

    def stored_workspace_ids(self) -> set[str]:
        return {
            path.stem
            for path in self.memos_dir.glob("*.md")
            if SAFE_WORKSPACE_ID.fullmatch(path.stem)
        }

    def remove(self, workspace_id: str) -> None:
        for path in (self.path_for(workspace_id), self.open_path_for(workspace_id)):
            path.unlink(missing_ok=True)

    def prune(self, live_workspace_ids: set[str]) -> set[str]:
        removed: set[str] = set()
        for workspace_id in self.stored_workspace_ids():
            if workspace_id not in live_workspace_ids:
                self.remove(workspace_id)
                removed.add(workspace_id)
        return removed


def state_store() -> MemoStore:
    state_dir = os.environ.get("HERDR_PLUGIN_STATE_DIR")
    if not state_dir:
        raise RuntimeError("HERDR_PLUGIN_STATE_DIR is not set")
    return MemoStore(Path(state_dir))


def herdr_command() -> str:
    return os.environ.get("HERDR_BIN_PATH", "herdr")


def run_herdr(*args: str, check: bool = True) -> subprocess.CompletedProcess[str]:
    return subprocess.run(
        [herdr_command(), *args], text=True, capture_output=True, check=check
    )


def report_marker(workspace_id: str, has_memo: bool) -> None:
    args = [
        "workspace",
        "report-metadata",
        workspace_id,
        "--source",
        PLUGIN_ID,
    ]
    if has_memo:
        args.extend(["--token", f"memo={MARKER}"])
    else:
        args.extend(["--clear-token", "memo"])
    result = run_herdr(*args, check=False)
    if result.returncode:
        print(result.stderr.strip(), file=sys.stderr)


def current_workspace_id() -> str:
    workspace_id = os.environ.get("HERDR_WORKSPACE_ID")
    if not workspace_id:
        raise RuntimeError("workspace memo requires a Herdr workspace context")
    if not SAFE_WORKSPACE_ID.fullmatch(workspace_id):
        raise RuntimeError(f"unsafe workspace id: {workspace_id!r}")
    return workspace_id


def memo_editor() -> list[str]:
    editor = os.environ.get("EDITOR") or "vi"
    command = shlex.split(editor)
    if not command:
        raise RuntimeError("EDITOR is empty")
    return command


def edit() -> int:
    store = state_store()
    workspace_id = current_workspace_id()
    path = store.path_for(workspace_id)
    path.parent.mkdir(parents=True, exist_ok=True)
    path.touch(exist_ok=True)
    try:
        returncode = subprocess.run([*memo_editor(), str(path)]).returncode
    finally:
        has_memo = store.finalize(workspace_id)
        store.open_path_for(workspace_id).unlink(missing_ok=True)
        report_marker(workspace_id, has_memo)
    return returncode


def toggle() -> int:
    store = state_store()
    workspace_id = current_workspace_id()
    open_path = store.open_path_for(workspace_id)
    if open_path.is_file():
        pane_id = open_path.read_text(encoding="utf-8").strip()
        if pane_id:
            result = run_herdr("plugin", "pane", "close", pane_id, check=False)
            if result.returncode == 0:
                open_path.unlink(missing_ok=True)
                return 0
        open_path.unlink(missing_ok=True)

    result = run_herdr(
        "plugin",
        "pane",
        "open",
        "--plugin",
        PLUGIN_ID,
        "--entrypoint",
        "editor",
        "--placement",
        "overlay",
        "--workspace",
        workspace_id,
    )
    payload = json.loads(result.stdout)
    pane_id = payload["result"]["pane"]["pane_id"]
    open_path.parent.mkdir(parents=True, exist_ok=True)
    open_path.write_text(pane_id, encoding="utf-8")
    return 0


def find_workspace_id(value: Any) -> str | None:
    if isinstance(value, dict):
        for key in ("workspace_id", "closed_workspace_id"):
            candidate = value.get(key)
            if isinstance(candidate, str) and SAFE_WORKSPACE_ID.fullmatch(candidate):
                return candidate
        for child in value.values():
            found = find_workspace_id(child)
            if found:
                return found
    elif isinstance(value, list):
        for child in value:
            found = find_workspace_id(child)
            if found:
                return found
    return None


def workspace_closed() -> int:
    event = json.loads(os.environ["HERDR_PLUGIN_EVENT_JSON"])
    workspace_id = find_workspace_id(event)
    if workspace_id:
        state_store().remove(workspace_id)
    return 0


def startup() -> int:
    store = state_store()
    result = run_herdr("workspace", "list")
    payload = json.loads(result.stdout)
    live_workspace_ids = {
        workspace["workspace_id"]
        for workspace in payload["result"]["workspaces"]
        if SAFE_WORKSPACE_ID.fullmatch(workspace["workspace_id"])
    }
    store.prune(live_workspace_ids)
    for workspace_id in live_workspace_ids:
        report_marker(workspace_id, store.has_memo(workspace_id))
    return 0


def main() -> int:
    commands = {
        "edit": edit,
        "startup": startup,
        "toggle": toggle,
        "workspace-closed": workspace_closed,
    }
    if len(sys.argv) != 2 or sys.argv[1] not in commands:
        print(f"usage: {Path(sys.argv[0]).name} {{{', '.join(commands)}}}", file=sys.stderr)
        return 2
    try:
        return commands[sys.argv[1]]()
    except (RuntimeError, subprocess.CalledProcessError, json.JSONDecodeError, KeyError) as error:
        print(f"workspace-memo: {error}", file=sys.stderr)
        return 1


if __name__ == "__main__":
    raise SystemExit(main())
