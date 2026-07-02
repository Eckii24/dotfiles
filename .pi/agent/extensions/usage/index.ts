import { join } from "node:path";
import { getAgentDir, type ExtensionAPI } from "@mariozechner/pi-coding-agent";
import { buildMonthlyUsageSummary, formatDetailedMonthlyUsageReport, formatMonthlyUsageReport } from "./report.js";

const FLAG_NAME = "usage";

type UsageMode = "off" | "daily" | "detailed";

function parseUsageMode(argv: string[]): UsageMode {
	let mode: UsageMode = "off";
	for (const arg of argv.slice(2)) {
		if (arg === `--${FLAG_NAME}`) {
			mode = "daily";
			continue;
		}
		if (!arg.startsWith(`--${FLAG_NAME}=`)) continue;
		const value = arg.slice(FLAG_NAME.length + 3).trim().toLowerCase();
		if (["", "1", "true", "yes", "on", "normal", "daily"].includes(value)) mode = "daily";
		else if (value === "detailed") mode = "detailed";
		else if (["0", "false", "no", "off"].includes(value)) mode = "off";
	}
	return mode;
}

async function runUsageReport(mode: UsageMode): Promise<void> {
	const summary = await buildMonthlyUsageSummary({
		sessionDir: join(getAgentDir(), "sessions"),
		now: new Date(),
	});
	const report = mode === "detailed" ? formatDetailedMonthlyUsageReport(summary) : formatMonthlyUsageReport(summary);
	process.stdout.write(`${report}\n`);
}

export default async function (pi: ExtensionAPI) {
	pi.registerFlag(FLAG_NAME, {
		description: "Print current-month usage totals and exit. Use --usage for daily output or --usage=detailed for daily output plus per-day provider/model breakdown",
		type: "string",
	});

	const mode = parseUsageMode(process.argv);
	if (mode === "off") return;

	try {
		await runUsageReport(mode);
		process.exit(0);
	} catch (error) {
		const message = error instanceof Error ? error.message : String(error);
		process.stderr.write(`[--${FLAG_NAME}] ${message}\n`);
		process.exit(1);
	}
}
