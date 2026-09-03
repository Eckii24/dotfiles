# Workspace Memo for Herdr

A free Markdown memo is bound to each Herdr workspace ID.

## Use

- `Ctrl+y`, then `m`: open the memo as an overlay for the current workspace.
- Edit freely in `$EDITOR`; default is `vi`.
- Exit the editor to close the overlay.
- A `✎` marker appears in the workspace sidebar only when the memo is non-empty.

## Lifecycle

- Memos live in the Herdr-managed plugin state directory, not in this source tree.
- A normal Herdr restart restores the same workspace IDs and the plugin startup hook restores sidebar markers.
- `workspace.closed` removes that workspace's memo. The startup hook also prunes stale memo files left by a missed event.
- Workspace names are not identifiers. Rename does not affect its memo.

## Development

```sh
python3 -m unittest discover -s tests -v
```
