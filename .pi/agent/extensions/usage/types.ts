export type GroupBy = "day" | "model" | "session" | "thread" | "project" | "workflow" | "agent";
export type OutputFormat = "text" | "json" | "csv";
export type UsageSort = "cost" | "tokens" | "turns" | "cache-rate";
export type SortOrder = "asc" | "desc";
export interface DateRange { label: string; startMs: number; endMs: number; }
export interface UsageQuery { range: DateRange; limit: number; groupBy: GroupBy[]; format: OutputFormat; anomalies: boolean; help: boolean; sortBy: UsageSort; order: SortOrder; }
