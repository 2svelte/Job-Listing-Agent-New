import "server-only";
import { isIP } from "node:net";

const MAX_REDIRECTS = 5;
const MAX_BYTES = 1_500_000;
const MAX_STORED_CHARS = 20_000;
const FETCH_TIMEOUT_MS = 12_000;

const USER_AGENT = "Mozilla/5.0 (compatible; JobListingAgentBot/1.0)";

const decodeEntities = (text: string) =>
  text
    .replace(/&nbsp;|&#160;/gi, " ")
    .replace(/&amp;/gi, "&")
    .replace(/&lt;/gi, "<")
    .replace(/&gt;/gi, ">")
    .replace(/&quot;/gi, '"')
    .replace(/&#39;|&apos;/gi, "'");

const htmlToText = (html: string) =>
  decodeEntities(
    html
      .replace(/<(script|style|noscript|svg|head)[\s\S]*?<\/\1>/gi, " ")
      .replace(/<(br|\/p|\/li|\/div|\/h\d|\/tr)\s*\/?>/gi, ". ")
      .replace(/<[^>]+>/g, " "),
  )
    .replace(/\s+/g, " ")
    .trim();

// Blocks loopback/private targets so a crafted redirect can't make the server call internal services.
const isPrivateHost = (hostname: string) => {
  const host = hostname.replace(/^\[|\]$/g, "").toLowerCase();
  if (host === "localhost" || host.endsWith(".localhost") || host.endsWith(".internal") || host.endsWith(".local")) {
    return true;
  }

  const ipVersion = isIP(host);
  if (ipVersion === 4) {
    const [a = 0, b = 0] = host.split(".").map(Number);
    return (
      a === 10 ||
      a === 127 ||
      a === 0 ||
      (a === 169 && b === 254) ||
      (a === 172 && b >= 16 && b <= 31) ||
      (a === 192 && b === 168)
    );
  }

  if (ipVersion === 6) {
    return host === "::1" || host === "::" || host.startsWith("fc") || host.startsWith("fd") || host.startsWith("fe80");
  }

  return false;
};

const isAllowedUrl = (url: URL) => (url.protocol === "https:" || url.protocol === "http:") && !isPrivateHost(url.hostname);

// Prefers the schema.org JobPosting description many job pages embed; falls back to visible page text.
const extractJobText = (html: string) => {
  const blocks = html.matchAll(/<script[^>]+type=["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script>/gi);

  for (const block of blocks) {
    try {
      const raw = block[1];
      if (!raw) {
        continue;
      }
      const parsed: unknown = JSON.parse(raw);
      const nodes = Array.isArray(parsed) ? parsed : [parsed];
      for (const node of nodes) {
        const candidates = [node, ...(Array.isArray((node as { "@graph"?: unknown })?.["@graph"]) ? (node as { "@graph": unknown[] })["@graph"] : [])];
        for (const candidate of candidates) {
          const item = candidate as { "@type"?: string | string[]; description?: string };
          const type = Array.isArray(item?.["@type"]) ? item["@type"] : [item?.["@type"]];
          if (type.includes("JobPosting") && typeof item.description === "string" && item.description.length > 100) {
            return htmlToText(item.description);
          }
        }
      }
    } catch {
      // ignore malformed JSON-LD
    }
  }

  return htmlToText(html);
};

const readCapped = async (response: Response) => {
  const reader = response.body?.getReader();
  if (!reader) {
    return "";
  }

  const chunks: Uint8Array[] = [];
  let total = 0;
  while (total < MAX_BYTES) {
    const { done, value } = await reader.read();
    if (done || !value) {
      break;
    }
    chunks.push(value);
    total += value.length;
  }
  await reader.cancel().catch(() => undefined);

  return new TextDecoder().decode(Buffer.concat(chunks));
};

// Returns the page's job text, or null when the page is blocked, missing or has too little content.
export const fetchJobPageText = async (startUrl: string): Promise<string | null> => {
  let url: URL;
  try {
    url = new URL(startUrl);
  } catch {
    return null;
  }

  try {
    for (let hop = 0; hop <= MAX_REDIRECTS; hop += 1) {
      if (!isAllowedUrl(url)) {
        return null;
      }

      const response = await fetch(url, {
        redirect: "manual",
        headers: { "User-Agent": USER_AGENT, Accept: "text/html,application/xhtml+xml" },
        signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
        cache: "no-store",
      });

      if (response.status >= 300 && response.status < 400) {
        const location = response.headers.get("location");
        if (!location) {
          return null;
        }
        url = new URL(location, url);
        continue;
      }

      const contentType = response.headers.get("content-type") ?? "";
      if (!response.ok || !contentType.includes("html")) {
        return null;
      }

      const text = extractJobText(await readCapped(response));
      return text.length >= 300 ? text.slice(0, MAX_STORED_CHARS) : null;
    }
  } catch {
    return null;
  }

  return null;
};
