import { expect, test } from "bun:test";

import { SsrfError, isPublicAddress, validatePublicUrl } from "./ssrf.ts";

test("rejects private, documentation-only, and IPv4-mapped IPv6 addresses", () => {
  for (const address of [
    "127.0.0.1", "10.0.0.1", "198.51.100.7", "203.0.113.7",
    "::1", "::ffff:127.0.0.1", "::ffff:7f00:1", "::ffff:0a00:1", "::ffff:a9fe:a9fe", "::ffff:c0a8:1",
    "fc00::1", "2001:db8::1",
  ]) expect(isPublicAddress(address)).toBeFalse();
});

test("blocks private, credentialed, malformed, and non-web request targets", async () => {
  for (const url of [
    "file:///etc/passwd",
    "ftp://example.com/file",
    "http://user:pass@example.com/",
    "http://localhost/",
    "http://service.local/",
    "http://intranet/",
    "http://127.0.0.1/",
    "https://[::1]/",
    "https://example.com:8443/",
  ]) {
    await expect(validatePublicUrl(url)).rejects.toBeInstanceOf(SsrfError);
  }
});
