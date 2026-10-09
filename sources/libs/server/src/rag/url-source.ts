import { lookup } from "node:dns/promises";
import { isIP } from "node:net";
import { createHash } from "node:crypto";
import { parse, type DefaultTreeAdapterTypes } from "parse5";
import { normalizeIngestText } from "./ingest-text.js";
import { tBackend } from "../../../common/src/index.js";

type HtmlNode = DefaultTreeAdapterTypes.Node;
type HtmlElement = DefaultTreeAdapterTypes.Element;

const MAX_URLS = 10;
const MAX_ARTICLE_BYTES = 5 * 1024 * 1024;
const FETCH_TIMEOUT_MS = 15_000;

export type ExtractedUrlSource = {
  sourceId: string;
  sourceType: "article";
  originalUrl: string;
  canonicalUrl: string;
  provider: "web";
  title: string;
  text: string;
  warning?: string;
};

export type UrlExtractionResult =
  | { status: "success"; source: ExtractedUrlSource }
  | { status: "error"; url: string; error: string };

export function localizeUrlSourceError(message: string): string {
  switch (message) {
    case "URL 格式无效":
      return tBackend("error.rag.invalidUrl");
    case "仅支持 HTTP/HTTPS URL":
      return tBackend("error.rag.httpOnly");
    case "URL 不可包含登录凭据":
      return tBackend("error.rag.credentialsForbidden");
    case "不允许访问本机地址":
      return tBackend("error.rag.localhostForbidden");
    case "不允许访问内网或保留地址":
      return tBackend("error.rag.privateAddressForbidden");
    case "重定向缺少目标地址":
      return tBackend("error.rag.redirectMissingLocation");
    case "URL 重定向次数过多":
      return tBackend("error.rag.tooManyRedirects");
    case "网页内容超过 5MB 上限":
      return tBackend("error.rag.articleTooLarge");
    case "无法从网页提取足够的正文内容":
      return tBackend("error.rag.articleTooShort");
    default: {
      const count = /^每次最多添加 (\d+) 个 URL$/u.exec(message)?.[1];
      if (count) return tBackend("error.rag.tooManyUrls", { count });
      const status = /^网页请求失败（(\d+)）$/u.exec(message)?.[1];
      if (status) return tBackend("error.rag.webRequestFailed", { status });
      const contentType = /^不支持的网页内容类型：(.+)$/u.exec(message)?.[1];
      if (contentType) {
        return tBackend("error.rag.unsupportedContentType", {
          type: contentType,
        });
      }
      return tBackend("error.unknown");
    }
  }
}

function isPrivateAddress(address: string): boolean {
  const value = address.toLowerCase();
  if (
    value === "::1" ||
    value === "::" ||
    value.startsWith("fe80:") ||
    value.startsWith("fc") ||
    value.startsWith("fd")
  )
    return true;
  if (value.startsWith("::ffff:")) return isPrivateAddress(value.slice(7));
  const parts = value.split(".").map(Number);
  if (parts.length !== 4 || parts.some(Number.isNaN)) return false;
  return (
    parts[0] === 10 ||
    parts[0] === 127 ||
    parts[0] === 0 ||
    (parts[0] === 169 && parts[1] === 254) ||
    (parts[0] === 172 && parts[1] >= 16 && parts[1] <= 31) ||
    (parts[0] === 192 && parts[1] === 168) ||
    (parts[0] === 100 && parts[1] >= 64 && parts[1] <= 127)
  );
}

export async function validatePublicUrl(raw: string): Promise<URL> {
  let url: URL;
  try {
    url = new URL(raw.trim());
  } catch {
    throw new Error("URL 格式无效");
  }
  if (!["http:", "https:"].includes(url.protocol))
    throw new Error("仅支持 HTTP/HTTPS URL");
  if (url.username || url.password) throw new Error("URL 不可包含登录凭据");
  const hostname = url.hostname.toLowerCase();
  if (hostname === "localhost" || hostname.endsWith(".localhost"))
    throw new Error("不允许访问本机地址");
  const addresses = isIP(hostname)
    ? [{ address: hostname }]
    : await lookup(hostname, { all: true });
  if (
    addresses.length === 0 ||
    addresses.some(({ address }) => isPrivateAddress(address))
  ) {
    throw new Error("不允许访问内网或保留地址");
  }
  url.hash = "";
  return url;
}

export function normalizeSourceUrls(urls: string[]): string[] {
  const unique = [
    ...new Set(urls.map((value) => value.trim()).filter(Boolean)),
  ];
  if (unique.length > MAX_URLS)
    throw new Error(`每次最多添加 ${MAX_URLS} 个 URL`);
  return unique;
}

const REMOVED_CONTENT_TAGS = new Set([
  "script",
  "style",
  "noscript",
  "template",
  "svg",
  "canvas",
  "nav",
  "aside",
  "footer",
  "form",
  "textarea",
  "select",
  "option",
  "iframe",
  "object",
  "embed",
  "dialog",
]);

const ARTICLE_CONTENT_CLASSES = new Set([
  "article-content",
  "article-body",
  "post-content",
  "post-body",
  "entry-content",
  "content__article-body",
]);

const BLOCK_TAGS = new Set([
  "address",
  "article",
  "aside",
  "blockquote",
  "dd",
  "div",
  "dl",
  "dt",
  "figcaption",
  "figure",
  "footer",
  "h1",
  "h2",
  "h3",
  "h4",
  "h5",
  "h6",
  "header",
  "hr",
  "li",
  "main",
  "ol",
  "p",
  "pre",
  "section",
  "table",
  "tbody",
  "td",
  "th",
  "thead",
  "tr",
  "ul",
]);

function isElement(node: HtmlNode): node is HtmlElement {
  return "tagName" in node;
}

function getAttribute(element: HtmlElement, name: string): string | undefined {
  return element.attrs.find((attribute) => attribute.name === name)?.value;
}

function allElements(root: HtmlNode): HtmlElement[] {
  const result: HtmlElement[] = [];
  const visit = (node: HtmlNode) => {
    if (isElement(node)) result.push(node);
    if ("childNodes" in node) node.childNodes.forEach(visit);
  };
  visit(root);
  return result;
}

function rawText(root: HtmlNode): string {
  const pieces: string[] = [];
  const visit = (node: HtmlNode) => {
    if ("value" in node) pieces.push(node.value);
    if ("childNodes" in node) node.childNodes.forEach(visit);
  };
  visit(root);
  return pieces.join("");
}

function isRemovedElement(element: HtmlElement): boolean {
  return (
    REMOVED_CONTENT_TAGS.has(element.tagName) ||
    getAttribute(element, "hidden") !== undefined ||
    getAttribute(element, "aria-hidden")?.toLowerCase() === "true"
  );
}

function elementText(element: HtmlElement): string {
  const pieces: string[] = [];
  const visit = (node: HtmlNode) => {
    if ("value" in node) {
      pieces.push(node.value);
      return;
    }
    if (!isElement(node) || isRemovedElement(node)) return;
    if (node.tagName === "br") pieces.push("\n");
    const isBlock = BLOCK_TAGS.has(node.tagName);
    if (isBlock) pieces.push("\n");
    node.childNodes.forEach(visit);
    if (isBlock) pieces.push("\n");
  };
  visit(element);
  return normalizeIngestText(
    pieces
      .join("")
      .replace(/[ \t\f\v]+/g, " ")
      .replace(/ *\n */g, "\n"),
  );
}

function readMeta(elements: readonly HtmlElement[], key: string): string {
  for (const element of elements) {
    if (element.tagName !== "meta") continue;
    const name =
      getAttribute(element, "property") || getAttribute(element, "name");
    if (name?.toLowerCase() === key.toLowerCase()) {
      return normalizeIngestText(getAttribute(element, "content") ?? "");
    }
  }
  return "";
}

function readJsonLdArticleBodies(elements: readonly HtmlElement[]): string[] {
  const bodies: string[] = [];
  const inspect = (value: unknown) => {
    if (Array.isArray(value)) {
      value.forEach(inspect);
      return;
    }
    if (!value || typeof value !== "object") return;
    const record = value as Record<string, unknown>;
    if (typeof record.articleBody === "string") {
      bodies.push(normalizeIngestText(record.articleBody));
    }
    if (record["@graph"]) inspect(record["@graph"]);
  };
  for (const script of elements) {
    if (
      script.tagName !== "script" ||
      getAttribute(script, "type")?.toLowerCase() !== "application/ld+json"
    ) {
      continue;
    }
    try {
      inspect(JSON.parse(rawText(script)));
    } catch {
      // Invalid optional metadata must not prevent extraction from the DOM.
    }
  }
  return bodies.filter(Boolean);
}

function isArticleContentCandidate(element: HtmlElement): boolean {
  if (element.tagName === "article" || element.tagName === "main") return true;
  if (getAttribute(element, "role")?.toLowerCase() === "main") return true;
  if (getAttribute(element, "itemprop")?.toLowerCase() === "articlebody")
    return true;
  const classes = (getAttribute(element, "class") ?? "").split(/\s+/);
  return classes.some((className) => ARTICLE_CONTENT_CLASSES.has(className));
}

export function extractUsefulHtml(
  html: string,
  pageUrl: string,
): {
  title: string;
  body: string;
  canonicalUrl?: string;
  author?: string;
  published?: string;
} {
  const document = parse(html);
  const elements = allElements(document);
  const titleElement = elements.find((element) => element.tagName === "title");
  const title =
    readMeta(elements, "og:title") ||
    normalizeIngestText(titleElement ? rawText(titleElement) : "") ||
    new URL(pageUrl).hostname;
  const description =
    readMeta(elements, "description") || readMeta(elements, "og:description");
  const author =
    readMeta(elements, "author") || readMeta(elements, "article:author");
  const published =
    readMeta(elements, "article:published_time") || readMeta(elements, "date");
  const jsonLdBodies = readJsonLdArticleBodies(elements);
  const candidates = elements
    .filter(isArticleContentCandidate)
    .map((element) => elementText(element))
    .filter((text) => text.length >= 100)
    .sort((left, right) => right.length - left.length);
  const bodyElement = elements.find((element) => element.tagName === "body");
  const bodyText =
    candidates[0] || (bodyElement ? elementText(bodyElement) : "");
  const body = normalizeIngestText(
    [...jsonLdBodies, description, bodyText]
      .filter(
        (value, index, values) => value && values.indexOf(value) === index,
      )
      .join("\n\n"),
  );
  const canonicalHref = elements
    .filter((element) => element.tagName === "link")
    .find((element) =>
      (getAttribute(element, "rel") ?? "")
        .toLowerCase()
        .split(/\s+/)
        .includes("canonical"),
    );
  const href = canonicalHref ? getAttribute(canonicalHref, "href") : undefined;
  return {
    title,
    body,
    author: author || undefined,
    published: published || undefined,
    canonicalUrl: href ? new URL(href, pageUrl).toString() : undefined,
  };
}

export function findClientRedirect(
  html: string,
  current: URL,
): string | undefined {
  // Client-side redirect shells are small. Avoid treating navigation code
  // embedded in a real article as the page's redirect authority.
  if (html.length > 32 * 1024) return undefined;
  const elements = allElements(parse(html));
  const refresh = elements
    .filter((element) => element.tagName === "meta")
    .find(
      (element) =>
        getAttribute(element, "http-equiv")?.toLowerCase() === "refresh",
    );
  const refreshContent = refresh ? getAttribute(refresh, "content") : undefined;
  const metaRefresh = refreshContent
    ?.match(/(?:^|;)\s*url\s*=\s*(.+)\s*$/i)?.[1]
    ?.trim()
    .replace(/^(["'])(.*)\1$/, "$2");
  if (metaRefresh) return new URL(metaRefresh, current).toString();
  const scriptText = elements
    .filter((element) => element.tagName === "script")
    .map(rawText)
    .join("\n");

  const literalRedirect = scriptText.match(
    /\blocation\s*\.\s*(?:replace|assign)\s*\(\s*["']([^"']+)["']\s*\)/i,
  )?.[1];
  if (literalRedirect) return new URL(literalRedirect, current).toString();

  if (
    /location\s*\.\s*replace\s*\(\s*location\.href\.replace\(\s*["']https:\/\/["']\s*,\s*["']http:\/\/["']\s*\)\s*\)/i.test(
      scriptText,
    )
  ) {
    const downgraded = new URL(current);
    downgraded.protocol = "http:";
    return downgraded.toString();
  }
  return undefined;
}

async function fetchPublic(
  url: URL,
): Promise<{ html: string; finalUrl: URL; contentType: string }> {
  let current = url;
  for (let redirects = 0; redirects <= 5; redirects += 1) {
    const response = await fetch(current, {
      redirect: "manual",
      signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
      headers: { "user-agent": "XueLearnSourceReader/1.0" },
    });
    if (response.status >= 300 && response.status < 400) {
      const location = response.headers.get("location");
      if (!location) throw new Error("重定向缺少目标地址");
      current = await validatePublicUrl(new URL(location, current).toString());
      continue;
    }
    if (!response.ok) throw new Error(`网页请求失败（${response.status}）`);
    const contentType = response.headers.get("content-type") ?? "";
    if (
      !contentType.includes("text/html") &&
      !contentType.includes("text/plain")
    ) {
      throw new Error(`不支持的网页内容类型：${contentType || "unknown"}`);
    }
    const declared = Number(response.headers.get("content-length") || 0);
    if (declared > MAX_ARTICLE_BYTES) throw new Error("网页内容超过 5MB 上限");
    const html = await response.text();
    if (Buffer.byteLength(html) > MAX_ARTICLE_BYTES)
      throw new Error("网页内容超过 5MB 上限");
    const clientRedirect = contentType.includes("text/html")
      ? findClientRedirect(html, current)
      : undefined;
    if (clientRedirect) {
      current = await validatePublicUrl(clientRedirect);
      continue;
    }
    return { html, finalUrl: current, contentType };
  }
  throw new Error("URL 重定向次数过多");
}

async function extractArticle(
  originalUrl: string,
  url: URL,
): Promise<ExtractedUrlSource> {
  const { html, finalUrl, contentType } = await fetchPublic(url);
  const parsed = contentType.includes("text/html")
    ? extractUsefulHtml(html, finalUrl.toString())
    : {
        title: finalUrl.hostname,
        body: normalizeIngestText(html),
        canonicalUrl: undefined,
        author: undefined,
        published: undefined,
      };
  const canonical = parsed.canonicalUrl
    ? await validatePublicUrl(parsed.canonicalUrl)
    : finalUrl;
  const title = parsed.title || canonical.hostname;
  const body = parsed.body;
  if (body.length < 100) throw new Error("无法从网页提取足够的正文内容");
  const text = normalizeIngestText(
    [
      `# ${title}`,
      parsed.author && `作者：${parsed.author}`,
      parsed.published && `发布日期：${parsed.published}`,
      `来源：${canonical}`,
      "",
      body,
    ]
      .filter(Boolean)
      .join("\n"),
  );
  return {
    sourceId: sourceId(canonical.toString()),
    sourceType: "article",
    originalUrl,
    canonicalUrl: canonical.toString(),
    provider: "web",
    title: normalizeIngestText(title),
    text,
  };
}

export function sourceId(canonicalUrl: string): string {
  return createHash("sha256").update(canonicalUrl).digest("hex").slice(0, 24);
}

export async function extractUrlSource(
  raw: string,
): Promise<ExtractedUrlSource> {
  const url = await validatePublicUrl(raw);
  return extractArticle(raw, url);
}

export async function extractUrlSources(
  urls: string[],
): Promise<UrlExtractionResult[]> {
  const normalized = normalizeSourceUrls(urls);
  console.info(`[rag:url] Reading ${normalized.length} URL source(s)`);
  const results: UrlExtractionResult[] = [];
  for (let offset = 0; offset < normalized.length; offset += 3) {
    const batch = normalized.slice(offset, offset + 3);
    results.push(
      ...(await Promise.all(
        batch.map(async (url) => {
          const startedAt = Date.now();
          console.info(`[rag:url] Reading ${url}`);
          try {
            const source = await extractUrlSource(url);
            console.info(
              `[rag:url] Read ${url} as "${source.title}" (${source.provider}/${source.sourceType}, ${source.text.length} chars, ${Date.now() - startedAt}ms)`,
            );
            return { status: "success" as const, source };
          } catch (error) {
            const message =
              error instanceof Error ? error.message : String(error);
            console.warn(
              `[rag:url] Failed to read ${url} after ${Date.now() - startedAt}ms: ${message}`,
            );
            return { status: "error" as const, url, error: message };
          }
        }),
      )),
    );
  }
  const succeeded = results.filter(
    (result) => result.status === "success",
  ).length;
  console.info(
    `[rag:url] Finished reading URL sources: ${succeeded} succeeded, ${results.length - succeeded} failed`,
  );
  return results;
}
