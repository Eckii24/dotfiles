import { createHash, timingSafeEqual } from "node:crypto";

const canonicalize = (value: unknown): unknown => {
  if (Array.isArray(value)) return value.map(canonicalize);
  if (value !== null && typeof value === "object") {
    return Object.fromEntries(Object.entries(value as Record<string, unknown>)
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([key, child]) => [key, canonicalize(child)]));
  }
  return value;
};

export function fingerprintSandbox(sandbox: unknown): string {
  const canonical = JSON.stringify(canonicalize(sandbox));
  return `sha256:${createHash("sha256").update(canonical).digest("hex")}`;
}

export function verifyProjectApproval(sandbox: unknown, approvedFingerprint: string | undefined): boolean {
  if (!approvedFingerprint) return false;
  const actual = Buffer.from(fingerprintSandbox(sandbox));
  const expected = Buffer.from(approvedFingerprint);
  return actual.length === expected.length && timingSafeEqual(actual, expected);
}
