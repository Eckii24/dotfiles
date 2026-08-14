import { join } from "node:path";
import { getAgentDir, type ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { aggregate, anomalies } from "./analytics.js";
import { parseUsageQuery, usageHelp } from "./query.js";
import { csvReport, jsonReport, textReport } from "./render.js";
import { readSessionUsage } from "./session-reader.js";
import { renderTreeTable, usageTree } from "./tree.js";

function sortRows(rows: ReturnType<typeof aggregate>, sort: string, order: string) { const score=(row: typeof rows[number]) => sort === "cost" ? row.metrics.cost : sort === "turns" ? row.metrics.assistantTurns : sort === "tokens" ? row.metrics.totalTokens : (row.metrics.cacheReadRate ?? -1); const sign=order === "asc" ? 1 : -1; return rows.sort((a,b)=>sign*(score(a)-score(b))||a.key.localeCompare(b.key)); }

async function run(): Promise<void> {
	const query = parseUsageQuery(process.argv);
	if (query.help) { process.stdout.write(`${usageHelp()}\n`); return; }
	const input = await readSessionUsage(join(getAgentDir(), "sessions"));
	const quality = { scannedFiles: input.scannedFiles, parseErrors: input.parseErrors, readErrors: input.readErrors };
	let events = input.events;
	let anomalyTitle = "";
	if (query.anomalies) {
		const result = anomalies(aggregate(input.events, input.toolEvents, query.range, "session"));
		if (result.insufficientSample) {
			process.stdout.write(`Usage anomalies (${query.range.label})\nInsufficient sample: need at least 4 sessions with cost >= $0.25.\n`);
			return;
		}
		const anomalousSessionIds = new Set(result.rows.map((row) => row.key));
		events = events.filter((event) => anomalousSessionIds.has(event.sessionId));
		anomalyTitle = `Usage anomalies; threshold >= 2× median ($${result.median!.toFixed(4)})`;
	}
	if (query.groupBy.length > 1) {
		const tree = usageTree(events, query.range.startMs, query.range.endMs, query.groupBy, query.sortBy, query.order);
		if (query.format === "json") process.stdout.write(`${JSON.stringify({ schemaVersion: 1, range: query.range, groupBy: query.groupBy, anomalies: query.anomalies, dataQuality: quality, tree }, null, 2)}\n`);
		else if (query.format === "csv") throw new Error("[--usage] CSV supports one --group-by level only.");
		else process.stdout.write(`${anomalyTitle || "Pi usage"} (${query.range.label})\n${renderTreeTable(tree, query.groupBy, query.limit, query.sums)}\n`);
		return;
	}
	const group = query.groupBy[0] ?? (query.anomalies ? "session" : "model");
	const rows = sortRows(aggregate(events, input.toolEvents, query.range, group), query.sortBy, query.order);
	if (query.format === "json") process.stdout.write(`${jsonReport(group, query.range, rows, quality)}\n`);
	else if (query.format === "csv") process.stdout.write(`${csvReport(rows)}\n`);
	else process.stdout.write(`${textReport(anomalyTitle || `Pi usage by ${group}`, rows, query.range, query.limit)}\n`);
}

export default async function (pi: ExtensionAPI) {
	for (const [name, type] of [["usage", "string"], ["period", "string"], ["from", "string"], ["to", "string"], ["last", "string"], ["group-by", "string"], ["sum", "string"], ["format", "string"], ["sort", "string"], ["order", "string"], ["limit", "string"], ["anomalies", "boolean"]] as const) pi.registerFlag(name, { description: "Usage analytics selector; use with --usage.", type });
	if (!process.argv.some((arg) => arg === "--usage" || arg.startsWith("--usage="))) return;
	try { await run(); process.exit(0); }
	catch (error) { process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`); process.exit(1); }
}
