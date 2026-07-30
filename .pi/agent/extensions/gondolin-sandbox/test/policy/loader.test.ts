import { afterEach, describe, expect, test } from "bun:test";
import { mkdtemp, mkdir, realpath, rm, symlink, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { fingerprintSandbox } from "../../policy/approvals";
import { loadApprovedEffectivePolicy } from "../../policy/loader";

let root: string | undefined;
afterEach(async () => { if (root) await rm(root, { recursive: true, force: true }); root = undefined; });

describe("fail-closed project policy loading", () => {
  test("manual project mutation including deny removal rejects the complete project scope", async () => {
    root = await mkdtemp(join(tmpdir(), "policy-loader-"));
    const globalPath = join(root, "global.json");
    const projectPath = join(root, "project.json");
    const approvalsPath = join(root, "approvals.json");
    const projectId = "/canonical/project";
    const sandbox = { mounts: { readOnly: [], readWrite: [] }, network: { allow: ["*.example.com"], deny: ["blocked.example.com"] } };
    await writeFile(globalPath, JSON.stringify({ unrelated: true, sandbox: { network: { allow: ["global.test"], deny: [] } } }));
    await writeFile(projectPath, JSON.stringify({ other: 7, sandbox }));
    await writeFile(approvalsPath, JSON.stringify({ projects: { [projectId]: { fingerprint: fingerprintSandbox(sandbox) } } }));

    expect((await loadApprovedEffectivePolicy({ globalPath, projectPath, approvalsPath, projectId })).network).toEqual({
      allow: ["*.example.com", "global.test"], deny: ["blocked.example.com"],
    });

    await writeFile(projectPath, JSON.stringify({ other: 7, sandbox: { ...sandbox, network: { ...sandbox.network, deny: [] } } }));
    await expect(loadApprovedEffectivePolicy({ globalPath, projectPath, approvalsPath, projectId }))
      .rejects.toThrow("stale or unapproved project sandbox policy: /canonical/project");
  });

  test("unknown sandbox keys fail configuration loading", async () => {
    root = await mkdtemp(join(tmpdir(), "policy-loader-"));
    const globalPath = join(root, "global.json");
    const projectPath = join(root, "project.json");
    const approvalsPath = join(root, "approvals.json");
    await writeFile(globalPath, JSON.stringify({ sandbox: { surprise: true } }));
    await writeFile(projectPath, JSON.stringify({}));
    await mkdir(join(root, "unused"));
    await expect(loadApprovedEffectivePolicy({ globalPath, projectPath, approvalsPath, projectId: root }))
      .rejects.toThrow("unknown sandbox key: surprise");
  });

  test("missing project file means no project policy", async () => {
    root = await mkdtemp(join(tmpdir(), "policy-loader-"));
    const globalPath = join(root, "global.json");
    await writeFile(globalPath, JSON.stringify({ sandbox: { backend: "qemu" } }));
    expect(await loadApprovedEffectivePolicy({ globalPath, projectPath: join(root, "missing.json"), approvalsPath: join(root, "approvals.json"), projectId: root }))
      .toMatchObject({ backend: "qemu" });
  });

  test("project policy symlinks fail closed during loading", async () => {
    root = await mkdtemp(join(tmpdir(), "policy-loader-"));
    const globalPath = join(root, "global.json");
    const projectPath = join(root, "project.json");
    const target = join(root, "project-target.json");
    await writeFile(globalPath, JSON.stringify({ sandbox: { backend: "qemu" } }));
    await writeFile(target, JSON.stringify({ sandbox: {} }));
    await symlink(target, projectPath);
    await expect(loadApprovedEffectivePolicy({ globalPath, projectPath, approvalsPath: join(root, "approvals.json"), projectId: root }))
      .rejects.toThrow("project settings symlink forbidden");
  });

  test("strictly rejects nested unknown keys, bad types, secrets, image digests, and hostnames", async () => {
    root = await mkdtemp(join(tmpdir(), "policy-loader-"));
    const globalPath = join(root, "global.json");
    const projectPath = join(root, "project.json");
    await writeFile(projectPath, "{}");
    const invalid = [
      { mounts: { surprise: [] } },
      { mounts: { readOnly: [{ hostPath: "/tmp", guestPath: "/x", required: false, surprise: true }] } },
      { backend: "docker" },
      { image: "ubuntu:latest" },
      { workspace: { mode: "maybe" } },
      { environment: { API_TOKEN: "plaintext" } },
      { network: { allow: ["a..b"] } },
      { ssh: { enabled: "yes" } },
    ];
    for (const sandbox of invalid) {
      await writeFile(globalPath, JSON.stringify({ sandbox }));
      await expect(loadApprovedEffectivePolicy({ globalPath, projectPath, approvalsPath: join(root, "approvals.json"), projectId: root })).rejects.toThrow();
    }
  });

  test("realpaths manual hosts, drops missing optional mounts, and rejects missing required mounts", async () => {
    root = await mkdtemp(join(tmpdir(), "policy-loader-"));
    const actual = join(root, "actual");
    const alias = join(root, "alias");
    await mkdir(actual);
    await symlink(actual, alias);
    const globalPath = join(root, "global.json");
    const projectPath = join(root, "project.json");
    await writeFile(projectPath, "{}");
    await writeFile(globalPath, JSON.stringify({ sandbox: { mounts: { readOnly: [
      { hostPath: alias, guestPath: "/actual", required: true },
      { hostPath: join(root, "absent"), guestPath: "/optional", required: false },
    ] } } }));
    expect((await loadApprovedEffectivePolicy({ globalPath, projectPath, approvalsPath: join(root, "approvals.json"), projectId: root })).mounts?.readOnly)
      .toEqual([{ hostPath: await realpath(actual), guestPath: "/actual", required: true }]);
    await writeFile(globalPath, JSON.stringify({ sandbox: { mounts: { readOnly: [
      { hostPath: join(root, "absent"), guestPath: "/required", required: true },
    ] } } }));
    await expect(loadApprovedEffectivePolicy({ globalPath, projectPath, approvalsPath: join(root, "approvals.json"), projectId: root }))
      .rejects.toThrow("required mount host path does not exist");
  });
});
