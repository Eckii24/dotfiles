import { mutatePolicy, type MutationKind, type MutationPaths, type MutationRequest } from "./handlers";
import type { SandboxPolicy } from "./policy";

export const POLICY_COMMANDS = [
  "sandbox-mount-ro",
  "sandbox-mount-rw",
  "sandbox-network-allow",
  "sandbox-network-deny",
  "sandbox-policy",
] as const;

type CommandContext = {
  mode: string;
  hasUI: boolean;
  isIdle: () => boolean;
  isProjectTrusted: () => boolean;
  ui: { notify: (message: string, level?: "info" | "warning" | "error") => unknown };
};
type PiCommandApi = {
  registerCommand: (name: string, descriptor: { description?: string; handler: (args: string, ctx: CommandContext) => Promise<void> }) => void;
};
type Dependencies = {
  pathsForScope: (scope: "global" | "project") => MutationPaths;
  readPolicy: (ctx: CommandContext) => Promise<SandboxPolicy>;
  mutate?: (request: MutationRequest) => Promise<{ scope: "global" | "project"; message: string }>;
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
const parseMutation = (name: string, args: string, ctx: CommandContext, deps: Dependencies): MutationRequest => {
  const tokens = tokenize(args);
  const action = tokens.shift();
  const value = tokens.shift();
  if ((action !== "add" && action !== "remove") || !value) throw new Error(`usage: /${name} add|remove VALUE [options]`);
  let scope: "global" | "project" = ctx.isProjectTrusted() ? "project" : "global";
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
  if (action === "remove" && (guestPath !== undefined || required)) throw new Error("remove does not accept --guest or --required");
  const kind = name.replace(/^sandbox-/, "") as MutationKind;
  return {
    kind, action, value, scope, paths: deps.pathsForScope(scope),
    ...(guestPath === undefined ? {} : { guestPath }),
    ...(required ? { required: true } : {}),
  };
};

export function registerPolicyCommands(api: PiCommandApi, deps?: Dependencies): void {
  for (const name of POLICY_COMMANDS) {
    api.registerCommand(name, {
      description: name === "sandbox-policy" ? "Show the effective sandbox policy (read-only)" : "Mutate user-approved sandbox policy",
      async handler(args, ctx) {
        requireInteractiveIdle(ctx);
        if (!deps) throw new Error(`${name} requires policy command dependencies`);
        if (name === "sandbox-policy") {
          if (args.trim()) throw new Error("/sandbox-policy accepts no arguments");
          ctx.ui.notify(JSON.stringify(await deps.readPolicy(ctx), null, 2), "info");
          return;
        }
        const request = parseMutation(name, args, ctx, deps);
        ctx.ui.notify(`scope=${request.scope}`, "info");
        const result = await (deps.mutate ?? mutatePolicy)(request);
        ctx.ui.notify(result.message, "info");
      },
    });
  }
}
