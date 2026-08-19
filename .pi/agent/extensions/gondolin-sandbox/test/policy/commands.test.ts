import { describe, expect, test } from "bun:test";
import { POLICY_COMMANDS, registerPolicyCommands } from "../../policy/commands";

const makeContext = (trusted = true, overrides: Record<string, unknown> = {}) => {
  const notices: string[] = [];
  return {
    notices,
    ctx: {
      mode: "tui", hasUI: true, isIdle: () => true, isProjectTrusted: () => trusted,
      ui: {
        notify: (message: string) => { notices.push(message); },
      },
      ...overrides,
    },
  };
};

const setup = () => {
  const commands = new Map<string, any>();
  let mutation: any;
  registerPolicyCommands({ registerCommand: (name, descriptor) => commands.set(name, descriptor) }, {
    pathsForScope: (scope) => ({ settingsPath: `${scope}.json`, approvalsPath: "a", lockPath: "l", projectId: "p" }),
    mutate: async (request) => { mutation = request; return { scope: request.scope, message: "effective next session; restart required" }; },
    readPolicy: async () => ({ backend: "qemu" }),
  });
  return { commands, get mutation() { return mutation; } };
};

describe("unified sandbox command surface", () => {
  test("registers only /sandbox as a Pi command", () => {
    const commands: string[] = [];
    registerPolicyCommands({ registerCommand: (name) => commands.push(name) });
    expect(commands).toEqual([...POLICY_COMMANDS]);
  });

  test("no args is status, help and policy show are read-only navigation", async () => {
    const { commands } = setup();
    const context = makeContext();
    await commands.get("sandbox").handler("", context.ctx);
    expect(context.notices.join("\n")).toContain('"backend": "qemu"');
    await commands.get("sandbox").handler("help", context.ctx);
    expect(context.notices.at(-1)).toContain("/sandbox mount ro|rw add HOST");
    await commands.get("sandbox").handler("policy show", context.ctx);
    expect(context.notices.at(-1)).toContain('"backend": "qemu"');
  });

  test("parses canonical mount and network mutations, quoting paths and defaulting scope", async () => {
    const sandbox = setup();
    const context = makeContext(true);
    await sandbox.commands.get("sandbox").handler('mount ro add "/host reference" --guest "/guest reference" --required --scope global', context.ctx);
    expect(sandbox.mutation).toMatchObject({ kind: "mount-ro", action: "add", value: "/host reference", guestPath: "/guest reference", required: true, scope: "global" });
    await sandbox.commands.get("sandbox").handler("network deny remove blocked.example.com --scope global", context.ctx);
    expect(sandbox.mutation).toMatchObject({ kind: "network-deny", action: "remove", value: "blocked.example.com", scope: "global" });
  });

  test("rejects old syntax and validates mount grammar", async () => {
    const { commands } = setup();
    const context = makeContext(false);
    await expect(commands.get("sandbox").handler("sandbox-mount-ro add /host", context.ctx)).rejects.toThrow("unknown sandbox command");
    await expect(commands.get("sandbox").handler("mount ro add ~/docs", context.ctx)).rejects.toThrow("must be absolute");
    await expect(commands.get("sandbox").handler("mount ro add /host --guest relative", context.ctx)).rejects.toThrow("--guest requires an absolute path");
    await expect(commands.get("sandbox").handler("mount ro remove /host --required", context.ctx)).rejects.toThrow("unknown option");
    await expect(commands.get("sandbox").handler("network allow add ok.test --scope project", context.ctx)).rejects.toThrow("project scope requires Pi trust");
  });

  test("policy changes require interactive idle TUI; help remains read-only", async () => {
    const { commands } = setup();
    await expect(commands.get("sandbox").handler("network allow add ok.test", makeContext(true, { mode: "rpc" }).ctx)).rejects.toThrow("interactive TUI");
    await expect(commands.get("sandbox").handler("network allow add ok.test", makeContext(true, { isIdle: () => false }).ctx)).rejects.toThrow("idle");
    const rpc = makeContext(true, { mode: "rpc" });
    await commands.get("sandbox").handler("help", rpc.ctx);
    expect(rpc.notices[0]).toContain("Sandbox commands:");
  });

  test("mount and network help are available without mutation", async () => {
    const { commands } = setup();
    const context = makeContext();
    for (const args of ["mount help", "mount ro help", "mount rw help", "network help"]) {
      await commands.get("sandbox").handler(args, context.ctx);
    }
    expect(context.notices).toHaveLength(4);
    expect(context.notices.at(-1)).toContain("/sandbox network allow|deny");
  });
});
