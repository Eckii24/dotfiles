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
        select: async () => undefined,
        input: async () => undefined,
        confirm: async () => false,
      },
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
    await commands.get("sandbox-mount-ro").handler('add "/host reference" --guest "/guest reference" --required --scope global', trusted.ctx);
    expect(events[0]).toBe("notice:scope=global");
    expect(events[1]).toBe("write:global");

    const untrusted = makeContext(false);
    await commands.get("sandbox-network-deny").handler("remove blocked.example.com --scope global", untrusted.ctx);
    expect(untrusted.notices[0]).toBe("scope=global");
  });

  test("mount grammar is explicit, absolute, and accepts exact host or guest removal", async () => {
    const commands = new Map<string, any>();
    let mutation: any;
    registerPolicyCommands({ registerCommand: (name, descriptor) => commands.set(name, descriptor) }, {
      pathsForScope: () => ({ settingsPath: "s", approvalsPath: "a", lockPath: "l", projectId: "p" }),
      mutate: async (request) => { mutation = request; return { scope: "global", message: "done" }; }, readPolicy: async () => ({}),
    });
    await expect(commands.get("sandbox-mount-ro").handler("/host /guest", makeContext().ctx)).rejects.toThrow("remove HOST_OR_GUEST");
    await expect(commands.get("sandbox-mount-ro").handler("add ~/docs", makeContext().ctx)).rejects.toThrow("must be absolute");
    await expect(commands.get("sandbox-mount-ro").handler("add /host --guest relative", makeContext().ctx)).rejects.toThrow("--guest requires an absolute path");
    await commands.get("sandbox-mount-ro").handler("remove /host", makeContext().ctx);
    expect(mutation.value).toBe("/host");
    expect(commands.get("sandbox-mount-ro").description).toContain("next Pi session/restart");
  });

  test("no-arg mount/network commands use guided forms; cancellation writes nothing", async () => {
    const commands = new Map<string, any>(); const mutations: any[] = [];
    registerPolicyCommands({ registerCommand: (name, descriptor) => commands.set(name, descriptor) }, {
      pathsForScope: (scope) => ({ settingsPath: `${scope}.json`, approvalsPath: "a", lockPath: "l", projectId: "p" }),
      mutate: async (request) => { mutations.push(request); return { scope: request.scope, message: "done" }; }, readPolicy: async () => ({}),
    });
    const mount = makeContext(true); const mountSelect = ["add", "global"]; const mountInput = ["/host", "/guest"]; const mountConfirm = [true, true];
    mount.ctx.ui.select = async () => mountSelect.shift(); mount.ctx.ui.input = async () => mountInput.shift(); mount.ctx.ui.confirm = async () => mountConfirm.shift() ?? false;
    await commands.get("sandbox-mount-rw").handler("", mount.ctx);
    expect(mutations[0]).toMatchObject({ kind: "mount-rw", action: "add", value: "/host", guestPath: "/guest", required: true, scope: "global" });
    expect(mount.notices).toEqual(["scope=global", "done"]);

    const network = makeContext(true); const networkSelect = ["remove", "project"]; const networkInput = ["blocked.example.com"]; const networkConfirm = [true];
    network.ctx.ui.select = async () => networkSelect.shift(); network.ctx.ui.input = async () => networkInput.shift(); network.ctx.ui.confirm = async () => networkConfirm.shift() ?? false;
    await commands.get("sandbox-network-deny").handler("   ", network.ctx);
    expect(mutations[1]).toMatchObject({ kind: "network-deny", action: "remove", value: "blocked.example.com", scope: "project" });

    const cancelled = makeContext();
    await commands.get("sandbox-mount-ro").handler("", cancelled.ctx);
    expect(mutations).toHaveLength(2); expect(cancelled.notices).toEqual(["Sandbox policy change cancelled"]);
  });

  test("nonblank arguments bypass form prompts", async () => {
    const commands = new Map<string, any>(); let mutation: any;
    registerPolicyCommands({ registerCommand: (name, descriptor) => commands.set(name, descriptor) }, {
      pathsForScope: () => ({ settingsPath: "s", approvalsPath: "a", lockPath: "l", projectId: "p" }),
      mutate: async (request) => { mutation = request; return { scope: request.scope, message: "done" }; }, readPolicy: async () => ({}),
    });
    const context = makeContext(false); context.ctx.ui.select = async () => { throw new Error("form must not open"); };
    await commands.get("sandbox-network-allow").handler("add api.example.com --scope global", context.ctx);
    expect(mutation).toMatchObject({ action: "add", value: "api.example.com", scope: "global" });
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
