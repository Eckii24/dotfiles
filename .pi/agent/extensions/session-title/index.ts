import type { ExtensionAPI, ExtensionContext } from "@earendil-works/pi-coding-agent";

import { generateTitle, shouldGenerateTitle } from "./title-generator.ts";

type TitleGenerator = (prompt: string, cwd: string) => Promise<string | undefined>;

export function registerSessionTitle(pi: ExtensionAPI, generator: TitleGenerator = generateTitle): void {
	let attempted = false;

	pi.on("session_start", async () => {
		// Goal and other extensions can replace the active Pi session without
		// reloading extensions. Attempt tracking therefore belongs to a session,
		// not to the extension instance.
		attempted = false;
	});

	pi.on("before_agent_start", async (event, ctx: ExtensionContext) => {
		if (!shouldGenerateTitle(attempted, ctx.sessionManager.getSessionFile(), pi.getSessionName())) return;
		attempted = true;

		const title = await generator(event.prompt, ctx.cwd);
		if (title && !pi.getSessionName()) pi.setSessionName(title);
	});
}

export default function sessionTitle(pi: ExtensionAPI): void {
	registerSessionTitle(pi);
}
