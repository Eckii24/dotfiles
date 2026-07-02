import { readdir, readFile, stat } from "node:fs/promises";
import { join } from "node:path";

export interface UsageTotals {
	input: number;
	cacheRead: number;
	output: number;
	cost: number;
	chats: number;
	subagentCalls: number;
}

export interface ModelUsageTotals {
	provider: string;
	model: string;
	providerModel: string;
	totals: UsageTotals;
}

export interface MonthlyUsageSummary {
	monthKey: string;
	monthLabel: string;
	rangeStartMs: number;
	rangeEndMs: number;
	scannedFiles: number;
	matchedFiles: number;
	parseErrors: number;
	days: Array<{
		day: string;
		totals: UsageTotals;
	}>;
	dailyModels: Array<{
		day: string;
		models: ModelUsageTotals[];
	}>;
	models: ModelUsageTotals[];
	totals: UsageTotals;
}

export interface BuildMonthlyUsageSummaryOptions {
	sessionDir: string;
	now?: Date;
}

interface MonthRange {
	monthKey: string;
	monthLabel: string;
	startMs: number;
	endMs: number;
}

function createEmptyTotals(): UsageTotals {
	return {
		input: 0,
		cacheRead: 0,
		output: 0,
		cost: 0,
		chats: 0,
		subagentCalls: 0,
	};
}

function addTotals(target: UsageTotals, source: Partial<UsageTotals> | undefined): void {
	if (!source) return;
	target.input += Number.isFinite(source.input) ? source.input ?? 0 : 0;
	target.cacheRead += Number.isFinite(source.cacheRead) ? source.cacheRead ?? 0 : 0;
	target.output += Number.isFinite(source.output) ? source.output ?? 0 : 0;
	target.cost += Number.isFinite(source.cost) ? source.cost ?? 0 : 0;
	target.chats += Number.isFinite(source.chats) ? source.chats ?? 0 : 0;
	target.subagentCalls += Number.isFinite(source.subagentCalls) ? source.subagentCalls ?? 0 : 0;
}

function getMonthRange(now: Date): MonthRange {
	const start = new Date(now.getFullYear(), now.getMonth(), 1);
	const end = new Date(now.getFullYear(), now.getMonth() + 1, 1);
	const monthKey = `${start.getFullYear()}-${pad2(start.getMonth() + 1)}`;
	const monthLabel = start.toLocaleDateString(undefined, { month: "long", year: "numeric" });
	return {
		monthKey,
		monthLabel,
		startMs: start.getTime(),
		endMs: end.getTime(),
	};
}

function pad2(value: number): string {
	return `${value}`.padStart(2, "0");
}

function toDayKey(timestampMs: number): string {
	const date = new Date(timestampMs);
	return `${date.getFullYear()}-${pad2(date.getMonth() + 1)}-${pad2(date.getDate())}`;
}

function isWithinRange(timestampMs: number, range: MonthRange): boolean {
	return timestampMs >= range.startMs && timestampMs < range.endMs;
}

function parseTimestamp(value: unknown): number | undefined {
	if (typeof value === "number" && Number.isFinite(value)) return value;
	if (typeof value !== "string") return undefined;
	const parsed = Date.parse(value);
	return Number.isFinite(parsed) ? parsed : undefined;
}

function isRecord(value: unknown): value is Record<string, unknown> {
	return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function hasUsage(value: unknown): value is { input?: number; cacheRead?: number; output?: number; cost?: { total?: number } } {
	return isRecord(value);
}

interface DayAccumulator {
	totals: UsageTotals;
	chatKeys: Set<string>;
	models: Map<string, ModelAccumulator>;
}

interface ModelAccumulator {
	provider: string;
	model: string;
	totals: UsageTotals;
	chatKeys: Set<string>;
}

function ensureDayAccumulator(accumulatorsByDay: Map<string, DayAccumulator>, day: string): DayAccumulator {
	const current = accumulatorsByDay.get(day);
	if (current) return current;
	const created: DayAccumulator = { totals: createEmptyTotals(), chatKeys: new Set(), models: new Map() };
	accumulatorsByDay.set(day, created);
	return created;
}

function ensureModelAccumulator(
	accumulatorsByModel: Map<string, ModelAccumulator>,
	provider: string,
	model: string,
): ModelAccumulator {
	const key = `${provider}/${model}`;
	const current = accumulatorsByModel.get(key);
	if (current) return current;
	const created: ModelAccumulator = {
		provider,
		model,
		totals: createEmptyTotals(),
		chatKeys: new Set(),
	};
	accumulatorsByModel.set(key, created);
	return created;
}

function collectUsageForTimestamp(
	accumulatorsByDay: Map<string, DayAccumulator>,
	timestampMs: number | undefined,
	usage: Partial<UsageTotals> | undefined,
	range: MonthRange,
	sessionKey: string,
	provider: string,
	model: string,
): void {
	if (timestampMs === undefined || !isWithinRange(timestampMs, range)) return;
	const day = toDayKey(timestampMs);
	const accumulator = ensureDayAccumulator(accumulatorsByDay, day);
	accumulator.chatKeys.add(sessionKey);
	addTotals(accumulator.totals, usage);
	const modelAccumulator = ensureModelAccumulator(accumulator.models, provider, model);
	modelAccumulator.chatKeys.add(sessionKey);
	addTotals(modelAccumulator.totals, usage);
}

function recordSubagentCall(
	accumulatorsByDay: Map<string, DayAccumulator>,
	timestampMs: number | undefined,
	range: MonthRange,
	sessionKey: string,
): void {
	if (timestampMs === undefined || !isWithinRange(timestampMs, range)) return;
	const day = toDayKey(timestampMs);
	const accumulator = ensureDayAccumulator(accumulatorsByDay, day);
	accumulator.chatKeys.add(sessionKey);
	accumulator.totals.subagentCalls += 1;
}

function getAssistantUsage(message: Record<string, unknown>): Partial<UsageTotals> | undefined {
	const usage = hasUsage(message.usage) ? message.usage : undefined;
	if (!usage) return undefined;
	return {
		input: typeof usage.input === "number" ? usage.input : 0,
		cacheRead: typeof usage.cacheRead === "number" ? usage.cacheRead : 0,
		output: typeof usage.output === "number" ? usage.output : 0,
		cost: isRecord(usage.cost) && typeof usage.cost.total === "number" ? usage.cost.total : 0,
	};
}

function getProviderModel(message: Record<string, unknown>): { provider: string; model: string; providerModel: string } {
	const provider = typeof message.provider === "string" && message.provider.trim() ? message.provider.trim() : "unknown";
	const model = typeof message.model === "string" && message.model.trim() ? message.model.trim() : "unknown";
	return { provider, model, providerModel: `${provider}/${model}` };
}

function collectModelUsageForTimestamp(
	accumulatorsByModel: Map<string, ModelAccumulator>,
	timestampMs: number | undefined,
	usage: Partial<UsageTotals> | undefined,
	range: MonthRange,
	sessionKey: string,
	provider: string,
	model: string,
): void {
	if (timestampMs === undefined || !isWithinRange(timestampMs, range)) return;
	const accumulator = ensureModelAccumulator(accumulatorsByModel, provider, model);
	accumulator.chatKeys.add(sessionKey);
	addTotals(accumulator.totals, usage);
}

function recordModelSubagentCalls(
	accumulatorsByModel: Map<string, ModelAccumulator>,
	providerModels: Set<string>,
	sessionKey: string,
): void {
	for (const providerModel of providerModels) {
		const slashIndex = providerModel.indexOf("/");
		const provider = slashIndex === -1 ? providerModel : providerModel.slice(0, slashIndex);
		const model = slashIndex === -1 ? "unknown" : providerModel.slice(slashIndex + 1);
		const accumulator = ensureModelAccumulator(accumulatorsByModel, provider, model);
		accumulator.chatKeys.add(sessionKey);
		accumulator.totals.subagentCalls += 1;
	}
}

function recordDayModelSubagentCalls(
	accumulatorsByDay: Map<string, DayAccumulator>,
	timestampMs: number | undefined,
	range: MonthRange,
	sessionKey: string,
	providerModels: Set<string>,
): void {
	if (timestampMs === undefined || !isWithinRange(timestampMs, range)) return;
	const day = toDayKey(timestampMs);
	const accumulator = ensureDayAccumulator(accumulatorsByDay, day);
	accumulator.chatKeys.add(sessionKey);
	for (const providerModel of providerModels) {
		const slashIndex = providerModel.indexOf("/");
		const provider = slashIndex === -1 ? providerModel : providerModel.slice(0, slashIndex);
		const model = slashIndex === -1 ? "unknown" : providerModel.slice(slashIndex + 1);
		const modelAccumulator = ensureModelAccumulator(accumulator.models, provider, model);
		modelAccumulator.chatKeys.add(sessionKey);
		modelAccumulator.totals.subagentCalls += 1;
	}
}

function collectMessageUsage(
	message: unknown,
	fallbackTimestampMs: number | undefined,
	accumulatorsByDay: Map<string, DayAccumulator>,
	accumulatorsByModel: Map<string, ModelAccumulator>,
	range: MonthRange,
	sessionKey: string,
): Set<string> {
	if (!isRecord(message) || typeof message.role !== "string") return new Set();
	if (message.role === "assistant") {
		const timestampMs = parseTimestamp(message.timestamp) ?? fallbackTimestampMs;
		const usage = getAssistantUsage(message);
		const providerModel = getProviderModel(message);
		collectUsageForTimestamp(accumulatorsByDay, timestampMs, usage, range, sessionKey, providerModel.provider, providerModel.model);
		collectModelUsageForTimestamp(
			accumulatorsByModel,
			timestampMs,
			usage,
			range,
			sessionKey,
			providerModel.provider,
			providerModel.model,
		);
		return timestampMs !== undefined && isWithinRange(timestampMs, range) ? new Set([providerModel.providerModel]) : new Set();
	}
	if (message.role === "toolResult" && message.toolName === "subagent") {
		recordSubagentCall(accumulatorsByDay, parseTimestamp(message.timestamp) ?? fallbackTimestampMs, range, sessionKey);
		const timestampMs = parseTimestamp(message.timestamp) ?? fallbackTimestampMs;
		const touchedProviderModels = collectSubagentUsage(message.details, accumulatorsByDay, accumulatorsByModel, range, sessionKey);
		recordDayModelSubagentCalls(accumulatorsByDay, timestampMs, range, sessionKey, touchedProviderModels);
		recordModelSubagentCalls(accumulatorsByModel, touchedProviderModels, sessionKey);
		return touchedProviderModels;
	}
	return new Set();
}

function collectMessagesUsage(
	messages: unknown,
	accumulatorsByDay: Map<string, DayAccumulator>,
	accumulatorsByModel: Map<string, ModelAccumulator>,
	range: MonthRange,
	sessionKey: string,
): Set<string> {
	const touchedProviderModels = new Set<string>();
	if (!Array.isArray(messages)) return touchedProviderModels;
	for (const message of messages) {
		for (const providerModel of collectMessageUsage(message, undefined, accumulatorsByDay, accumulatorsByModel, range, sessionKey)) {
			touchedProviderModels.add(providerModel);
		}
	}
	return touchedProviderModels;
}

function collectSubagentUsage(
	details: unknown,
	accumulatorsByDay: Map<string, DayAccumulator>,
	accumulatorsByModel: Map<string, ModelAccumulator>,
	range: MonthRange,
	sessionKey: string,
): Set<string> {
	const touchedProviderModels = new Set<string>();
	if (!isRecord(details)) return touchedProviderModels;

	const run = isRecord(details.run) ? details.run : undefined;
	if (run && Array.isArray(run.children)) {
		for (const child of run.children) {
			if (!isRecord(child)) continue;
			for (const providerModel of collectMessagesUsage(child.messages, accumulatorsByDay, accumulatorsByModel, range, sessionKey)) {
				touchedProviderModels.add(providerModel);
			}
		}
		return touchedProviderModels;
	}

	if (Array.isArray(details.results)) {
		for (const result of details.results) {
			if (!isRecord(result)) continue;
			for (const providerModel of collectMessagesUsage(result.messages, accumulatorsByDay, accumulatorsByModel, range, sessionKey)) {
				touchedProviderModels.add(providerModel);
			}
		}
	}
	return touchedProviderModels;
}

async function listJsonlFiles(rootDir: string, rangeStartMs: number): Promise<{ scannedFiles: number; matchedFiles: string[] }> {
	const matchedFiles: string[] = [];
	let scannedFiles = 0;

	async function walk(dir: string): Promise<void> {
		let entries;
		try {
			entries = await readdir(dir, { withFileTypes: true });
		} catch (error) {
			if ((error as NodeJS.ErrnoException).code === "ENOENT") return;
			throw error;
		}

		for (const entry of entries) {
			const path = join(dir, entry.name);
			if (entry.isDirectory()) {
				await walk(path);
				continue;
			}
			if (!entry.isFile() || !entry.name.endsWith(".jsonl")) continue;
			scannedFiles++;
			const fileStat = await stat(path);
			if (fileStat.mtimeMs < rangeStartMs) continue;
			matchedFiles.push(path);
		}
	}

	await walk(rootDir);
	return { scannedFiles, matchedFiles };
}

export async function buildMonthlyUsageSummary(options: BuildMonthlyUsageSummaryOptions): Promise<MonthlyUsageSummary> {
	const range = getMonthRange(options.now ?? new Date());
	const accumulatorsByDay = new Map<string, DayAccumulator>();
	const accumulatorsByModel = new Map<string, ModelAccumulator>();
	let parseErrors = 0;

	const { scannedFiles, matchedFiles } = await listJsonlFiles(options.sessionDir, range.startMs);
	for (const filePath of matchedFiles) {
		const content = await readFile(filePath, "utf8");
		for (const rawLine of content.split("\n")) {
			const line = rawLine.trim();
			if (!line) continue;
			let entry: unknown;
			try {
				entry = JSON.parse(line);
			} catch {
				parseErrors++;
				continue;
			}
			if (!isRecord(entry) || entry.type !== "message") continue;
			const fallbackTimestampMs = parseTimestamp(entry.timestamp);
			collectMessageUsage(entry.message, fallbackTimestampMs, accumulatorsByDay, accumulatorsByModel, range, filePath);
		}
	}

	const days = Array.from(accumulatorsByDay.entries())
		.sort(([left], [right]) => left.localeCompare(right))
		.map(([day, accumulator]) => ({
			day,
			totals: {
				...accumulator.totals,
				chats: accumulator.chatKeys.size,
			},
		}));
	const dailyModels = Array.from(accumulatorsByDay.entries())
		.sort(([left], [right]) => left.localeCompare(right))
		.map(([day, accumulator]) => ({
			day,
			models: Array.from(accumulator.models.entries())
				.sort(([left], [right]) => left.localeCompare(right))
				.map(([providerModel, modelAccumulator]) => ({
					provider: modelAccumulator.provider,
					model: modelAccumulator.model,
					providerModel,
					totals: {
						...modelAccumulator.totals,
						chats: modelAccumulator.chatKeys.size,
					},
				})),
		}));
	const models = Array.from(accumulatorsByModel.entries())
		.sort(([left], [right]) => left.localeCompare(right))
		.map(([providerModel, accumulator]) => ({
			provider: accumulator.provider,
			model: accumulator.model,
			providerModel,
			totals: {
				...accumulator.totals,
				chats: accumulator.chatKeys.size,
			},
		}));
	const totals = createEmptyTotals();
	for (const item of days) addTotals(totals, item.totals);

	return {
		monthKey: range.monthKey,
		monthLabel: range.monthLabel,
		rangeStartMs: range.startMs,
		rangeEndMs: range.endMs,
		scannedFiles,
		matchedFiles: matchedFiles.length,
		parseErrors,
		days,
		dailyModels,
		models,
		totals,
	};
}

function formatTokens(value: number): string {
	const abs = Math.abs(value);
	if (abs >= 1_000_000) return `${(value / 1_000_000).toFixed(1)}M`;
	if (abs >= 10_000) return `${Math.round(value / 1_000)}k`;
	if (abs >= 1_000) return `${(value / 1_000).toFixed(1)}k`;
	return `${Math.round(value)}`;
}

function padCell(value: string, width: number): string {
	return value.padStart(width, " ");
}

export function formatMonthlyUsageReport(summary: MonthlyUsageSummary): string {
	const lines: string[] = [];
	lines.push(`${summary.monthLabel} usage`);
	lines.push(`Scanned ${summary.scannedFiles} session files, matched ${summary.matchedFiles} updated this month.`);
	lines.push("Includes assistant turns plus nested subagent runs captured in session tool results.");
	lines.push("Chats = active session files that recorded usage that day.");
	if (summary.parseErrors > 0) lines.push(`Skipped ${summary.parseErrors} malformed session entries.`);
	lines.push("");

	const headers = ["Date", "Chats", "Subcalls", "Input", "Cached", "Output", "Cost"];
	const rows = summary.days.map((item) => [
		item.day,
		`${item.totals.chats}`,
		`${item.totals.subagentCalls}`,
		formatTokens(item.totals.input),
		formatTokens(item.totals.cacheRead),
		formatTokens(item.totals.output),
		`$${item.totals.cost.toFixed(4)}`,
	]);
	rows.push([
		"TOTAL",
		`${summary.totals.chats}`,
		`${summary.totals.subagentCalls}`,
		formatTokens(summary.totals.input),
		formatTokens(summary.totals.cacheRead),
		formatTokens(summary.totals.output),
		`$${summary.totals.cost.toFixed(4)}`,
	]);

	const widths = headers.map((header, index) =>
		Math.max(header.length, ...rows.map((row) => row[index]?.length ?? 0)),
	);
	const formatRow = (row: string[]) => [
		row[0]!.padEnd(widths[0]!, " "),
		padCell(row[1]!, widths[1]!),
		padCell(row[2]!, widths[2]!),
		padCell(row[3]!, widths[3]!),
		padCell(row[4]!, widths[4]!),
		padCell(row[5]!, widths[5]!),
		padCell(row[6]!, widths[6]!),
	].join("  ");

	lines.push(formatRow(headers));
	lines.push(widths.map((width) => "-".repeat(width)).join("  "));
	for (const row of rows) lines.push(formatRow(row));

	if (summary.days.length === 0) {
		lines.push("");
		lines.push(`No usage recorded for ${summary.monthKey}.`);
	}

	return lines.join("\n");
}

export function formatDetailedMonthlyUsageReport(summary: MonthlyUsageSummary): string {
	const lines: string[] = [];
	lines.push(`${summary.monthLabel} usage by day`);
	lines.push(`Scanned ${summary.scannedFiles} session files, matched ${summary.matchedFiles} updated this month.`);
	lines.push("Rows sorted by day.");
	lines.push("Chats = active session files that recorded usage that day.");
	lines.push("Subcalls = subagent invocations captured that day.");
	if (summary.parseErrors > 0) lines.push(`Skipped ${summary.parseErrors} malformed session entries.`);
	lines.push("");

	const headers = ["Date", "Chats", "Subcalls", "Input", "Cached", "Output", "Cost"];
	const rows = summary.days.map((item) => [
		item.day,
		`${item.totals.chats}`,
		`${item.totals.subagentCalls}`,
		formatTokens(item.totals.input),
		formatTokens(item.totals.cacheRead),
		formatTokens(item.totals.output),
		`$${item.totals.cost.toFixed(4)}`,
	]);
	rows.push([
		"TOTAL",
		`${summary.totals.chats}`,
		`${summary.totals.subagentCalls}`,
		formatTokens(summary.totals.input),
		formatTokens(summary.totals.cacheRead),
		formatTokens(summary.totals.output),
		`$${summary.totals.cost.toFixed(4)}`,
	]);

	const widths = headers.map((header, index) => Math.max(header.length, ...rows.map((row) => row[index]?.length ?? 0)));
	const formatRow = (row: string[]) => [
		row[0]!.padEnd(widths[0]!, " "),
		padCell(row[1]!, widths[1]!),
		padCell(row[2]!, widths[2]!),
		padCell(row[3]!, widths[3]!),
		padCell(row[4]!, widths[4]!),
		padCell(row[5]!, widths[5]!),
		padCell(row[6]!, widths[6]!),
	].join("  ");

	lines.push(formatRow(headers));
	lines.push(widths.map((width) => "-".repeat(width)).join("  "));
	for (const row of rows) lines.push(formatRow(row));

	const dailyModelsByDay = new Map(summary.dailyModels.map((item) => [item.day, item.models]));
	for (const day of summary.days) {
		const models = dailyModelsByDay.get(day.day) ?? [];
		lines.push("");
		lines.push(`${day.day} models`);
		if (models.length === 0) {
			lines.push(`No model usage recorded for ${day.day}.`);
			continue;
		}

		const modelHeaders = ["Provider/Model", "Chats", "Subcalls", "Input", "Cached", "Output", "Cost"];
		const modelRows = models.map((item) => [
			item.providerModel,
			`${item.totals.chats}`,
			`${item.totals.subagentCalls}`,
			formatTokens(item.totals.input),
			formatTokens(item.totals.cacheRead),
			formatTokens(item.totals.output),
			`$${item.totals.cost.toFixed(4)}`,
		]);
		const modelWidths = modelHeaders.map((header, index) =>
			Math.max(header.length, ...modelRows.map((row) => row[index]?.length ?? 0)),
		);
		const formatModelRow = (row: string[]) => [
			row[0]!.padEnd(modelWidths[0]!, " "),
			padCell(row[1]!, modelWidths[1]!),
			padCell(row[2]!, modelWidths[2]!),
			padCell(row[3]!, modelWidths[3]!),
			padCell(row[4]!, modelWidths[4]!),
			padCell(row[5]!, modelWidths[5]!),
			padCell(row[6]!, modelWidths[6]!),
		].join("  ");

		lines.push(formatModelRow(modelHeaders));
		lines.push(modelWidths.map((width) => "-".repeat(width)).join("  "));
		for (const row of modelRows) lines.push(formatModelRow(row));
	}

	if (summary.days.length === 0) {
		lines.push("");
		lines.push(`No usage recorded for ${summary.monthKey}.`);
	}

	return lines.join("\n");
}
