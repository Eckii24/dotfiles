import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";

import { generateTitle, shouldGenerateTitle } from "./title-generator.ts";

export default function sessionTitle(pi: ExtensionAPI): void {
	let attempted = false;

	pi.on("before_agent_start", async (event, ctx) => {
		if (!shouldGenerateTitle(attempted, ctx.sessionManager.getSessionFile(), pi.getSessionName())) return;
		attempted = true;

		const title = await generateTitle(event.prompt, ctx.cwd);
		if (title && !pi.getSessionName()) pi.setSessionName(title);
	});
}
