import { describe, expect, test } from "bun:test";
import { isNetworkAllowed, mergePolicies } from "../../policy/policy";

const mount = (hostPath: string, guestPath: string) => ({ hostPath, guestPath, required: false });

describe("scoped policy merge", () => {
  test("additively normalizes and deterministically deduplicates mounts and network rules", () => {
    const global = {
      mounts: { readOnly: [mount("/host/docs/", "/docs/")], readWrite: [] },
      network: { allow: [" GITHUB.COM ", "*.example.com"], deny: [] },
    };
    const project = {
      mounts: { readOnly: [mount("/host/docs", "/docs"), mount("/host/src", "/src")], readWrite: [] },
      network: { allow: ["github.com", "api.example.com"], deny: [] },
    };

    expect(mergePolicies(global, project)).toEqual({
      mounts: {
        readOnly: [mount("/host/docs", "/docs"), mount("/host/src", "/src")],
        readWrite: [],
      },
      network: { allow: ["*.example.com", "api.example.com", "github.com"], deny: [] },
    });
  });

  test("deny rules take precedence over exact and wildcard allows", () => {
    const effective = mergePolicies(
      { network: { allow: ["*.example.com", "safe.test"], deny: [] } },
      { network: { allow: [], deny: ["blocked.example.com", "safe.test"] } },
    );

    expect(isNetworkAllowed("blocked.example.com", effective)).toBe(false);
    expect(isNetworkAllowed("other.example.com", effective)).toBe(true);
    expect(isNetworkAllowed("safe.test", effective)).toBe(false);
    expect(isNetworkAllowed("unknown.test", effective)).toBe(false);
  });

  test("rejects a guest-path collision with a different host or mode", () => {
    expect(() => mergePolicies(
      { mounts: { readOnly: [mount("/host/a", "/same")], readWrite: [] } },
      { mounts: { readOnly: [mount("/host/b", "/same")], readWrite: [] } },
    )).toThrow("mount guest-path conflict: /same");

    expect(() => mergePolicies(
      { mounts: { readOnly: [mount("/host/a", "/same")], readWrite: [] } },
      { mounts: { readOnly: [], readWrite: [mount("/host/a", "/same")] } },
    )).toThrow("mount guest-path conflict: /same");
  });

  test("merges identical mounts once with required true winning", () => {
    const effective = mergePolicies(
      { mounts: { readOnly: [{ hostPath: "/host/a", guestPath: "/same", required: false }] } },
      { mounts: { readOnly: [{ hostPath: "/host/a", guestPath: "/same", required: true }] } },
    );
    expect(effective.mounts?.readOnly).toEqual([{ hostPath: "/host/a", guestPath: "/same", required: true }]);
  });

  test("retains and project-overrides every non-additive policy section", () => {
    expect(mergePolicies(
      { backend: "qemu", image: "base@sha256:aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa", workspace: { mode: "ro" }, environment: { SAFE: "global" }, ssh: { enabled: false } },
      { backend: "krun", workspace: { mode: "rw" }, environment: { OTHER: "project" }, ssh: { enabled: true } },
    )).toMatchObject({
      backend: "krun",
      image: "base@sha256:aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
      workspace: { mode: "rw" },
      environment: { SAFE: "global", OTHER: "project" },
      ssh: { enabled: true },
    });
  });
});
