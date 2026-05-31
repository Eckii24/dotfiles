import type { ExtensionCommandContext } from "@mariozechner/pi-coding-agent";
import type { LeafRunSnapshot, RunTreeNode } from "../run-model.js";

const STEER_BODY_SEPARATOR = "---";

export async function openSteerCompose(
	ctx: ExtensionCommandContext,
	node: RunTreeNode,
	leaf: LeafRunSnapshot,
): Promise<string | undefined> {
	const targetPath = node.breadcrumb.join(" › ");
	const delivery = node.liveTarget?.proxied
		? "proxied through the nearest live child transport"
		: "sent directly to the live child transport";
	const prefill = [
		`# Target agent: ${leaf.agent}`,
		`# Target path: ${targetPath}`,
		`# Delivery: ${delivery}`,
		"# Write the steering message below.",
		STEER_BODY_SEPARATOR,
		"",
	].join("\n");
	const title = targetPath && targetPath !== leaf.agent ? `Steer ${leaf.agent} · ${targetPath}` : `Steer ${leaf.agent}`;
	const text = await ctx.ui.editor(title, prefill);
	const body = extractSteerBody(text);
	return body ? body : undefined;
}

function extractSteerBody(text: string | undefined): string {
	if (!text) return "";
	const separatorIndex = text.indexOf(`${STEER_BODY_SEPARATOR}\n`);
	if (separatorIndex >= 0) {
		return text.slice(separatorIndex + STEER_BODY_SEPARATOR.length + 1).trim();
	}

	const lines = text.split("\n");
	while (lines.length > 0 && isSteerScaffoldLine(lines[0] || "")) lines.shift();
	return lines.join("\n").trim();
}

function isSteerScaffoldLine(line: string): boolean {
	const trimmed = line.trim();
	return trimmed.startsWith("# Target agent:")
		|| trimmed.startsWith("# Target path:")
		|| trimmed.startsWith("# Delivery:")
		|| trimmed === "# Write the steering message below.";
}
