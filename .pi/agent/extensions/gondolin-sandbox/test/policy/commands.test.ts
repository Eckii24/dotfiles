import { describe, expect, test } from "bun:test";
import { POLICY_COMMANDS, registerPolicyCommands } from "../../policy/commands";

const makeContext = (trusted = true, overrides: Record<string, unknown> = {}) => {
  const notices: string[] = [];
  return {
    notices,
    ctx: {
      mode: "tui", hasUI: true, isIdle: () => true, isProjectTrusted: () => trusted,
      ui: { notify: (message: string) => { notices.push(message); } },
      ...overrides,
    },
  };
};

describe("user-only command surface", () => {
  test("registers every proposed sandbox policy operation only as Pi commands", () => {
    const commands: string[] = [];
    const tools: string[] = [];
    registerPolicyCommands({
      registerCommand: (name) => commands.push(name),
      registerTool: (name) => tools.push(name),
    });
    expect(commands.sort()).toEqual([...POLICY_COMMANDS].sort());
    expect(tools).toEqual([]);
  });

  test("parses mount/network add/remove options, defaults scope from trust, and announces scope before writing", async () => {
    const commands = new Map<string, any>();
    const events: string[] = [];
    registerPolicyCommands({ registerCommand: (name, descriptor) => commands.set(name, descriptor) }, {
      pathsForScope: (scope) => ({ settingsPath: `${scope}.json`, approvalsPath: "a", lockPath: "l", projectId: "p" }),
      mutate: async (request) => { events.push(`write:${request.scope}`); return { scope: request.scope, message: "done" }; },
      readPolicy: async () => ({ backend: "qemu" }),
    });
    const trusted = makeContext(true);
    trusted.ctx.ui.notify = (message: string) => { events.push(`notice:${message}`); trusted.notices.push(message); };
    await commands.get("sandbox-mount-ro").handler("add /host --guest /guest --required", trusted.ctx);
    expect(events[0]).toBe("notice:scope=project");
    expect(events[1]).toBe("write:project");

    const untrusted = makeContext(false);
    await commands.get("sandbox-network-deny").handler("remove blocked.example.com --scope global", untrusted.ctx);
    expect(untrusted.notices[0]).toBe("scope=global");
  });

  test("enforces interactive TUI and idle state before mutation", async () => {
    const commands = new Map<string, any>();
    let writes = 0;
    registerPolicyCommands({ registerCommand: (name, descriptor) => commands.set(name, descriptor) }, {
      pathsForScope: () => ({ settingsPath: "s", approvalsPath: "a", lockPath: "l", projectId: "p" }),
      mutate: async (request) => { writes++; return { scope: request.scope, message: "done" }; },
      readPolicy: async () => ({}),
    });
    await expect(commands.get("sandbox-network-allow").handler("add ok.test", makeContext(true, { mode: "rpc" }).ctx)).rejects.toThrow("interactive TUI");
    await expect(commands.get("sandbox-network-allow").handler("add ok.test", makeContext(true, { isIdle: () => false }).ctx)).rejects.toThrow("idle");
    expect(writes).toBe(0);
  });

  test("sandbox-policy is read-only and displays the effective policy", async () => {
    const commands = new Map<string, any>();
    let writes = 0;
    registerPolicyCommands({ registerCommand: (name, descriptor) => commands.set(name, descriptor) }, {
      pathsForScope: () => ({ settingsPath: "s", approvalsPath: "a", lockPath: "l", projectId: "p" }),
      mutate: async (request) => { writes++; return { scope: request.scope, message: "done" }; },
      readPolicy: async () => ({ backend: "qemu" }),
    });
    const context = makeContext();
    await commands.get("sandbox-policy").handler("", context.ctx);
    expect(context.notices.join("\n")).toContain('"backend": "qemu"');
    expect(writes).toBe(0);
  });
});
