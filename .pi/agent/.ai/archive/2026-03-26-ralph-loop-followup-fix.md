# Ralph loop follow-up delivery fix

## Goal
Fix the Ralph loop extension so extension-injected messages do not fail with `Agent is already processing` when a turn is still active.

## Plan
- Confirm the Pi extension API for queued message delivery.
- Update Ralph loop message sends to use `deliverAs: "followUp"`.
- Sanity-check the extension import after the change.

## Progress
- [x] Read Pi extension docs and examples for `pi.sendUserMessage()` / `pi.sendMessage()` queueing.
- [x] Patch `extensions/ralph-loop.ts`.
- [x] Sanity-check the updated extension.

## Result
- Updated both Ralph loop message injection paths to use follow-up delivery.
- The extension now queues loop prompts safely if the agent is still processing, instead of throwing `Agent is already processing`.
- Sanity check passed via `bun` import of `extensions/ralph-loop.ts`.

## Notes
- Pi extension APIs use `deliverAs`, not SDK `streamingBehavior`.
- For extension-triggered messages during streaming, `deliverAs: "followUp"` waits until the agent is fully idle before delivering the next message.
- Assumption: using `deliverAs: "followUp"` even when idle preserves normal immediate delivery, matching the documented extension behavior.
