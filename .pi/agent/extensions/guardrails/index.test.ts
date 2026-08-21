import { afterEach, expect, test } from "bun:test";
import guardrails from "./index.ts";
import {
	PI_GUARDRAILS_DISABLED,
	PI_GUARDRAILS_PREFLIGHT_DISABLED,
	PI_GUARDRAILS_PREFLIGHT_RULES,
} from "../shared/guardrails-session-state.ts";

const initialGuardrails = process.env[PI_GUARDRAILS_DISABLED];
const initialPreflight = process.env[PI_GUARDRAILS_PREFLIGHT_DISABLED];
const initialRules = process.env[PI_GUARDRAILS_PREFLIGHT_RULES];

afterEach(() => {
	if (initialGuardrails === undefined) delete process.env[PI_GUARDRAILS_DISABLED];
	else process.env[PI_GUARDRAILS_DISABLED] = initialGuardrails;
	if (initialPreflight === undefined) delete process.env[PI_GUARDRAILS_PREFLIGHT_DISABLED];
	else process.env[PI_GUARDRAILS_PREFLIGHT_DISABLED] = initialPreflight;
	if (initialRules === undefined) delete process.env[PI_GUARDRAILS_PREFLIGHT_RULES];
	else process.env[PI_GUARDRAILS_PREFLIGHT_RULES] = initialRules;
});

test("restores slash-command disable state when a goal starts a fresh session", async () => {
	process.env[PI_GUARDRAILS_DISABLED] = "1";
	process.env[PI_GUARDRAILS_PREFLIGHT_DISABLED] = "1";
	const entries: any[] = [];
	const handlers = new Map<string, any>();
	guardrails({
		registerFlag() {},
		getFlag() { return false; },
		on(name: string, handler: any) { handlers.set(name, handler); },
		registerCommand() {},
		appendEntry(_type: string, data: unknown) { entries.push(data); },
		events: { emit() {} },
	} as any);

	await handlers.get("session_start")?.({}, {
		cwd: process.cwd(),
		hasUI: false,
		sessionManager: { getBranch() { return []; } },
	});

	expect(entries[0]).toMatchObject({ disabled: true, preflightDisabled: true });
});

 test("slash-command disable state is exposed to a subsequent Herdr child launch", async () => {
	const commands = new Map<string, any>();
	guardrails({
		registerFlag() {},
		getFlag() { return false; },
		on() {},
		registerCommand(name: string, definition: unknown) { commands.set(name, definition); },
		appendEntry() {},
		events: { emit() {} },
	} as any);
	const context = { cwd: process.cwd(), ui: { notify() {} } };
	const handler = commands.get("guardrails")?.handler;

	await handler("disable", context);
	expect(process.env[PI_GUARDRAILS_DISABLED]).toBe("1");
	expect(process.env[PI_GUARDRAILS_PREFLIGHT_DISABLED]).toBe("0");

	await handler("preflight disable", context);
	expect(process.env[PI_GUARDRAILS_PREFLIGHT_DISABLED]).toBe("1");
	await handler("preflight rule add Require tests before mutation", context);
	expect(process.env[PI_GUARDRAILS_PREFLIGHT_RULES]).toBe('["Require tests before mutation"]');

	await handler("enable", context);
	await handler("preflight enable", context);
	expect(process.env[PI_GUARDRAILS_DISABLED]).toBe("0");
	expect(process.env[PI_GUARDRAILS_PREFLIGHT_DISABLED]).toBe("0");
});

test("explicit enable survives an extension reload with stale startup flags", async () => {
	delete process.env[PI_GUARDRAILS_DISABLED];
	delete process.env[PI_GUARDRAILS_PREFLIGHT_DISABLED];
	const commands = new Map<string, any>();
	const api = {
		registerFlag() {},
		getFlag(name: string) { return name === "no-guardrails" || name === "no-preflight-guardrails"; },
		on() {},
		registerCommand(name: string, definition: unknown) { commands.set(name, definition); },
		appendEntry() {},
		events: { emit() {} },
	};
	guardrails(api as any);
	const context = { cwd: process.cwd(), ui: { notify() {} } };
	await commands.get("guardrails").handler("enable", context);
	await commands.get("guardrails").handler("preflight enable", context);

	const entries: any[] = [];
	const handlers = new Map<string, any>();
	guardrails({
		...api,
		on(name: string, handler: any) { handlers.set(name, handler); },
		appendEntry(_type: string, data: unknown) { entries.push(data); },
	} as any);
	await handlers.get("session_start")({}, {
		cwd: process.cwd(), hasUI: false,
		sessionManager: { getBranch: () => [] },
	});
	expect(entries[0]).toMatchObject({ disabled: false, preflightDisabled: false });
});
