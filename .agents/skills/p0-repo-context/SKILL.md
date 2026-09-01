---
name: p0-repo-context
description: Mandatory first step for inspecting any dependency, package, service, or internal library that belongs to P0 but lives outside the current repository, locate and read its source in a sibling repo already cloned under REPO_PATH. Do not use ILSpy, decompile DLLs, inspect generated binaries, or infer the implementation from package artifacts instead of checking the local source repo. If the P0 repo is not present under REPO_PATH, stop and ask the user to fetch it. Do not use for the current repo or public/third-party packages.
---

# P0 Repo Context

Use this skill **before** inspecting a P0-owned external dependency through any other mechanism. The local source repository is authoritative. Do not use ILSpy, dnSpy, decompilers, reflection, generated DLLs, NuGet/package contents, or other binary artifacts as a substitute for locating and reading the source repo. If the source repo cannot be found locally, stop and report that fact; do not fall back to decompilation or guesswork.

All P0-owned repositories that are locally available live as sibling folders directly under the path in the `REPO_PATH` environment variable. There is no repo CLI, index, or cloning step — just plain folders on disk.

## Workflow

1. Confirm `REPO_PATH` is set (`echo $REPO_PATH`). If unset or the directory doesn't exist, tell the user and stop. Do not inspect binaries as a fallback.
2. List candidates: `ls "$REPO_PATH"`. Derive 1-2 likely folder name(s) from the dependency/package/service name (e.g. `Company.Payments.Core` → look for `payments` in the listing).
3. If exactly one clear match exists, inspect it directly (`read`, `grep`, `find` scoped to that folder). Read source files, project files, and documentation; do not open or decompile DLLs/package artifacts to answer the question.
4. If multiple plausible matches exist, ask the user which one before inspecting.
5. If no folder under `REPO_PATH` matches, **stop and tell the user**: report the dependency name and that no matching repo was found locally, and ask them to fetch/clone it themselves. Do not attempt to search Azure DevOps, run any repo/`az` tooling, clone anything, or use ILSpy/decompilation as a fallback — this skill is read-only against what's already local.

## Inspecting a matched repo

Prefer a focused read over a shallow scan:

- `README*`
- package manifests / dependency files
- main entry points
- docs on ownership, API, or architecture

## Reporting

Include: matched folder name and path under `REPO_PATH`, exact files inspected, and the answer with evidence. If you asked the user to fetch a missing repo, say so explicitly instead of guessing from the dependency name alone.
