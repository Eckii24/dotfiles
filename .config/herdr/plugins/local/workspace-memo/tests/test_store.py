from __future__ import annotations

import os
import subprocess
import sys
import tempfile
import tomllib
import unittest
from pathlib import Path
from unittest.mock import patch

sys.path.insert(0, str(Path(__file__).parents[1] / "src"))

import workspace_memo
from workspace_memo import MemoStore


class MemoStoreTest(unittest.TestCase):
    def setUp(self) -> None:
        self.temp_dir = tempfile.TemporaryDirectory()
        self.addCleanup(self.temp_dir.cleanup)
        self.store = MemoStore(Path(self.temp_dir.name))

    def test_memo_lifecycle_tracks_nonempty_markdown_by_workspace_id(self) -> None:
        workspace_id = "w42"

        self.assertFalse(self.store.has_memo(workspace_id))
        self.assertEqual(self.store.path_for(workspace_id).name, "w42.md")

        self.store.path_for(workspace_id).write_text("# Focus\n\nShip workspace memo\n")
        self.assertTrue(self.store.has_memo(workspace_id))
        self.assertEqual(self.store.existing_workspace_ids(), {workspace_id})

        self.store.remove(workspace_id)
        self.assertFalse(self.store.path_for(workspace_id).exists())

    def test_empty_memo_is_not_kept_or_shown(self) -> None:
        workspace_id = "w-empty"
        self.store.path_for(workspace_id).write_text(" \n\t\n")

        self.assertFalse(self.store.finalize(workspace_id))
        self.assertFalse(self.store.path_for(workspace_id).exists())

    def test_prune_removes_closed_workspace_memos_only(self) -> None:
        self.store.path_for("w-live").write_text("keep\n")
        self.store.path_for("w-closed").write_text("remove\n")
        self.store.path_for("w-empty-closed").write_text("\n")

        self.assertEqual(self.store.prune({"w-live"}), {"w-closed", "w-empty-closed"})
        self.assertTrue(self.store.path_for("w-live").exists())
        self.assertFalse(self.store.path_for("w-closed").exists())
        self.assertFalse(self.store.path_for("w-empty-closed").exists())

    def test_workspace_id_is_rejected_when_it_cannot_be_a_safe_filename(self) -> None:
        with self.assertRaises(ValueError):
            self.store.path_for("../escape")

    def test_toggle_opens_manifest_configured_popup(self) -> None:
        response = subprocess.CompletedProcess(
            args=[],
            returncode=0,
            stdout='{"result":{"plugin_pane":{"pane":{"pane_id":"w42:p2"}}}}',
            stderr="",
        )
        with (
            patch.dict(os.environ, {"HERDR_WORKSPACE_ID": "w42"}, clear=False),
            patch("workspace_memo.run_herdr", return_value=response) as run_herdr,
        ):
            self.assertEqual(workspace_memo.toggle(), 0)

        run_herdr.assert_called_once_with(
            "plugin",
            "pane",
            "open",
            "--plugin",
            "matthias.workspace-memo",
            "--entrypoint",
            "editor",
            "--env",
            "HERDR_WORKSPACE_ID=w42",
        )

    def test_editor_is_a_three_quarter_popup(self) -> None:
        manifest_path = Path(__file__).parents[1] / "herdr-plugin.toml"
        manifest = tomllib.loads(manifest_path.read_text(encoding="utf-8"))
        editor = next(pane for pane in manifest["panes"] if pane["id"] == "editor")

        self.assertEqual(editor["placement"], "popup")
        self.assertEqual(editor["width"], "75%")
        self.assertEqual(editor["height"], "75%")

    def test_nvim_editor_maps_toggle_keys_to_save_and_close(self) -> None:
        with patch.dict(os.environ, {"EDITOR": "nvim --clean"}, clear=False):
            command = workspace_memo.memo_editor()

        self.assertEqual(command[:2], ["nvim", "--clean"])
        self.assertIn(r"nnoremap <silent> <C-y>m :wqall<CR>", command)
        self.assertIn(r"inoremap <silent> <C-y>m <Esc>:wqall<CR>", command)
        self.assertIn(r"xnoremap <silent> <C-y>m <Esc>:wqall<CR>", command)


if __name__ == "__main__":
    unittest.main()
