---
name: p0-repo-context
description: Inspect related P0-owned repositories when dependency names, NuGet/package references, service names, or an explicit user request suggest another repo contains the answer. Use this whenever code in one repository points at a sibling/internal repo under your responsibility, even if the user does not explicitly ask to "check another repository." Resolve the repo via the repo CLI, ensure it is available locally, inspect the source directly, and cite exact repository and file paths in the answer.
compatibility:
  tools: bash, read
---

# P0 Repo Context

Use this skill when the best answer probably lives in a related repository, not the repo currently open in front of you.

The goal is to get ground truth from source instead of guessing from dependency names alone.

## What this skill should do

- Identify the most likely related repository from dependency or service context.
- Use the repo CLI in non-interactive mode to locate or clone that repository.
- Inspect the target repository read-only unless the user explicitly asks for code changes there.
- Report what you found with exact repo paths and file paths.

## Important command

The repo CLI is implemented here:

`/Users/matthias.eck/.config/zsh/functions/repo.zsh`

Invoke it like this:

```bash
zsh -lc 'source ~/.config/zsh/functions/repo.zsh && repo --help'
```

For agent-friendly usage, prefer these non-interactive forms:

```bash
zsh -lc 'source ~/.config/zsh/functions/repo.zsh && repo --search "keyword"'
zsh -lc 'source ~/.config/zsh/functions/repo.zsh && repo --name "exact-repo-name" --path'
```

Do **not** rely on the interactive picker.

## When to use this skill

Use this skill when any of the following are true:

- A repository under `REPO_PATH` references another internal dependency and the answer likely lives in that dependency's source.
- You see a NuGet dependency, package name, internal library name, service name, deployment repo name, or ownership hint that appears to map to another P0-owned repository.
- The user asks questions like:
  - "What does this dependency do?"
  - "Can you check the repo behind this package?"
  - "Where is this internal library implemented?"
  - "Can you inspect the related repo and tell me how it works?"
- The user gives you an explicit local repository path and wants you to inspect it directly.

## Workflow

### 1. Resolve whether the target repo is explicit or inferred

Start with the strongest signal available:

- If the user gives an explicit local repo path, inspect that path directly.
- If the user gives an exact repo name, use it.
- Otherwise derive 1-3 search keywords from the dependency or service name.

Good sources for candidate names:

- `.csproj`, `Directory.Packages.props`, `packages.lock.json`, `NuGet.config`
- `package.json`, lockfiles, workspace files
- README references
- CI/CD config, deployment config, Helm charts, Dockerfiles
- import namespaces, internal URLs, repo naming conventions

### 2. Search conservatively

Use the repo CLI before falling back to broad filesystem guessing.

Preferred sequence:

1. Search with the most likely keyword:

```bash
zsh -lc 'source ~/.config/zsh/functions/repo.zsh && repo --search "<keyword>"'
```

2. If needed, try one or two refined keywords.
3. Use `repo --list` only if search is not enough and you truly need the full candidate set.

### 3. Handle ambiguity safely

If there is exactly one clear candidate, continue.

If there are multiple plausible repositories, **ask the user before choosing**. Do not silently inspect the wrong repository just because the names are similar.

### 4. Ensure the repo is available locally

Once you have the exact repo name, get its local path like this:

```bash
zsh -lc 'source ~/.config/zsh/functions/repo.zsh && repo --name "<exact-repo-name>" --path'
```

This should clone the repo if needed and return the local filesystem path.

If the user explicitly pointed you to a local repo outside the normal repo path, skip the repo CLI and inspect that path directly.

### 5. Inspect the repository read-only

After resolving the path:

- Use `bash` to list likely files and narrow the search.
- Use `read` to inspect the most relevant files.
- Start with high-signal files such as:
  - `README*`
  - package manifests and dependency declarations
  - main project files
  - entry points
  - configuration files
  - docs that explain ownership, APIs, or architecture

Prefer a focused read of the most relevant files over a shallow scan of everything.

### 6. Report with evidence

In your response, include:

- the resolved repository name
- the local repo path
- the specific files you inspected
- the answer to the user's question
- any ambiguity or confidence caveats

Example response shape:

```md
I inspected `example-service` at `<resolved-repo-path>`.

Files checked:
- `README.md`
- `src/ExampleService/Program.cs`
- `src/ExampleService/DependencyRegistration.cs`

Finding:
- The dependency is responsible for ...
- The relevant implementation entry point is ...
```

## Guardrails

- Do not use the interactive picker.
- Do not assume a dependency name is automatically the repo name without checking.
- Ask before choosing when multiple repo matches are plausible.
- Prefer read-only inspection unless the user explicitly asks for changes in the related repo.
- If the repo CLI fails because environment variables, Azure auth, or cache state are missing, say exactly what failed and what command you used.

## Assumptions

This skill assumes the environment is already configured for the repo CLI, especially:

- `REPO_PATH`
- `AZURE_DEVOPS_ORG_URL`
- `AZURE_DEVOPS_DEFAULT_PROJECT`

If those are missing, surface that clearly instead of guessing.

## Examples

**Example 1**  
User: "This repo depends on `Company.Payments.Core`. Can you inspect the source repo and tell me where retries are configured?"

What to do:
- search for likely repo names from `Company.Payments.Core`
- resolve the exact repo
- get its local path
- inspect the retry-related code and config
- answer with file paths

**Example 2**  
User: "Please check the repo behind this internal dependency and explain what API it exposes."

What to do:
- identify the dependency name from the current repo
- resolve the related repo via the repo CLI
- inspect the API surface in source and docs
- answer with evidence

**Example 3**  
User: "Look at `~/Development/Repos/shared-auth-lib` and tell me how token validation works."

What to do:
- skip repo discovery
- inspect that local repo directly
- summarize the token validation flow with exact file references
