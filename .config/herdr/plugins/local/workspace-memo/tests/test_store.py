from __future__ import annotations

import os
import sys
import tempfile
import unittest
from pathlib import Path

sys.path.insert(0, str(Path(__file__).parents[1] / "src"))

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


if __name__ == "__main__":
    unittest.main()
