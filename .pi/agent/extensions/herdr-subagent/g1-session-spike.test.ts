import { test, expect } from "bun:test";
import { lstat, realpath, stat } from "node:fs/promises";
import { homedir } from "node:os";
import { join } from "node:path";

type Entry = { id: string; parentId: string | null; type: string; message?: { role?: string; content?: unknown; stopReason?: string } };
type SessionHeader = { type: "session"; id: string };
type State = { at: number; state: string };
type SessionIdentity = { source: "herdr:pi"; kind: "path"; value: string };
type Agent = { pane_id: string; agent_status: string; agent_session?: { source?: string; kind?: string; value?: string } };
type Snapshot = { result: { snapshot: { panes: { pane_id: string }[]; agents: Agent[] } } };
type ProcessInfo = { result: { process_info: { foreground_processes: { argv?: string[]; name?: string; pid: number }[] } } };

const live = process.env.HERDR_G1_LIVE === "1";
const runMarker = `G1_NATIVE_MARKER_${crypto.randomUUID()}`;
const sessionRoot = join(homedir(), ".pi", "agent", "sessions");
const fixtureSession = join(import.meta.dir, "test-fixtures/sessions/g1-live-redacted.jsonl");
const fixtureHerdr = join(import.meta.dir, "test-fixtures/herdr/g1-live-redacted.json");

async function herdr(args: string[]) {
  const child = Bun.spawn(["herdr", ...args], { stdout: "pipe", stderr: "pipe" });
  const [stdout, stderr, code] = await Promise.all([new Response(child.stdout).text(), new Response(child.stderr).text(), child.exited]);
  if (code !== 0) throw new Error(`herdr ${args[0]} failed (${code}): ${stderr.trim()}`);
  return stdout.trim() ? JSON.parse(stdout) : undefined;
}

function text(content: unknown): string {
  if (typeof content === "string") return content;
  if (!Array.isArray(content)) return "";
  return content.filter((x): x is { type: string; text: string } => typeof x === "object" && x !== null && (x as { type?: unknown }).type === "text" && typeof (x as { text?: unknown }).text === "string").map(x => x.text).join("");
}

function descendant(entry: Entry, ancestorId: string, byId: Map<string, Entry>) {
  for (let id = entry.parentId; id; id = byId.get(id)?.parentId ?? null) if (id === ancestorId) return true;
  return false;
}

type Harvest = { pending: true } | { pending: false; sessionId: string; anchor: Entry; final: Entry; finalText: string; stopReason: string | undefined };

function harvestTurn(session: string, marker: string): Harvest {
  const lines = session.split("\n");
  if (lines.at(-1) !== "") lines.pop(); // A non-newline-terminated JSONL record is still being written.
  const entries = lines.filter(Boolean).map(line => JSON.parse(line) as (Entry | SessionHeader));
  const headers = entries.filter((entry): entry is SessionHeader => entry.type === "session" && typeof (entry as SessionHeader).id === "string");
  expect(headers).toHaveLength(1);
  const sessionId = headers[0]!.id;
  const messages = entries.filter((entry): entry is Entry => entry.type === "message");
  const anchors = messages.filter(e => e.message?.role === "user" && text(e.message.content).includes(marker));
  if (anchors.length === 0) return { pending: true };
  expect(anchors).toHaveLength(1);
  const anchor = anchors[0]!;
  const anchorIndex = messages.indexOf(anchor);
  const nextUser = messages.findIndex((e, i) => i > anchorIndex && e.message?.role === "user");
  const byId = new Map(messages.map(entry => [entry.id, entry]));
  const candidates = messages.slice(anchorIndex + 1, nextUser < 0 ? undefined : nextUser).filter(e => e.message?.role === "assistant" && e.message.stopReason !== "toolUse" && descendant(e, anchor.id, byId));
  const final = candidates.at(-1);
  if (!final) return { pending: true };
  return { pending: false, sessionId, anchor, final, finalText: text(final.message?.content), stopReason: final.message?.stopReason };
}

function followUpLifecycle(states: State[]) {
  const firstDone = states.findIndex(item => item.state === "done");
  const working = states.findIndex((item, i) => i > firstDone && item.state === "working");
  const settled = states.findIndex((item, i) => i > working && (item.state === "done" || item.state === "idle"));
  return firstDone >= 0 && working >= 0 && settled >= 0;
}

function sameIdentity(agent: Agent | undefined, identity: SessionIdentity) {
  return agent?.agent_session?.source === identity.source && agent.agent_session.kind === identity.kind && agent.agent_session.value === identity.value;
}

function piForegroundLive(processInfo: ProcessInfo) {
  return processInfo.result.process_info.foreground_processes.some(process => {
    const pi = process.name === "pi" || process.argv?.[0] === "pi";
    try { globalThis.process.kill(process.pid, 0); return pi; } catch { return false; }
  });
}

async function diagnostics(paneId: string, sessionPath: string | undefined) {
  const [snapshot, process] = await Promise.all([
    herdr(["api", "snapshot"]).catch(error => ({ error: String(error) })),
    herdr(["pane", "process-info", "--pane", paneId]).catch(error => ({ error: String(error) })),
  ]);
  return { paneId, sessionPath: sessionPath ? "<redacted>" : undefined, snapshot, process };
}

test("G1 structural fixtures parse distinct turns; partial final JSONL remains pending", async () => {
  const [session, herdrFixture] = await Promise.all([Bun.file(fixtureSession).text(), Bun.file(fixtureHerdr).json()]);
  const first = harvestTurn(session, "G1_FIXTURE_TURN_ONE");
  const second = harvestTurn(session, "G1_FIXTURE_TURN_TWO");
  expect(first.pending).toBe(false);
  expect(second.pending).toBe(false);
  if (first.pending || second.pending) throw new Error("fixture finals unexpectedly pending");
  expect(first.anchor.id).not.toBe(second.anchor.id);
  expect(first.final.id).not.toBe(second.final.id);
  expect(first.sessionId).toBe(second.sessionId);
  expect(first.stopReason).toBe("stop");
  expect(second.stopReason).toBe("stop");
  const partialFinal = `${session.slice(0, session.lastIndexOf(`{"type":"message","id":"${second.final.id}"`))}{"type":"message"`;
  expect(harvestTurn(partialFinal, "G1_FIXTURE_TURN_TWO").pending).toBe(true);
  expect(followUpLifecycle(herdrFixture.turns[1].states)).toBe(true);
  expect(herdrFixture.note).toContain("Live-redacted");
});

test.skipIf(!live)("G1: native Pi retained session correlates two interactive Herdr turns", async () => {
  const startedAt = Date.now();
  const snapshot = await herdr(["api", "snapshot"]);
  const caller = snapshot.result.snapshot.panes.find((pane: { pane_id: string }) => pane.pane_id === process.env.HERDR_PANE_ID);
  expect(caller).toBeDefined();
  const workspaceId = caller.workspace_id as string;
  const label = `G1 disposable ${runMarker.slice(-8)}`;
  const firstMarker = `${runMarker}_TURN_ONE`;
  const secondMarker = `${runMarker}_TURN_TWO`;
  const firstTask = `${firstMarker} Reply with short acknowledgement one. Do not use tools.`;
  const secondTask = `${secondMarker} Reply with short acknowledgement two. Do not use tools.`;
  expect(firstTask.includes("\n")).toBe(false);
  expect(secondTask.includes("\n")).toBe(false);
  let tabId: string | undefined;
  let bootstrapPaneId: string | undefined;
  let childPaneId: string | undefined;
  let sessionPath: string | undefined;
  let sessionRefAt: number | undefined;
  let sessionIdentity: SessionIdentity | undefined;
  try {
    const created = await herdr(["tab", "create", "--workspace", workspaceId, "--cwd", "/tmp", "--label", label, "--no-focus"]);
    tabId = created.result.tab.tab_id;
    bootstrapPaneId = created.result.root_pane.pane_id;
    const launched = await herdr(["agent", "start", "g1-native", "--cwd", "/tmp", "--tab", tabId, "--no-focus", "--", "pi", "--name", label]);
    childPaneId = launched.result.agent.pane_id;

    const startupStates: State[] = [];
    const record = (states: State[], state: string) => { if (states.at(-1)?.state !== state) states.push({ at: Date.now(), state }); };
    const readyDeadline = Date.now() + 30_000;
    while (Date.now() < readyDeadline) {
      const poll = await herdr(["api", "snapshot"]);
      const agent = poll.result.snapshot.agents.find((item: Agent) => item.pane_id === childPaneId);
      if (agent) record(startupStates, agent.agent_status);
      const ref = agent?.agent_session;
      if (agent?.agent_status === "idle" && ref?.source === "herdr:pi" && ref.kind === "path" && typeof ref.value === "string") {
        sessionPath = ref.value;
        sessionIdentity = { source: "herdr:pi", kind: "path", value: ref.value };
        sessionRefAt = Date.now();
        break;
      }
      await Bun.sleep(50);
    }
    expect(sessionPath).toBeDefined();
    expect(sessionIdentity).toBeDefined();
    expect(sessionPath!.startsWith(`${sessionRoot}/`)).toBe(true);
    let baselineAbsentAt: number | undefined;
    try { await lstat(sessionPath!); }
    catch (error) {
      if (!(error instanceof Error) || !("code" in error) || error.code !== "ENOENT") throw error;
      baselineAbsentAt = Date.now();
    }
    expect(baselineAbsentAt).toBeDefined();

    const submitTurn = async (task: string) => {
      expect(task.includes("\n")).toBe(false);
      const sentAt = Date.now();
      let enters = 0;
      await herdr(["agent", "send", childPaneId!, task]);
      await herdr(["pane", "send-keys", childPaneId!, "enter"]); enters++;
      expect(enters).toBe(1);
      return sentAt;
    };

    const firstSentAt = await submitTurn(firstTask);
    let fileInfo: Awaited<ReturnType<typeof lstat>> | undefined;
    let materializedAt: number | undefined;
    const fileDeadline = Date.now() + 30_000;
    while (Date.now() < fileDeadline) {
      try { fileInfo = await lstat(sessionPath!); materializedAt = Date.now(); break; }
      catch (error) { if (!(error instanceof Error) || !("code" in error) || error.code !== "ENOENT") throw error; }
      await Bun.sleep(50);
    }
    if (!fileInfo) throw new Error(JSON.stringify({ g1: "unproven_session_materialization", startupStates, baselineAbsentAt, sessionRefAfterStartupMs: sessionRefAt! - startedAt, diagnostics: await diagnostics(childPaneId!, sessionPath) }));
    expect(fileInfo.isSymbolicLink()).toBe(false);
    expect(fileInfo.isFile()).toBe(true);
    const canonical = await realpath(sessionPath!);
    expect(canonical.startsWith(`${sessionRoot}/`)).toBe(true);
    expect((await stat(canonical)).uid).toBe(process.getuid?.());

    const retainedEvidence = async (snapshot: Snapshot, agent: Agent | undefined) => {
      expect(snapshot.result.snapshot.panes.some(pane => pane.pane_id === childPaneId)).toBe(true);
      expect(sameIdentity(agent, sessionIdentity!)).toBe(true);
      const processInfo = await herdr(["pane", "process-info", "--pane", childPaneId!]) as ProcessInfo;
      expect(piForegroundLive(processInfo)).toBe(true);
    };

    const awaitFirstDone = async () => {
      const states: State[] = [];
      let result: Exclude<Harvest, { pending: true }> | undefined;
      let finalAt: number | undefined;
      let lastParseError: string | undefined;
      const deadline = Date.now() + 30_000;
      while (Date.now() < deadline) {
        const poll = await herdr(["api", "snapshot"]) as Snapshot;
        const agent = poll.result.snapshot.agents.find(item => item.pane_id === childPaneId);
        if (agent) record(states, agent.agent_status);
        try {
          const harvested = harvestTurn(await Bun.file(canonical).text(), firstMarker);
          if (!harvested.pending) { result = harvested; finalAt ??= Date.now(); }
        } catch (error) { lastParseError = error instanceof Error ? error.message : String(error); }
        if (result && agent?.agent_status === "done") {
          await retainedEvidence(poll, agent);
          expect(result.finalText.trim().length).toBeGreaterThan(0);
          expect(result.stopReason).toBe("stop");
          return { ...result, states, sentAt: firstSentAt, finalAt: finalAt!, settledAt: Date.now(), settledState: "done" as const };
        }
        await Bun.sleep(50);
      }
      throw new Error(JSON.stringify({ g1: "unproven_first_done", states, finalEntryId: result?.final.id, lastParseError, sessionTiming: { baselineAbsentAt, materializedAt, firstSentAt }, diagnostics: await diagnostics(childPaneId!, sessionPath) }));
    };

    const awaitFollowUp = async (sentAt: number, first: Awaited<ReturnType<typeof awaitFirstDone>>) => {
      const states: State[] = [{ at: first.settledAt, state: first.settledState }];
      let result: Exclude<Harvest, { pending: true }> | undefined;
      let finalAt: number | undefined;
      let lastParseError: string | undefined;
      const deadline = Date.now() + 30_000;
      while (Date.now() < deadline) {
        const poll = await herdr(["api", "snapshot"]) as Snapshot;
        const agent = poll.result.snapshot.agents.find(item => item.pane_id === childPaneId);
        if (agent) record(states, agent.agent_status);
        try {
          const harvested = harvestTurn(await Bun.file(canonical).text(), secondMarker);
          if (!harvested.pending) { result = harvested; finalAt ??= Date.now(); }
        } catch (error) { lastParseError = error instanceof Error ? error.message : String(error); }
        if (result && followUpLifecycle(states)) {
          await retainedEvidence(poll, agent);
          expect(result.sessionId).toBe(first.sessionId);
          expect(result.finalText.trim().length).toBeGreaterThan(0);
          expect(result.stopReason).toBe("stop");
          return { ...result, states, sentAt, finalAt: finalAt!, settledAt: states.at(-1)!.at };
        }
        await Bun.sleep(50);
      }
      throw new Error(JSON.stringify({ g1: "unproven_follow_up", states, finalEntryId: result?.final.id, lastParseError, sessionTiming: { baselineAbsentAt, materializedAt, firstSentAt }, diagnostics: await diagnostics(childPaneId!, sessionPath) }));
    };

    const first = await awaitFirstDone();
    const secondSentAt = await submitTurn(secondTask);
    const second = await awaitFollowUp(secondSentAt, first);
    expect(first.anchor.id).not.toBe(second.anchor.id);
    expect(first.final.id).not.toBe(second.final.id);
    expect(first.sessionId).toBe(second.sessionId);
    console.log(JSON.stringify({ g1: "pass", tabId, paneId: childPaneId, session: "<redacted>", sessionId: "<redacted>", startupStates, turns: [first, second].map(turn => ({ marker: "<redacted>", anchorEntryId: turn.anchor.id, finalEntryId: turn.final.id, stopReason: turn.stopReason, states: turn.states, ms: { finalAfterSend: turn.finalAt - turn.sentAt, settledAfterSend: turn.settledAt - turn.sentAt } })), ms: { startup: first.sentAt - startedAt } }));
  } finally {
    if (childPaneId) await herdr(["pane", "close", childPaneId]).catch(() => undefined);
    if (bootstrapPaneId) await herdr(["pane", "close", bootstrapPaneId]).catch(() => undefined);
    if (tabId) {
      const after = await herdr(["api", "snapshot"]);
      expect(after.result.snapshot.panes.some((pane: { pane_id: string }) => pane.pane_id === childPaneId || pane.pane_id === bootstrapPaneId)).toBe(false);
      expect(after.result.snapshot.tabs.some((tab: { tab_id: string }) => tab.tab_id === tabId)).toBe(false);
    }
  }
}, 130_000);
