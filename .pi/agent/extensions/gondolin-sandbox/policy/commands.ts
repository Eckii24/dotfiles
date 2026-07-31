import { isAbsolute } from "node:path";
import { mutatePolicy, type MutationKind, type MutationPaths, type MutationRequest } from "./handlers";
import type { SandboxPolicy } from "./policy";

export const POLICY_COMMANDS = [
  "sandbox-mount-ro",
  "sandbox-mount-rw",
  "sandbox-network-allow",
  "sandbox-network-deny",
  "sandbox-policy",
] as const;

type Scope = "global" | "project";
type CommandContext = {
  mode: string;
  hasUI: boolean;
  isIdle: () => boolean;
  isProjectTrusted: () => boolean;
  ui: {
    notify: (message: string, level?: "info" | "warning" | "error") => unknown;
    select: (title: string, options: string[]) => Promise<string | undefined>;
    input: (title: string, placeholder?: string) => Promise<string | undefined>;
    confirm: (title: string, message: string) => Promise<boolean>;
  };
};
type PiCommandApi = {
  registerCommand: (name: string, descriptor: { description?: string; handler: (args: string, ctx: CommandContext) => Promise<void> }) => void;
};
type Dependencies = {
  pathsForScope: (scope: Scope) => MutationPaths;
  readPolicy: (ctx: CommandContext) => Promise<SandboxPolicy>;
  mutate?: (request: MutationRequest) => Promise<{ scope: Scope; message: string }>;
};

const tokenize = (input: string): string[] => {
  const tokens: string[] = [];
  const pattern = /"([^"\\]*(?:\\.[^"\\]*)*)"|'([^']*)'|([^\s]+)/g;
  let match: RegExpExecArray | null;
  while ((match = pattern.exec(input)) !== null) tokens.push((match[1] ?? match[2] ?? match[3] ?? "").replace(/\\"/g, '"'));
  if (tokens.join("").length === 0 && input.trim().length > 0) throw new Error("invalid command arguments");
  return tokens;
};
const requireInteractiveIdle = (ctx: CommandContext): void => {
  if (ctx.mode !== "tui" || !ctx.hasUI) throw new Error("sandbox policy commands require an interactive TUI");
  if (!ctx.isIdle()) throw new Error("sandbox policy commands require the agent to be idle");
};
const request = (name: string, action: "add" | "remove", value: string, scope: Scope, deps: Dependencies, options: { guestPath?: string; required?: boolean } = {}): MutationRequest => {
  const mount = name.startsWith("sandbox-mount-");
  if (mount && !isAbsolute(value)) throw new Error("mount host path must be absolute; Pi does not expand ~ or variables");
  if (options.guestPath !== undefined && (!mount || !isAbsolute(options.guestPath))) throw new Error("--guest requires an absolute path");
  if (action === "remove" && (options.guestPath !== undefined || options.required)) throw new Error("remove does not accept --guest or --required");
  return {
    kind: name.replace(/^sandbox-/, "") as MutationKind,
    action,
    value,
    scope,
    paths: deps.pathsForScope(scope),
    ...(options.guestPath === undefined ? {} : { guestPath: options.guestPath }),
    ...(options.required ? { required: true } : {}),
  };
};
const parseMutation = (name: string, args: string, ctx: CommandContext, deps: Dependencies): MutationRequest => {
  const tokens = tokenize(args);
  const action = tokens.shift();
  const value = tokens.shift();
  if ((action !== "add" && action !== "remove") || !value) {
    const usage = name.startsWith("sandbox-mount-")
      ? `usage: /${name} add HOST [--guest GUEST] [--required] [--scope global|project]; /${name} remove HOST_OR_GUEST [--scope global|project]`
      : `usage: /${name} add|remove VALUE [--scope global|project]`;
    throw new Error(usage);
  }
  let scope: Scope = ctx.isProjectTrusted() ? "project" : "global";
  let guestPath: string | undefined;
  let required = false;
  while (tokens.length > 0) {
    const option = tokens.shift();
    if (option === "--scope") {
      const selected = tokens.shift();
      if (selected !== "global" && selected !== "project") throw new Error("--scope must be global or project");
      scope = selected;
    } else if (option === "--guest" && name.startsWith("sandbox-mount-")) {
      guestPath = tokens.shift();
      if (!guestPath) throw new Error("--guest requires an absolute path");
    } else if (option === "--required" && name.startsWith("sandbox-mount-")) required = true;
    else throw new Error(`unknown option: ${option}`);
  }
  return request(name, action, value, scope, deps, { ...(guestPath === undefined ? {} : { guestPath }), required });
};
const cancel = (ctx: CommandContext): undefined => {
  ctx.ui.notify("Sandbox policy change cancelled", "info");
  return undefined;
};
const promptMutation = async (name: string, ctx: CommandContext, deps: Dependencies): Promise<MutationRequest | undefined> => {
  const mount = name.startsWith("sandbox-mount-");
  const mode = name.endsWith("-ro") ? "read-only mount" : name.endsWith("-rw") ? "read-write mount" : name.endsWith("-allow") ? "network allow rule" : "network deny rule";
  const selectedAction = await ctx.ui.select(`Sandbox ${mode}: action`, ["add", "remove"]);
  if (selectedAction !== "add" && selectedAction !== "remove") return cancel(ctx);
  const value = await ctx.ui.input(
    `Sandbox ${mode}: ${selectedAction === "add" && mount ? "host path" : selectedAction === "remove" && mount ? "exact host or guest path" : "host pattern"}`,
    mount ? "/absolute/path" : "api.example.com or *.example.com",
  );
  if (value === undefined) return cancel(ctx);
  const trimmed = value.trim();
  if (!trimmed) throw new Error("value must not be empty");
  let guestPath: string | undefined;
  let required = false;
  if (mount && selectedAction === "add") {
    const guest = await ctx.ui.input("Guest path (empty = canonical host path)", "/guest/path");
    if (guest === undefined) return cancel(ctx);
    guestPath = guest.trim() || undefined;
    required = await ctx.ui.confirm("Required mount?", "Fail future sandbox startup if this host path is missing?");
  }
  const defaultScope: Scope = ctx.isProjectTrusted() ? "project" : "global";
  const selectedScope = await ctx.ui.select("Policy scope", [defaultScope, defaultScope === "project" ? "global" : "project"]);
  if (selectedScope !== "global" && selectedScope !== "project") return cancel(ctx);
  const result = request(name, selectedAction, trimmed, selectedScope, deps, { ...(guestPath === undefined ? {} : { guestPath }), required });
  const confirmed = await ctx.ui.confirm("Apply sandbox policy change?", `${result.action} ${result.kind}: ${result.value}${result.guestPath ? ` -> ${result.guestPath}` : ""}\nscope=${result.scope}${result.required ? "\nrequired=true" : ""}\nApplies next Pi session/restart.`);
  return confirmed ? result : cancel(ctx);
};

export function registerPolicyCommands(api: PiCommandApi, deps?: Dependencies): void {
  for (const name of POLICY_COMMANDS) {
    api.registerCommand(name, {
      description: name === "sandbox-policy" ? "Show the effective sandbox policy (read-only)"
        : name.startsWith("sandbox-mount-") ? "Add/remove mount policy; no args opens form; active next Pi session/restart"
          : "Add/remove network policy; no args opens form; active next Pi session/restart",
      async handler(args, ctx) {
        requireInteractiveIdle(ctx);
        if (!deps) throw new Error(`${name} requires policy command dependencies`);
        if (name === "sandbox-policy") {
          if (args.trim()) throw new Error("/sandbox-policy accepts no arguments");
          ctx.ui.notify(JSON.stringify(await deps.readPolicy(ctx), null, 2), "info");
          return;
        }
        const mutation = args.trim() ? parseMutation(name, args, ctx, deps) : await promptMutation(name, ctx, deps);
        if (!mutation) return;
        ctx.ui.notify(`scope=${mutation.scope}`, "info");
        const result = await (deps.mutate ?? mutatePolicy)(mutation);
        ctx.ui.notify(result.message, "info");
      },
    });
  }
}
