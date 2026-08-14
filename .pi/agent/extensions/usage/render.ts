import type { Row, Metrics } from "./analytics.js";
import type { DateRange } from "./types.js";

export const DATA_HEADERS = ["Sessions", "Turns", "Input", "C.Read", "C.Write", "Output", "Reason"] as const;
export const COST_HEADERS = ["In $", "C.Read $", "C.Write $", "Out $"] as const;
export const CSV_DATA_HEADERS = ["sessions", "turns", "input", "cacheRead", "cacheWrite", "output", "reasoning"] as const;
export const CSV_COST_HEADERS = ["costInput", "costCacheRead", "costCacheWrite", "costOutput"] as const;

type TableMetrics = Pick<Metrics, "uniqueSessions" | "assistantTurns" | "input" | "cacheRead" | "cacheWrite" | "output" | "reasoning" | "costInput" | "costCacheRead" | "costCacheWrite" | "costOutput" | "cost" | "cacheReadRate">;

export function formatToken(value: number): string {
	if (value >= 999_500) return `${(value / 1_000_000).toFixed(1)}M`;
	if (value >= 10_000) return `${Math.round(value / 1_000)}k`;
	if (value >= 1_000) return `${(value / 1_000).toFixed(1)}k`;
	return `${Math.round(value)}`;
}
function pct(value?: number): string { return value === undefined ? "-" : `${(value * 100).toFixed(1)}%`; }
function money(value: number): string { return `$${value.toFixed(4)}`; }
function csv(value: unknown): string { const text = value === undefined || value === null ? "" : String(value); return /[",\n]/.test(text) ? `"${text.replaceAll('"','""')}"` : text; }

export function tableDataCells(metrics: TableMetrics, detailed = false): string[] {
	const tokens = [`${metrics.uniqueSessions}`, `${metrics.assistantTurns}`, formatToken(metrics.input), formatToken(metrics.cacheRead), formatToken(metrics.cacheWrite), formatToken(metrics.output), formatToken(metrics.reasoning)];
	const costs = detailed ? [money(metrics.costInput), money(metrics.costCacheRead), money(metrics.costCacheWrite), money(metrics.costOutput)] : [];
	return [...tokens, ...costs, money(metrics.cost), pct(metrics.cacheReadRate)];
}
export function tableHeaders(detailed = false): string[] { return [...DATA_HEADERS, ...(detailed ? COST_HEADERS : []), "Cost", "Cache"]; }

export function textReport(title: string, rows: Row[], range: DateRange, limit = rows.length, detailed = false): string {
	const headers = ["Key", ...tableHeaders(detailed)];
	const raw = rows.slice(0, limit).map((row) => [row.label ?? row.key, ...tableDataCells(row.metrics, detailed)]);
	const widths = headers.map((header, index) => Math.max(header.length, ...raw.map((row) => row[index]!.length)));
	const format = (row: string[]) => row.map((cell, index) => index === 0 ? cell.padEnd(widths[index]!) : cell.padStart(widths[index]!)).join("  ");
	return [`${title} (${range.label})`, "Cost is Pi-recorded estimate; aggregate output excludes prompt, response and tool content.", format(headers), widths.map((width) => "-".repeat(width)).join("  "), ...raw.map(format), raw.length === 0 ? "No usage recorded for selected range." : ""].filter(Boolean).join("\n");
}

export function jsonReport(mode: string, range: DateRange, rows: Row[], quality: Record<string, number>): string { return JSON.stringify({ schemaVersion: 1, mode, range: { label: range.label, startMs: range.startMs, endMs: range.endMs }, dataQuality: quality, rows }, null, 2); }
export function csvReport(rows: Row[], detailed = false): string {
	const headers = ["key", ...CSV_DATA_HEADERS, ...(detailed ? CSV_COST_HEADERS : []), "cost", "cacheReadRate"];
	const lines = [headers.join(",")];
	for (const row of rows) { const m = row.metrics; const costs = detailed ? [m.costInput, m.costCacheRead, m.costCacheWrite, m.costOutput] : []; lines.push([row.label ?? row.key, m.uniqueSessions, m.assistantTurns, m.input, m.cacheRead, m.cacheWrite, m.output, m.reasoning, ...costs, m.cost, m.cacheReadRate].map(csv).join(",")); }
	return lines.join("\n");
}
