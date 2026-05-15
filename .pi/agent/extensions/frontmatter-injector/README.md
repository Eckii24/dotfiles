# Frontmatter Injector

Scans configured directories for Markdown files with a `description` field in their YAML frontmatter and injects a compact reference list into the agent's context window.

This gives the agent awareness of curated reference files (knowledge bases, runbooks, architecture docs, etc.) without loading their full contents into every turn.

---

## How it works

### 1. Configuration

The extension reads source directories from `settings.json` under the `frontmatterInjector` key:

```jsonc
// ~/.pi/agent/settings.json  (global scope)
{
  "frontmatterInjector": {
    "paths": ["~/.agents/references"]
  }
}

// <project-root>/.pi/settings.json  (project scope)
{
  "frontmatterInjector": {
    "paths": [".ai/references"]
  }
}
```

- **Global paths** are resolved relative to the filesystem root (absolute) or the agent directory.
- **Project paths** are resolved relative to the session's working directory.
- Both scopes are merged; global sources come first.

### 2. Scanning

For each configured directory the extension:

1. Recursively collects all `.md` / `.markdown` files (excluding `INJECT.md` template files).
2. Parses the YAML frontmatter of each file.
3. Keeps only files that have a non-empty `description` frontmatter field.
4. Deduplicates files across overlapping source directories (first-configured wins).

### 3. Rendering sections

Each source directory becomes a section in the injected block. The section content is built in one of two ways:

- **With an `INJECT.md` template**: If the source directory contains an `INJECT.md` file with a `{{frontmatter_injector_entries}}` placeholder, the rendered entry list replaces that placeholder.
- **Without a template**: A default `## <directory-name>` heading is used, followed by the entry list.

Each entry is rendered as:

```
- <display-path> — <description>
```

### 4. Context injection

The combined sections are wrapped into a custom message block:

```
Memory · frontmatter refs · N refs
Treat frontmatter refs as hints; validate live workspace facts before relying on them.

## my-references

- .ai/references/architecture.md — High-level service architecture overview.
- .ai/references/deploy-runbook.md — Step-by-step production deployment checklist.
```

This block is:

- Sent as a visible custom message on `session_start`.
- Injected (hidden) into every agent turn via `before_agent_start`.
- Deduplicated in the context window — only the latest version (by content hash) is kept.

---

## Frontmatter format

Source Markdown files need a YAML frontmatter block with at least a `description` field:

```markdown
---
description: "High-level service architecture overview."
---

# Architecture

...
```

Files without a `description` field are silently skipped.

---

## Custom templates with `INJECT.md`

Place an `INJECT.md` file in a source directory to control the injected output for that section. Use the `{{frontmatter_injector_entries}}` placeholder where the generated entry list should appear:

```markdown
## Project References

The following reference documents are available. Read them when you need deeper context.

{{frontmatter_injector_entries}}

Use the `read` tool to load any of these files when needed.
```

If the placeholder is missing, the extension appends the entries to the end of the template and logs a warning.

---

## Overlap detection

If two configured source directories overlap (one is a subdirectory of the other, or they resolve to the same path), the extension:

- Logs a warning.
- Deduplicates individual files so each file appears at most once (first-configured directory wins).

---

## Warnings

Warnings are shown as UI notifications (or printed to stderr in non-UI mode):

- Configured absolute folder does not exist.
- Configured path is not a directory.
- Overlapping source directories detected.
- `INJECT.md` template missing the `{{frontmatter_injector_entries}}` placeholder.

---

## Source files

| File | Purpose |
|------|---------|
| `index.ts` | Extension entry point — lifecycle hooks, custom message rendering, context deduplication |
| `config.ts` | Reads `frontmatterInjector.paths` from global and project `settings.json` |
| `scan.ts` | Directory scanning, frontmatter parsing, template rendering, injection building |
| `contracts.ts` | Shared types and the content-hash helper |
