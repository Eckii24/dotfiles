import { afterEach, describe, expect, test } from "bun:test";
import { mkdir, mkdtemp, realpath, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  MAX_SANDBOX_SESSION_POLICY_BYTES,
  parseSerializedSessionPolicy,
  parseStartupPolicyFlags,
  serializeSessionPolicy,
} from "../../policy/startup";

let root: string | undefined;
afterEach(async () => { if (root) await rm(root, { recursive: true, force: true }); root = undefined; });
const fixture = async () => {
  root = await mkdtemp(join(tmpdir(), "gondolin-startup-"));
  const one = join(root, "one"); const two = join(root, "two");
  await mkdir(one); await mkdir(two);
  return { one, two };
};

describe("session startup policy", () => {
  test("accepts scalar and JSON-array flags, canonicalizes mounts, and normalizes network rules", async () => {
    const { one, two } = await fixture();
    const policy = await parseStartupPolicyFlags({
      "sandbox-mount-ro": one,
      "sandbox-mount-rw": JSON.stringify([{ hostPath: two, guestPath: "/deps", required: true }]),
      "sandbox-network-allow": JSON.stringify(["API.Example.COM.", "*.example.org"]),
      "sandbox-network-deny": "blocked.example.org",
    });
    expect(policy.mounts).toEqual({
      readOnly: [{ hostPath: await realpath(one), guestPath: await realpath(one), required: false }],
      readWrite: [{ hostPath: await realpath(two), guestPath: "/deps", required: true }],
    });
    expect(policy.network).toEqual({ allow: ["*.example.org", "api.example.com"], deny: ["blocked.example.org"] });
    const serialized = serializeSessionPolicy(policy);
    expect(serialized).toBeDefined();
    expect(await parseSerializedSessionPolicy(serialized)).toEqual(policy);
  });

  test("rejects empty/malformed arrays, unknown mount keys, bad paths, bad hosts, and guest collisions", async () => {
    const { one, two } = await fixture();
    await expect(parseStartupPolicyFlags({ "sandbox-mount-ro": "[]" })).rejects.toThrow("non-empty array");
    await expect(parseStartupPolicyFlags({ "sandbox-mount-ro": "[" })).rejects.toThrow("invalid JSON");
    await expect(parseStartupPolicyFlags({ "sandbox-mount-ro": JSON.stringify([{ hostPath: one, surprise: true }]) })).rejects.toThrow("unknown");
    await expect(parseStartupPolicyFlags({ "sandbox-mount-ro": "relative" })).rejects.toThrow("absolute");
    await expect(parseStartupPolicyFlags({ "sandbox-mount-ro": join(one, "missing") })).rejects.toThrow("does not exist");
    await expect(parseStartupPolicyFlags({ "sandbox-network-allow": "not-a-host" })).rejects.toThrow("invalid host pattern");
    await expect(parseStartupPolicyFlags({
      "sandbox-mount-ro": JSON.stringify([{ hostPath: one, guestPath: "/same" }]),
      "sandbox-mount-rw": JSON.stringify([{ hostPath: two, guestPath: "/same" }]),
    })).rejects.toThrow("guest-path conflict");
  });

  test("strictly validates bounded inherited overlays", async () => {
    await expect(parseSerializedSessionPolicy("not-json")).rejects.toThrow("invalid JSON");
    await expect(parseSerializedSessionPolicy(JSON.stringify({ backend: "qemu" }))).rejects.toThrow("unknown inherited sandbox session policy key");
    await expect(parseSerializedSessionPolicy(JSON.stringify({ network: { allow: ["bad"] } }))).rejects.toThrow("invalid host pattern");
    await expect(parseSerializedSessionPolicy("x".repeat(MAX_SANDBOX_SESSION_POLICY_BYTES + 1))).rejects.toThrow("64KB");
    expect(serializeSessionPolicy({})).toBeUndefined();
  });
});
