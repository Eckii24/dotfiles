export type SearchProvider = "DuckDuckGo" | "Bing RSS";
export type SearchResult = { title: string; url: string; snippet: string };
export type SearchResponse = { query: string; provider: SearchProvider; results: SearchResult[] };
export type FetchResult = {
  requestedUrl: string;
  finalUrl?: string;
  title?: string;
  contentType?: string;
  content?: string;
  links?: Array<{ title: string; url: string }>;
  truncated?: boolean;
  nextOffset?: number;
  error?: string;
};
export type HttpResponse = { statusCode: number; headers: Record<string, string | string[] | undefined>; body: Uint8Array };
export type Requester = (url: URL, pinnedAddress: string, signal?: AbortSignal) => Promise<HttpResponse>;
