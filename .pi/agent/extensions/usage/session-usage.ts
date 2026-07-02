export interface SessionUsageTotals {
	input: number;
	cacheRead: number;
	output: number;
	cost: number;
}

function createEmptyTotals(): SessionUsageTotals {
	return {
		input: 0,
		cacheRead: 0,
		output: 0,
		cost: 0,
	};
}

function isRecord(value: unknown): value is Record<string, unknown> {
	return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function addTotals(target: SessionUsageTotals, source: Partial<SessionUsageTotals> | undefined): void {
	if (!source) return;
	target.input += Number.isFinite(source.input) ? source.input ?? 0 : 0;
	target.cacheRead += Number.isFinite(source.cacheRead) ? source.cacheRead ?? 0 : 0;
	target.output += Number.isFinite(source.output) ? source.output ?? 0 : 0;
	target.cost += Number.isFinite(source.cost) ? source.cost ?? 0 : 0;
}

function getAssistantUsageTotals(message: Record<string, unknown>): SessionUsageTotals | undefined {
	const usage = isRecord(message.usage) ? message.usage : undefined;
	if (!usage) return undefined;
	return {
		input: typeof usage.input === "number" ? usage.input : 0,
		cacheRead: typeof usage.cacheRead === "number" ? usage.cacheRead : 0,
		output: typeof usage.output === "number" ? usage.output : 0,
		cost: isRecord(usage.cost) && typeof usage.cost.total === "number" ? usage.cost.total : 0,
	};
}

function getSnapshotUsageTotals(usage: unknown): SessionUsageTotals | undefined {
	if (!isRecord(usage)) return undefined;
	return {
		input: typeof usage.input === "number" ? usage.input : 0,
		cacheRead: typeof usage.cacheRead === "number" ? usage.cacheRead : 0,
		output: typeof usage.output === "number" ? usage.output : 0,
		cost: typeof usage.cost === "number" ? usage.cost : 0,
	};
}

export function collectMessageUsageTotals(message: unknown): SessionUsageTotals {
	const totals = createEmptyTotals();
	if (!isRecord(message) || typeof message.role !== "string") return totals;
	if (message.role === "assistant") {
		addTotals(totals, getAssistantUsageTotals(message));
		return totals;
	}
	if (message.role === "toolResult" && message.toolName === "subagent") {
		addTotals(totals, collectSubagentUsageTotals(message.details));
	}
	return totals;
}

export function collectMessagesUsageTotals(messages: unknown): SessionUsageTotals {
	const totals = createEmptyTotals();
	if (!Array.isArray(messages)) return totals;
	for (const message of messages) {
		addTotals(totals, collectMessageUsageTotals(message));
	}
	return totals;
}

export function collectSubagentUsageTotals(details: unknown): SessionUsageTotals {
	const totals = createEmptyTotals();
	if (!isRecord(details)) return totals;

	const run = isRecord(details.run) ? details.run : undefined;
	if (run && Array.isArray(run.children)) {
		for (const child of run.children) {
			if (!isRecord(child)) continue;
			if (Array.isArray(child.messages) && child.messages.length > 0) addTotals(totals, collectMessagesUsageTotals(child.messages));
			else addTotals(totals, getSnapshotUsageTotals(child.usage));
		}
		return totals;
	}

	if (Array.isArray(details.results)) {
		for (const result of details.results) {
			if (!isRecord(result)) continue;
			if (Array.isArray(result.messages) && result.messages.length > 0) addTotals(totals, collectMessagesUsageTotals(result.messages));
			else addTotals(totals, getSnapshotUsageTotals(result.usage));
		}
	}

	return totals;
}

export function getSessionUsageTotals(entries: unknown): SessionUsageTotals {
	const totals = createEmptyTotals();
	if (!Array.isArray(entries)) return totals;
	for (const entry of entries) {
		if (!isRecord(entry) || entry.type !== "message") continue;
		addTotals(totals, collectMessageUsageTotals(entry.message));
	}
	return totals;
}
