import assert from "node:assert/strict";
import test from "node:test";
import { buildVmOptions, SSH_UNSUPPORTED_DIAGNOSTIC } from "../../index.ts";

const policy = {
  image: "registry.example/pi-agent@sha256:aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
  workspace: { mode: "ro" as const },
  mounts: {
    readOnly: [{ hostPath: "/host/reference", guestPath: "/reference" }],
    readWrite: [{ hostPath: "/host/cache", guestPath: "/cache" }],
  },
  environment: { HOME: "/home/agent", REPO_PATH: "/work" },
  network: { allow: ["github.com", "*.githubusercontent.com"], deny: ["github.com"] },
};

test("effective policy becomes fail-closed VM options with readonly providers and guest-only environment", async () => {
  const options = buildVmOptions(policy, "/host/repo", "fallback@sha256:bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb", "qemu");

  assert.equal(options.sandbox?.imagePath, policy.image);
  assert.equal(options.sandbox?.vmm, "qemu");
  assert.deepEqual(options.env, policy.environment);
  assert.equal(await options.httpHooks?.isRequestAllowed?.(new Request("https://github.com/repo")), false);
  assert.equal(await options.httpHooks?.isRequestAllowed?.(new Request("https://api.githubusercontent.com/repo")), true);
  assert.ok(options.vfs?.mounts?.["/workspace"]);
  assert.equal((options.vfs?.mounts?.["/workspace"] as any).readonly, true);
  assert.ok(options.vfs?.mounts?.["/reference"]);
  assert.equal((options.vfs?.mounts?.["/reference"] as any).readonly, true);
  assert.ok(options.vfs?.mounts?.["/cache"]);
  assert.notEqual((options.vfs?.mounts?.["/cache"] as any).readonly, true);
});

test("workspace none omits the host cwd and workspace rw uses a writable provider", () => {
  const none = buildVmOptions({ workspace: { mode: "none" } }, "/host/repo", "image", "qemu");
  assert.equal(none.vfs?.mounts?.["/workspace"], undefined);

  const writable = buildVmOptions({ workspace: { mode: "rw" } }, "/host/repo", "image", "qemu");
  assert.ok(writable.vfs?.mounts?.["/workspace"]);
});

test("ssh.enabled fails closed without a verified keyless mediation configuration", () => {
  assert.throws(
    () => buildVmOptions({ ssh: { enabled: true } }, "/host/repo", "image", "qemu"),
    new RegExp(SSH_UNSUPPORTED_DIAGNOSTIC),
  );
});
