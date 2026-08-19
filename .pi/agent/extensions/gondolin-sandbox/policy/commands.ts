import { isAbsolute } from "node:path";
import { mutatePolicy, type MutationKind, type MutationPaths, type MutationRequest } from "./handlers";
import type { SandboxPolicy } from "./policy";

export const POLICY_COMMANDS = ["sandbox"] as const;

type Scope = "global" | "project";
type CommandContext = {
  mode: string;
  hasUI: boolean;
  isIdle: () => boolean;
  isProjectTrusted: () => boolean;
  ui: {
    notify: (message: string, level?: "info" | "warning" | "error") => unknown;
    select?: (title: string, options: string[]) => Promise<string | undefined>;
    input?: (title: string, placeholder?: string) => Promise<string | undefined>;
    confirm?: (title: string, message: string) => Promise<boolean>;
  };
};
type PiCommandApi = {
  registerCommand: (name: string, descriptor: {
    description?: string;
    getArgumentCompletions?: (prefix: string) => Array<{ value: string; label: string; description: string }> | null;
    handler: (args: string, ctx: CommandContext) => Promise<void>;
  }) => void;
};
type Dependencies = {
  pathsForScope: (scope: Scope) => MutationPaths;
  readPolicy: (ctx: CommandContext) => Promise<SandboxPolicy>;
  showStatus?: (ctx: CommandContext) => Promise<void>;
  mutate?: (request: MutationRequest) => Promise<{ scope: Scope; message: string }>;
};

const HELP = `Sandbox commands:
/sandbox                         show status and navigation
/sandbox status                  show status and navigation
/sandbox help                   show this help
/sandbox policy show            show effective policy
/sandbox mount help             show mount syntax
/sandbox mount ro|rw help       show read-only/read-write mount syntax
/sandbox mount ro|rw add HOST [--guest GUEST] [--required] [--scope global|project]
/sandbox mount ro|rw remove HOST_OR_GUEST [--scope global|project]
/sandbox network help           show network syntax
/sandbox network allow|deny add|remove HOST_PATTERN [--scope global|project]`;
const MOUNT_HELP = `/sandbox mount ro|rw add HOST [--guest GUEST] [--required] [--scope global|project]
/sandbox mount ro|rw remove HOST_OR_GUEST [--scope global|project]
HOST and GUEST must be absolute. Changes apply next Pi session/restart.`;
const NETWORK_HELP = `/sandbox network allow|deny add|remove HOST_PATTERN [--scope global|project]
Changes apply next Pi session/restart.`;

const tokenize = (input: string): string[] => {
  const tokens: string[] = [];
  const pattern = /"([^"\\]*(?:\\.[^"\\]*)*)"|'([^']*)'|([^\s]+)/g;
  let match: RegExpExecArray | null;
  while ((match = pattern.exec(input)) !== null) tokens.push((match[1] ?? match[2] ?? match[3] ?? "").replace(/\\"/g, '"'));
  if (tokens.join("").length === 0 && input.trim().length > 0) throw new Error("invalid command arguments");
  return tokens;
};

const requireInteractiveIdle = (ctx: CommandContext): void => {
  if (ctx.mode !== "tui" || !ctx.hasUI) throw new Error("sandbox policy changes require an interactive TUI");
  if (!ctx.isIdle()) throw new Error("sandbox policy changes require the agent to be idle");
};

const mutationRequest = (
  kind: MutationKind,
  action: "add" | "remove",
  value: string,
  scope: Scope,
  deps: Dependencies,
  options: { guestPath?: string; required?: boolean } = {},
): MutationRequest => {
  const mount = kind.startsWith("mount-");
  if (mount && !isAbsolute(value)) throw new Error("mount host path must be absolute; Pi does not expand ~ or variables");
  if (options.guestPath !== undefined && (!mount || !isAbsolute(options.guestPath))) throw new Error("--guest requires an absolute path");
  if (action === "remove" && (options.guestPath !== undefined || options.required)) throw new Error("remove does not accept --guest or --required");
  return {
    kind, action, value, scope,
    paths: deps.pathsForScope(scope),
    ...(options.guestPath === undefined ? {} : { guestPath: options.guestPath }),
    ...(options.required ? { required: true } : {}),
  };
};

const parseOptions = (tokens: string[], kind: MutationKind, action: "add" | "remove", ctx: CommandContext): { scope: Scope; guestPath?: string; required?: boolean } => {
  const mount = kind.startsWith("mount-");
  let scope: Scope = ctx.isProjectTrusted() ? "project" : "global";
  let guestPath: string | undefined;
  let required = false;
  while (tokens.length > 0) {
    const option = tokens.shift();
    if (option === "--scope") {
      const selected = tokens.shift();
      if (selected !== "global" && selected !== "project") throw new Error("--scope must be global or project");
      if (selected === "project" && !ctx.isProjectTrusted()) throw new Error("project scope requires Pi trust");
      scope = selected;
    } else if (option === "--guest" && mount && action === "add") {
      guestPath = tokens.shift();
      if (!guestPath) throw new Error("--guest requires an absolute path");
    } else if (option === "--required" && mount && action === "add") {
      required = true;
    } else {
      throw new Error(`unknown option: ${option}`);
    }
  }
  return { scope, ...(guestPath === undefined ? {} : { guestPath }), ...(required ? { required: true } : {}) };
};

const parseMutation = (tokens: string[], kind: MutationKind, ctx: CommandContext, deps: Dependencies): MutationRequest => {
  const action = tokens.shift();
  const value = tokens.shift();
  if ((action !== "add" && action !== "remove") || !value) throw new Error(`usage: ${kind.startsWith("mount-") ? MOUNT_HELP : NETWORK_HELP}`);
  const options = parseOptions(tokens, kind, action, ctx);
  return mutationRequest(kind, action, value, options.scope, deps, options);
};

const showPolicy = async (ctx: CommandContext, deps: Dependencies): Promise<void> => {
  ctx.ui.notify(JSON.stringify(await deps.readPolicy(ctx), null, 2), "info");
};

export function registerPolicyCommands(api: PiCommandApi, deps?: Dependencies): void {
  api.registerCommand("sandbox", {
    description: "Show sandbox status, policy, mounts, or network rules",
    getArgumentCompletions(prefix) {
      const values = [
        ["status", "Show runtime state and navigation"], ["help", "Show full command syntax"], ["policy show", "Show effective policy"],
        ["mount help", "Show mount syntax"], ["mount ro", "Read-only mount rules"], ["mount rw", "Read-write mount rules"],
        ["mount ro add", "Add read-only mount"], ["mount ro remove", "Remove read-only mount"],
        ["mount rw add", "Add read-write mount"], ["mount rw remove", "Remove read-write mount"],
        ["network help", "Show network syntax"], ["network allow add", "Allow network host pattern"], ["network allow remove", "Remove allowed host pattern"],
        ["network deny add", "Deny network host pattern"], ["network deny remove", "Remove denied host pattern"],
      ] as const;
      const normalized = prefix.trimStart().toLowerCase();
      const matches = values.filter(([value]) => value.startsWith(normalized));
      return matches.length ? matches.map(([value, description]) => ({ value, label: value, description })) : null;
    },
    async handler(args, ctx) {
      const tokens = tokenize(args);
      const section = tokens.shift();
      if (!section || section === "status") {
        if (tokens.length) throw new Error("usage: /sandbox status");
        if (!deps) throw new Error("sandbox requires policy command dependencies");
        if (deps.showStatus) await deps.showStatus(ctx);
        else await showPolicy(ctx, deps);
        return;
      }
      if (section === "help") {
        if (tokens.length) throw new Error("usage: /sandbox help");
        ctx.ui.notify(HELP, "info");
        return;
      }
      if (!deps) throw new Error("sandbox requires policy command dependencies");
      if (section === "policy") {
        if (tokens.shift() !== "show" || tokens.length) throw new Error("usage: /sandbox policy show");
        await showPolicy(ctx, deps);
        return;
      }
      if (section === "mount") {
        const mode = tokens.shift();
        if (mode === "help" && tokens.length === 0) {
          ctx.ui.notify(MOUNT_HELP, "info");
          return;
        }
        if (mode !== "ro" && mode !== "rw") throw new Error("usage: /sandbox mount ro|rw add|remove ...; /sandbox mount help");
        if (tokens[0] === "help") {
          tokens.shift();
          if (tokens.length) throw new Error("usage: /sandbox mount ro|rw help");
          ctx.ui.notify(MOUNT_HELP, "info");
          return;
        }
        requireInteractiveIdle(ctx);
        const mutation = parseMutation(tokens, `mount-${mode}`, ctx, deps);
        ctx.ui.notify(`scope=${mutation.scope}`, "info");
        const result = await (deps.mutate ?? mutatePolicy)(mutation);
        ctx.ui.notify(result.message, "info");
        return;
      }
      if (section === "network") {
        const mode = tokens.shift();
        if (mode === "help" && tokens.length === 0) {
          ctx.ui.notify(NETWORK_HELP, "info");
          return;
        }
        if (mode !== "allow" && mode !== "deny") throw new Error("usage: /sandbox network allow|deny add|remove ...; /sandbox network help");
        requireInteractiveIdle(ctx);
        const mutation = parseMutation(tokens, `network-${mode}`, ctx, deps);
        ctx.ui.notify(`scope=${mutation.scope}`, "info");
        const result = await (deps.mutate ?? mutatePolicy)(mutation);
        ctx.ui.notify(result.message, "info");
        return;
      }
      throw new Error("unknown sandbox command; use /sandbox help");
    },
  });
}