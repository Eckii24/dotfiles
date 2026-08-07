# Pi local usage analytics

Local reporting over `~/.pi/agent/sessions/**/*.jsonl`. It reads persisted metadata and usage counters; it does not send data anywhere and does not export prompt, response or tool content.

## Commands

```bash
# Current local calendar month: compact model overview
pi --usage

# Time selectors
pi --usage --period 2026-07
pi --usage --from 2026-07-01 --to 2026-07-31
pi --usage --last 30d

# Outer -> inner hierarchy
pi --usage --group-by session,agent,model --period 2026-07
pi --usage --group-by model,session,agent --last 30d
pi --usage --group-by project,workflow,model --period 2026-07

# Output formats
pi --usage --group-by session,agent,model --format json --period 2026-07
pi --usage --group-by model --format csv --period 2026-07

# Filter unusual session costs
pi --usage --anomalies --group-by project,session --period 2026-07
pi --usage=help
```

## Group dimensions

`day`, `model`, `session`, `project`, `workflow`, `agent`.

`agent` is `main` or `subagent`. Normal reports aggregate both. Put it into the grouping path only when the split matters.

Session titles are Pi-native: `pi --name "Title"` at startup or `/name Title` interactively. Analytics reads the latest persisted native name; unnamed sessions fall back to the full session ID. Every tabular text/CSV report keeps this data-column order: Sessions, Turns, Input, C.Read, C.Write, Output, Reason, Cost, Cache.

## Metrics and limits

Input, cache read, cache write, output, reasoning, total tokens, Pi-recorded cost, assistant turns and technical tool-error signals are available in aggregate output. Costs are estimates, not provider invoice reconciliation. Date filtering uses message timestamps, not file mtimes. Current Herdr child messages are recursively included once; old legacy payload shapes are intentionally unsupported.

JSON is content-safe aggregate metadata/metrics. CSV permits exactly one grouping level so it stays a flat table.
