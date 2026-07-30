import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { lstat, mkdtemp, mkdir, readFile, realpath, rm, symlink, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { mutatePolicy } from "../../policy/handlers";
import { fingerprintSandbox } from "../../policy/approvals";

let root: string;
let settingsPath: string;
let approvalsPath: string;
let lockPath: string;
let hostDir: string;

beforeEach(async () => {
  root = await mkdtemp(join(tmpdir(), "policy-handler-"));
  settingsPath = join(root, "settings.json");
  approvalsPath = join(root, "outside", "sandbox-approvals.json");
  lockPath = join(root, ".policy.lock");
  hostDir = join(root, "host-dir");
  await mkdir(hostDir);
  await writeFile(settingsPath, JSON.stringify({ theme: "dark", sandbox: { network: { allow: [], deny: [] } } }, null, 2));
});

afterEach(async () => rm(root, { recursive: true, force: true }));

const paths = () => ({ settingsPath, approvalsPath, lockPath, projectId: root });
const readSettings = async () => JSON.parse(await readFile(settingsPath, "utf8"));

describe("pure policy mutation handlers", () => {
  test("mount add canonicalizes and remove requires an exact normalized match while preserving unrelated JSON", async () => {
    const added = await mutatePolicy({
      kind: "mount-ro", action: "add", value: `${hostDir}/`, guestPath: "/guest/docs/", scope: "global", paths: paths(),
    });
    expect(added).toEqual({ scope: "global", message: "effective next session; restart required" });
    expect(await readSettings()).toEqual({
      theme: "dark",
      sandbox: {
        network: { allow: [], deny: [] },
        mounts: { readOnly: [{ hostPath: await realpath(hostDir), guestPath: "/guest/docs", required: false }] },
      },
    });

    await expect(mutatePolicy({
      kind: "mount-ro", action: "remove", value: "/guest", scope: "global", paths: paths(),
    })).rejects.toThrow("exact normalized mount not found");

    await mutatePolicy({ kind: "mount-ro", action: "remove", value: "/guest/docs/", scope: "global", paths: paths() });
    expect((await readSettings()).sandbox.mounts.readOnly).toEqual([]);
  });

  test("all network handlers normalize, deduplicate, exactly remove, and project writes record full-section approval", async () => {
    await mkdir(join(root, "outside"), { recursive: true });
    const initial = await readSettings();
    await writeFile(approvalsPath, JSON.stringify({ projects: { [root]: { fingerprint: fingerprintSandbox(initial.sandbox) } } }));
    await mutatePolicy({ kind: "network-allow", action: "add", value: " GitHub.COM. ", scope: "project", paths: paths() });
    await mutatePolicy({ kind: "network-allow", action: "add", value: "github.com", scope: "project", paths: paths() });
    await mutatePolicy({ kind: "network-deny", action: "add", value: " BLOCKED.Example.COM ", scope: "project", paths: paths() });

    const settings = await readSettings();
    expect(settings.theme).toBe("dark");
    expect(settings.sandbox.network).toEqual({ allow: ["github.com"], deny: ["blocked.example.com"] });
    const approvals = JSON.parse(await readFile(approvalsPath, "utf8"));
    expect(approvals.projects[root].fingerprint).toBe(fingerprintSandbox(settings.sandbox));

    await expect(mutatePolicy({ kind: "network-deny", action: "remove", value: "example.com", scope: "project", paths: paths() }))
      .rejects.toThrow("exact normalized network rule not found");
    await mutatePolicy({ kind: "network-deny", action: "remove", value: "blocked.example.com.", scope: "project", paths: paths() });
    expect((await readSettings()).sandbox.network.deny).toEqual([]);
  });

  test("lock contention and interrupted project pair leave settings and approvals unchanged", async () => {
    await mkdir(join(root, "outside"), { recursive: true });
    const initialApprovals = { unrelated: { keep: true }, projects: { [root]: { fingerprint: fingerprintSandbox((await readSettings()).sandbox) } } };
    await writeFile(approvalsPath, JSON.stringify(initialApprovals, null, 2));
    const beforeSettings = await readFile(settingsPath, "utf8");
    const beforeApprovals = await readFile(approvalsPath, "utf8");

    await expect(mutatePolicy({
      kind: "network-allow", action: "add", value: "new.test", scope: "project", paths: paths(),
      hooks: { afterSettingsCommit: () => { throw new Error("injected interruption"); } },
    })).rejects.toThrow("injected interruption");
    expect(await readFile(settingsPath, "utf8")).toBe(beforeSettings);
    expect(await readFile(approvalsPath, "utf8")).toBe(beforeApprovals);

    await mkdir(lockPath);
    await expect(mutatePolicy({ kind: "network-allow", action: "add", value: "locked.test", scope: "global", paths: paths() }))
      .rejects.toThrow("policy lock contention");
    expect(await readFile(settingsPath, "utf8")).toBe(beforeSettings);
  });

  test("rejects an unapproved or stale project baseline before mutation", async () => {
    const before = await readFile(settingsPath, "utf8");
    await expect(mutatePolicy({ kind: "network-allow", action: "add", value: "wanted.test", scope: "project", paths: paths() }))
      .rejects.toThrow("stale or unapproved project sandbox policy");
    expect(await readFile(settingsPath, "utf8")).toBe(before);
    await mkdir(join(root, "outside"), { recursive: true });
    await writeFile(approvalsPath, JSON.stringify({ projects: { [root]: { fingerprint: fingerprintSandbox({ network: { allow: ["old.test"], deny: [] } }) } } }));
    await expect(mutatePolicy({ kind: "network-allow", action: "add", value: "wanted.test", scope: "project", paths: paths() }))
      .rejects.toThrow("stale or unapproved project sandbox policy");
  });

  test("rejects mount guest collisions before any write", async () => {
    await mutatePolicy({ kind: "mount-ro", action: "add", value: hostDir, guestPath: "/same", scope: "global", paths: paths() });
    const before = await readFile(settingsPath, "utf8");
    await expect(mutatePolicy({ kind: "mount-rw", action: "add", value: hostDir, guestPath: "/same", scope: "global", paths: paths() }))
      .rejects.toThrow("mount guest-path conflict: /same");
    expect(await readFile(settingsPath, "utf8")).toBe(before);
  });

  test("global writes update only the exact one-hop in-agent yadm target and preserve the symlink", async () => {
    const agentDir = join(root, "agent");
    await mkdir(agentDir);
    const link = join(agentDir, "settings.json");
    const target = join(agentDir, "settings##os.Linux.json");
    await writeFile(target, JSON.stringify({ sandbox: { network: { allow: [], deny: [] } } }));
    await symlink("settings##os.Linux.json", link);
    const symlinkPaths = { ...paths(), settingsPath: link, globalAgentDir: agentDir, expectedGlobalTarget: target };
    await mutatePolicy({ kind: "network-allow", action: "add", value: "ok.test", scope: "global", paths: symlinkPaths });
    expect((await lstat(link)).isSymbolicLink()).toBe(true);
    expect(JSON.parse(await readFile(target, "utf8")).sandbox.network.allow).toEqual(["ok.test"]);

    const outside = join(root, "outside-target.json");
    await writeFile(outside, await readFile(target, "utf8"));
    await rm(link);
    await symlink(outside, link);
    await expect(mutatePolicy({ kind: "network-allow", action: "add", value: "bad.test", scope: "global", paths: symlinkPaths }))
      .rejects.toThrow("outside agent directory");

    const hop = join(agentDir, "hop.json");
    await rm(link);
    await symlink("hop.json", link);
    await symlink("settings##os.Linux.json", hop);
    await expect(mutatePolicy({ kind: "network-allow", action: "add", value: "bad.test", scope: "global", paths: symlinkPaths }))
      .rejects.toThrow("multi-hop global settings symlink");
  });

  test("always rejects project settings symlinks", async () => {
    const target = join(root, "project-target.json");
    await writeFile(target, await readFile(settingsPath, "utf8"));
    await rm(settingsPath);
    await symlink(target, settingsPath);
    await expect(mutatePolicy({ kind: "network-allow", action: "add", value: "no.test", scope: "project", paths: paths() }))
      .rejects.toThrow("project settings symlink forbidden");
  });

  test("validates the complete existing sandbox schema before a global write", async () => {
    await writeFile(settingsPath, JSON.stringify({ sandbox: { network: { allow: [], deny: [], surprise: true } } }));
    const before = await readFile(settingsPath, "utf8");
    await expect(mutatePolicy({ kind: "network-allow", action: "add", value: "ok.test", scope: "global", paths: paths() }))
      .rejects.toThrow("unknown network key: surprise");
    expect(await readFile(settingsPath, "utf8")).toBe(before);
  });
});
