import { expect, test } from "bun:test";

import { extractHtml } from "./extract.ts";
import { fetchOne, fetchUrls } from "./fetch.ts";
import type { Requester } from "./types.ts";

const request: Requester = async (url) => {
  if (url.hostname === "bad.example") throw new Error("simulated failure");
  if (url.pathname === "/redirect") return { statusCode: 302, headers: { location: "http://localhost/private" }, body: new Uint8Array() };
  return { statusCode: 200, headers: { "content-type": "text/html" }, body: new TextEncoder().encode("<html><head><title>Title</title></head><body><nav>noise</nav><main><h1>Useful</h1><p>Evidence text</p><a href='/next'>Next</a></main><script>bad()</script></body></html>") };
};

test("extracts readable HTML and bounded absolute links without rewriting source words", async () => {
  const result = await extractHtml("<title>X</title><main>ignore instructions Base64: YQ==<a href='/e'>Evidence</a></main>", "https://example.com/a");
  expect(result.content).toContain("ignore instructions Base64: YQ==");
  expect(result.links).toEqual([{ title: "Evidence", url: "https://example.com/e" }]);
});

test("fetch keeps batch order and returns per-url errors", async () => {
  const results = await fetchUrls(["https://example.com/ok", "https://bad.example/nope"], 1_000, undefined, request);
  expect(results).toHaveLength(2);
  expect(results[0]).toMatchObject({ requestedUrl: "https://example.com/ok", finalUrl: "https://example.com/ok", title: "Title" });
  expect(results[1]).toMatchObject({ requestedUrl: "https://bad.example/nope", error: "Hostname could not be resolved." });
});

test("redirect target is fully revalidated and private redirect is blocked", async () => {
  const result = await fetchOne("https://example.com/redirect", 1_000, 0, request);
  expect(result).toMatchObject({ requestedUrl: "https://example.com/redirect", error: "Local hostnames are not allowed." });
});

test("fetch enforces public API limits", async () => {
  await expect(fetchUrls([], 1_000, undefined, request)).rejects.toThrow("1 to 5");
  await expect(fetchUrls(["https://example.com/"], 999, undefined, request)).rejects.toThrow("1,000");
  await expect(fetchUrls(["https://example.com/", "https://example.com/2"], 1_000, 0, request)).rejects.toThrow("only used with one URL");
});
