---
name: p0-repo-context
description: Locate and inspect other P0-owned repositories already cloned under the REPO_PATH directory when a dependency, package, service, or internal library name points outside the current repo. Use when the current repo references an internal P0 dependency and the answer likely lives in its source. Do not use for repos not present under REPO_PATH (ask the user to fetch it), for the current repo itself, or for public/third-party packages.
---

# P0 Repo Context

All P0-owned repositories that are locally available live as sibling folders directly under the path in the `REPO_PATH` environment variable. There is no repo CLI, index, or cloning step — just plain folders on disk.

## Workflow

1. Confirm `REPO_PATH` is set (`echo $REPO_PATH`). If unset or the directory doesn't exist, tell the user and stop.
2. List candidates: `ls "$REPO_PATH"`. Derive 1-2 likely folder name(s) from the dependency/package/service name (e.g. `Company.Payments.Core` → look for `payments` in the listing).
3. If exactly one clear match exists, inspect it directly (`read`, `grep`, `find` scoped to that folder).
4. If multiple plausible matches exist, ask the user which one before inspecting.
5. If no folder under `REPO_PATH` matches, **stop and tell the user**: report the dependency name and that no matching repo was found locally, and ask them to fetch/clone it themselves. Do not attempt to search Azure DevOps, run any repo/`az` tooling, or clone anything — this skill is read-only against what's already local.

## Inspecting a matched repo

Prefer a focused read over a shallow scan:

- `README*`
- package manifests / dependency files
- main entry points
- docs on ownership, API, or architecture

## Reporting

Include: matched folder name and path under `REPO_PATH`, exact files inspected, and the answer with evidence. If you asked the user to fetch a missing repo, say so explicitly instead of guessing from the dependency name alone.
