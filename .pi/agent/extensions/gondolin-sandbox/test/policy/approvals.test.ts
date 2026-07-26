import { describe, expect, test } from "bun:test";
import { fingerprintSandbox, verifyProjectApproval } from "../../policy/approvals";

describe("project full-section approval", () => {
  test("fingerprint is deterministic over the complete sandbox section", () => {
    const first = { network: { deny: ["blocked.test"], allow: ["ok.test"] }, backend: "gondolin" };
    const reorderedKeys = { backend: "gondolin", network: { allow: ["ok.test"], deny: ["blocked.test"] } };
    const fingerprint = fingerprintSandbox(first);

    expect(fingerprint).toMatch(/^sha256:[0-9a-f]{64}$/);
    expect(fingerprintSandbox(reorderedKeys)).toBe(fingerprint);
    expect(verifyProjectApproval(first, fingerprint)).toBe(true);
    expect(verifyProjectApproval({ ...first, image: "other@sha256:x" }, fingerprint)).toBe(false);
  });

  test("deny removal makes the full-section approval stale", () => {
    const approved = { network: { allow: ["*.example.com"], deny: ["blocked.example.com"] } };
    const fingerprint = fingerprintSandbox(approved);
    expect(verifyProjectApproval({ network: { allow: ["*.example.com"], deny: [] } }, fingerprint)).toBe(false);
  });
});
