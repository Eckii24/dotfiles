import http from "node:http";
import https from "node:https";

import { extractHtml, extractText } from "./extract.ts";
import { validatePublicUrl } from "./ssrf.ts";
import type { FetchResult, HttpResponse, Requester } from "./types.ts";

const MAX_URLS = 5;
const MAX_PARALLEL = 3;
const MAX_REDIRECTS = 3;
const MAX_DOWNLOAD_BYTES = 2 * 1024 * 1024;
const DEFAULT_MAX_CHARS = 8_000;
const REQUEST_TIMEOUT_MS = 5_000;
const DOWNLOAD_TIMEOUT_MS = 20_000;
const ALLOWED_TYPES = /^(text\/|application\/(json|xml|[a-z.+-]*\+json|[a-z.+-]*\+xml))/i;

export async function fetchUrls(urls: string[], maxChars = DEFAULT_MAX_CHARS, offset?: number, requester: Requester = requestPinned, signal?: AbortSignal): Promise<FetchResult[]> {
  if (!Array.isArray(urls) || urls.length < 1 || urls.length > MAX_URLS) throw new Error("urls must contain 1 to 5 URLs.");
  if (!Number.isInteger(maxChars) || maxChars < 1_000 || maxChars > 15_000) throw new Error("maxChars must be an integer between 1,000 and 15,000.");
  if (offset !== undefined && (!Number.isInteger(offset) || offset < 0 || urls.length !== 1)) throw new Error("offset must be a non-negative integer and only used with one URL.");
  return mapConcurrent(urls, MAX_PARALLEL, url => fetchOne(url, maxChars, offset ?? 0, requester, signal));
}

export async function fetchOne(requestedUrl: string, maxChars: number, offset: number, requester: Requester, signal?: AbortSignal): Promise<FetchResult> {
  try {
    let current = requestedUrl;
    for (let redirects = 0; ; redirects++) {
      const approved = await validatePublicUrl(current);
      const response = await requester(approved.url, approved.addresses[0]!, signal);
      const location = header(response.headers, "location");
      if (response.statusCode >= 300 && response.statusCode < 400 && location) {
        if (redirects >= MAX_REDIRECTS) return { requestedUrl, error: "Too many redirects." };
        current = new URL(location, approved.url).href;
        continue;
      }
      if (response.statusCode < 200 || response.statusCode >= 300) return { requestedUrl, finalUrl: approved.url.href, error: `HTTP ${response.statusCode}.` };
      const contentType = (header(response.headers, "content-type") ?? "").split(";", 1)[0]!.toLowerCase();
      if (!ALLOWED_TYPES.test(contentType)) return { requestedUrl, finalUrl: approved.url.href, contentType, error: "Unsupported content type." };
      const raw = new TextDecoder().decode(response.body);
      const extracted = contentType === "text/html" || contentType === "application/xhtml+xml"
        ? await extractHtml(raw, approved.url.href)
        : { content: extractText(raw), links: [], title: undefined };
      const start = Math.min(offset, extracted.content.length);
      const content = extracted.content.slice(start, start + maxChars);
      const truncated = start + content.length < extracted.content.length;
      return { requestedUrl, finalUrl: approved.url.href, title: extracted.title, contentType, content, links: extracted.links, truncated, ...(truncated ? { nextOffset: start + content.length } : {}) };
    }
  } catch (error) {
    return { requestedUrl, error: error instanceof Error ? error.message : "Request failed." };
  }
}

export const requestPinned: Requester = (url, pinnedAddress, signal) => new Promise((resolve, reject) => {
  const client = url.protocol === "https:" ? https : http;
  const request = client.get(url, {
    headers: { Accept: "text/html,text/markdown,text/plain,application/json,application/xml,text/xml;q=0.9,*/*;q=0.1", "User-Agent": "Pi-Web-Research/1.0" },
    timeout: REQUEST_TIMEOUT_MS,
    lookup: (_host, options, callback) => {
      const family = pinnedAddress.includes(":") ? 6 : 4;
      if (typeof options === "object" && options?.all) callback(null, [{ address: pinnedAddress, family }]);
      else callback(null, pinnedAddress, family);
    },
    ...(url.protocol === "https:" ? { servername: url.hostname } : {}),
  }, response => {
    const chunks: Buffer[] = []; let size = 0; let settled = false;
    const finish = (error?: Error) => { if (settled) return; settled = true; error ? reject(error) : resolve({ statusCode: response.statusCode ?? 0, headers: response.headers, body: Buffer.concat(chunks) }); };
    const timer = setTimeout(() => { request.destroy(new Error("Download timed out.")); }, DOWNLOAD_TIMEOUT_MS);
    response.on("data", (chunk: Buffer) => { size += chunk.length; if (size > MAX_DOWNLOAD_BYTES) request.destroy(new Error("Response exceeds 2 MiB limit.")); else chunks.push(chunk); });
    response.on("end", () => { clearTimeout(timer); finish(); });
    response.on("error", error => { clearTimeout(timer); finish(error); });
  });
  request.once("timeout", () => request.destroy(new Error("Request timed out.")));
  request.once("error", reject);
  if (signal) signal.addEventListener("abort", () => request.destroy(signal.reason instanceof Error ? signal.reason : new Error("Request aborted.")), { once: true });
});

function header(headers: HttpResponse["headers"], name: string): string | undefined { const value = headers[name]; return Array.isArray(value) ? value[0] : value; }
async function mapConcurrent<T, R>(items: T[], limit: number, action: (item: T) => Promise<R>): Promise<R[]> {
  const results = new Array<R>(items.length); let next = 0;
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, async () => { while (next < items.length) { const index = next++; results[index] = await action(items[index]!); } }));
  return results;
}
