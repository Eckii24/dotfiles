import type { Row, Metrics } from "./analytics.js";
import type { DateRange } from "./types.js";

export const DATA_HEADERS = ["Sessions", "Turns", "Input", "C.Read", "C.Write", "Output", "Reason", "Cost", "Cache"] as const;
export const CSV_DATA_HEADERS = ["sessions", "turns", "input", "cacheRead", "cacheWrite", "output", "reasoning", "cost", "cacheReadRate"] as const;

type TableMetrics = Pick<Metrics, "uniqueSessions" | "assistantTurns" | "input" | "cacheRead" | "cacheWrite" | "output" | "reasoning" | "cost" | "cacheReadRate">;

export function formatToken(value: number): string { return value >= 1_000_000 ? `${(value / 1_000_000).toFixed(1)}M` : value >= 10_000 ? `${Math.round(value / 1_000)}k` : value >= 1_000 ? `${(value / 1_000).toFixed(1)}k` : `${Math.round(value)}`; }
function pct(value?: number): string { return value === undefined ? "-" : `${(value * 100).toFixed(1)}%`; }
function csv(value: unknown): string { const text = value === undefined || value === null ? "" : String(value); return /[",\n]/.test(text) ? `"${text.replaceAll('"','""')}"` : text; }

export function tableDataCells(metrics: TableMetrics): string[] {
	return [
		`${metrics.uniqueSessions}`,
		`${metrics.assistantTurns}`,
		formatToken(metrics.input),
		formatToken(metrics.cacheRead),
		formatToken(metrics.cacheWrite),
		formatToken(metrics.output),
		formatToken(metrics.reasoning),
		`$${metrics.cost.toFixed(4)}`,
		pct(metrics.cacheReadRate),
	];
}

export function textReport(title: string, rows: Row[], range: DateRange, limit = rows.length): string {
	const headers = ["Key", ...DATA_HEADERS];
	const raw = rows.slice(0, limit).map((row) => [row.label ?? row.key, ...tableDataCells(row.metrics)]);
	const widths = headers.map((header, index) => Math.max(header.length, ...raw.map((row) => row[index]!.length)));
	const format = (row: string[]) => row.map((cell, index) => index === 0 ? cell.padEnd(widths[index]!) : cell.padStart(widths[index]!)).join("  ");
	return [`${title} (${range.label})`, "Cost is Pi-recorded estimate; aggregate output excludes prompt, response and tool content.", format(headers), widths.map((width) => "-".repeat(width)).join("  "), ...raw.map(format), raw.length === 0 ? "No usage recorded for selected range." : ""].filter(Boolean).join("\n");
}

export function jsonReport(mode: string, range: DateRange, rows: Row[], quality: Record<string, number>): string { return JSON.stringify({ schemaVersion: 1, mode, range: { label: range.label, startMs: range.startMs, endMs: range.endMs }, dataQuality: quality, rows }, null, 2); }

export function csvReport(rows: Row[]): string {
	const lines = [["key", ...CSV_DATA_HEADERS].join(",")];
	for (const row of rows) {
		const m = row.metrics;
		lines.push([row.label ?? row.key, m.uniqueSessions, m.assistantTurns, m.input, m.cacheRead, m.cacheWrite, m.output, m.reasoning, m.cost, m.cacheReadRate].map(csv).join(","));
	}
	return lines.join("\n");
}
