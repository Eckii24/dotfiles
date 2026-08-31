import { parseHTML } from "linkedom";

const REMOVE = "script,style,nav,footer,header,aside,[hidden],[aria-hidden='true']";
const MAX_LINKS = 30;

export async function extractHtml(html: string, baseUrl: string): Promise<{ title?: string; content: string; links: Array<{ title: string; url: string }> }> {
  const { document } = parseHTML(html);
  document.querySelectorAll(REMOVE).forEach(node => node.remove());
  const fallbackTitle = normalized(document.querySelector("title")?.textContent ?? "");
  const relevant = document.querySelector("main,article,[role='main']") ?? document.body;
  const links = collectLinks(relevant, baseUrl);
  return { title: fallbackTitle || undefined, content: normalized(relevant.textContent ?? ""), links };
}

export function extractText(value: string): string { return normalized(value); }

function collectLinks(root: Element, baseUrl: string): Array<{ title: string; url: string }> {
  const seen = new Set<string>();
  const links: Array<{ title: string; url: string }> = [];
  for (const anchor of root.querySelectorAll("a[href]")) {
    if (links.length >= MAX_LINKS) break;
    const href = anchor.getAttribute("href");
    if (!href) continue;
    try {
      const url = new URL(href, baseUrl);
      if (url.protocol !== "http:" && url.protocol !== "https:") continue;
      url.hash = "";
      if (seen.has(url.href)) continue;
      seen.add(url.href);
      links.push({ title: normalized(anchor.textContent ?? "") || url.href, url: url.href });
    } catch { /* Ignore malformed source links. */ }
  }
  return links;
}

function normalized(value: string): string { return value.replace(/\s+/g, " ").trim(); }
