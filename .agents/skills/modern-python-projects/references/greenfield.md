# Greenfield initialization

Concrete checklist for a new state-of-the-art Python project.

## 1. Determine inputs

Resolve:

- project shape: script, library, or packaged application
- distribution name
- import name
- destination path
- current stable Python version

Use `uv python list` and `uv init --help` rather than copying a version or flags from an older project.

## 2. Initialize

```bash
# Library
uv init --lib --python <current-stable-version> <project-directory>

# Packaged CLI, API, worker, daemon, or other application
uv init --app --package --python <current-stable-version> <project-directory>

# One-file automation
uv init --script <script.py>
```

Use `--name <distribution-name>` when the directory name differs from the distribution name.

For a package, verify that generation produced:

- `.python-version`
- `pyproject.toml`
- `uv_build` under `[build-system]`
- `src/<import_name>/`
- README

Replace generated placeholder metadata immediately.

## 3. Add tools and dependencies

```bash
uv add --dev ruff ty pytest
uv add <runtime-dependency>
```

Run one `uv add` command with all known runtime dependencies or repeat it as dependencies become necessary. Never edit `uv.lock` manually.

## 4. Minimum package structure

```text
project/
├── .python-version
├── pyproject.toml
├── README.md
├── uv.lock
├── src/
│   └── import_name/
│       ├── __init__.py
│       └── py.typed          # typed libraries only
└── tests/
    └── test_smoke.py
```

For a CLI, use an explicit entry point:

```toml
[project.scripts]
my-command = "import_name.main:main"
```

Keep `__init__.py` small. Put implementation in modules named after their responsibility. Do not start with `utils.py`, `helpers.py`, or speculative architecture layers.

## 5. Baseline pyproject configuration

Set Ruff’s target to the selected Python version. Example for Python 3.14:

```toml
[tool.ruff]
line-length = 100
target-version = "py314"

[tool.ruff.lint]
select = ["E4", "E7", "E9", "F", "I", "UP", "B", "SIM"]

[tool.pytest.ini_options]
addopts = ["--strict-config", "--strict-markers"]
testpaths = ["tests"]
xfail_strict = true
```

Do not add a `[tool.ty]` section unless source code creates a concrete need.

## 6. First meaningful test

Test the artifact’s real interface:

- library: import and call one public API
- CLI: invoke `--help` and one deterministic command path
- API/service: import or create the app and exercise a health path
- worker: process one deterministic sample
- script: run representative input and assert output or exit status

Run tests through `uv` so they use the installed project environment.

## 7. README

Document:

1. purpose
2. current Python prerequisite
3. `uv` prerequisite
4. setup: `uv sync`
5. run/use example
6. canonical quality commands
7. `uv build` for package projects

Only document commands that execute successfully.

## 8. CI

Use the repository’s CI platform and its maintained `uv` integration. Execute:

```bash
uv sync --locked
uv run ruff check .
uv run ruff format --check .
uv run ty check
uv run pytest
uv build
```

Omit `uv build` only for standalone scripts.

## 9. Final verification

```bash
uv lock --check
uv sync --locked
uv run ruff check .
uv run ruff format --check .
uv run ty check
uv run pytest
uv build
```

Then run the artifact exactly as a user would. Confirm that version-control status contains no virtual environment, caches, credentials, or build output.
