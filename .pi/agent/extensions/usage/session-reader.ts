import { readdir, readFile } from "node:fs/promises";
import { join } from "node:path";

export type AgentKind = "main" | "subagent";
export interface UsageEvent {
	sessionId: string; sessionTitle?: string; sessionPath: string; timestampMs: number; project: string; workflow: string;
	provider: string; model: string; input: number; cacheRead: number; cacheWrite: number; output: number; reasoning: number; totalTokens: number; cost: number;
	agentKind: AgentKind; agentName: string; subagentDepth: number;
}
export interface ToolEvent { sessionId: string; timestampMs: number; isError: boolean; toolName: string; agentKind: AgentKind; subagentDepth: number }
export interface ReadUsageResult { events: UsageEvent[]; toolEvents: ToolEvent[]; scannedFiles: number; parseErrors: number; readErrors: number }

type RecordValue = Record<string, unknown>;
function record(value: unknown): value is RecordValue { return Boolean(value) && typeof value === "object" && !Array.isArray(value); }
function number(value: unknown): number { return typeof value === "number" && Number.isFinite(value) ? value : 0; }
function timestamp(value: unknown): number | undefined { const parsed = typeof value === "number" ? value : typeof value === "string" ? Date.parse(value) : NaN; return Number.isFinite(parsed) ? parsed : undefined; }
function text(value: unknown): string { return typeof value === "string" ? value : Array.isArray(value) ? value.map((part) => record(part) && typeof part.text === "string" ? part.text : "").join(" ") : ""; }
function workflowFromUser(value: string): string { return /^\s*\/(wayfinder|spec|spec-to-plan|implement|implement-review|review)(?:\s|$)/.exec(value)?.[1] ?? "ad-hoc"; }
async function jsonlFiles(root: string): Promise<string[]> { const files: string[] = []; async function walk(dir: string): Promise<void> { let entries; try { entries = await readdir(dir, { withFileTypes: true }); } catch { return; } for (const entry of entries) { const path = join(dir, entry.name); if (entry.isDirectory()) await walk(path); else if (entry.isFile() && entry.name.endsWith(".jsonl")) files.push(path); } } await walk(root); return files; }

export async function readSessionUsage(root: string): Promise<ReadUsageResult> {
	const events: UsageEvent[] = []; const toolEvents: ToolEvent[] = []; let parseErrors = 0; let readErrors = 0; const files = await jsonlFiles(root);
	for (const sessionPath of files) {
		let content: string; try { content = await readFile(sessionPath, "utf8"); } catch { readErrors++; continue; }
		let sessionId = sessionPath; let sessionTitle: string | undefined; let project = "unknown"; const messages: Array<{ message: RecordValue; timestampMs?: number }> = [];
		for (const raw of content.split("\n")) { if (!raw.trim()) continue; let entry: unknown; try { entry = JSON.parse(raw); } catch { parseErrors++; continue; } if (!record(entry)) continue; if (entry.type === "session") { if (typeof entry.id === "string") sessionId = entry.id; if (typeof entry.cwd === "string" && entry.cwd) project = entry.cwd; } else if (entry.type === "session_info" && typeof entry.name === "string") sessionTitle = entry.name.trim() || undefined; else if (entry.type === "message" && record(entry.message)) messages.push({ message: entry.message, timestampMs: timestamp(entry.timestamp) }); }
		let workflow = "ad-hoc"; for (const entry of messages) if (entry.message.role === "user") { const classified = workflowFromUser(text(entry.message.content)); if (classified !== "ad-hoc") { workflow = classified; break; } }
		const visit = (message: RecordValue, fallbackTimestampMs: number | undefined, agentKind: AgentKind, agentName: string, subagentDepth: number): void => {
			const at = timestamp(message.timestamp) ?? fallbackTimestampMs; if (at === undefined) return;
			if (message.role === "assistant" && record(message.usage)) { const usage = message.usage; const cost = record(usage.cost) ? number(usage.cost.total) : 0; const input = number(usage.input), cacheRead = number(usage.cacheRead), cacheWrite = number(usage.cacheWrite), output = number(usage.output); events.push({ sessionId, sessionTitle, sessionPath, timestampMs: at, project, workflow, provider: typeof message.provider === "string" ? message.provider : "unknown", model: typeof message.model === "string" ? message.model : "unknown", input, cacheRead, cacheWrite, output, reasoning: number(usage.reasoning), totalTokens: number(usage.totalTokens) || input + cacheRead + cacheWrite + output, cost, agentKind, agentName, subagentDepth }); return; }
			if (message.role !== "toolResult") return;
			const toolName = typeof message.toolName === "string" ? message.toolName : "unknown"; toolEvents.push({ sessionId, timestampMs: at, isError: message.isError === true, toolName, agentKind, subagentDepth });
			if (toolName !== "subagent" || !record(message.details) || !record(message.details.run) || !Array.isArray(message.details.run.children)) return;
			for (const child of message.details.run.children) { if (!record(child) || !Array.isArray(child.messages)) continue; const childName = typeof child.agent === "string" && child.agent.trim() ? child.agent : "subagent"; for (const childMessage of child.messages) if (record(childMessage)) visit(childMessage, at, "subagent", childName, subagentDepth + 1); }
		};
		for (const entry of messages) visit(entry.message, entry.timestampMs, "main", "main", 0);
	}
	return { events, toolEvents, scannedFiles: files.length, parseErrors, readErrors };
}
