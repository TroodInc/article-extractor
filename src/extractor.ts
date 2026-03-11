import http from "node:http";
import https from "node:https";
import { readFileSync } from "node:fs";
import { extract } from "@extractus/article-extractor";
import type { ExtractedArticle, ExtractionOptions } from "./types.js";

/** Strip HTML tags and normalize whitespace */
function stripHtml(html: string): string {
  return html
    .replace(/<[^>]*>/g, " ")
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/\s+/g, " ")
    .trim();
}

/** Count words in a string */
function countWords(text: string): number {
  return text.split(/\s+/).filter((w) => w.length > 0).length;
}

function extractMediumArticleId(url: URL): string | null {
  const match = url.pathname.match(/-([0-9a-f]{12,})\/?$/i);
  return match ? match[1] : null;
}

function stripMediumJsonPrefix(payload: string): string {
  return payload.startsWith("])}while(1);</x>") ? payload.slice("])}while(1);</x>".length) : payload;
}

function extractMediumParagraphText(paragraph: Record<string, unknown>): string {
  const text = paragraph.text;
  return typeof text === "string" ? text : "";
}

function buildMediumContent(value: Record<string, unknown>): string {
  const content = value.content;
  if (!content || typeof content !== "object") return "";
  const bodyModel = (content as Record<string, unknown>).bodyModel;
  if (!bodyModel || typeof bodyModel !== "object") return "";
  const paragraphs = (bodyModel as Record<string, unknown>).paragraphs;
  if (!Array.isArray(paragraphs)) return "";
  return paragraphs
    .map((paragraph) =>
      paragraph && typeof paragraph === "object"
        ? extractMediumParagraphText(paragraph as Record<string, unknown>)
        : ""
    )
    .filter(Boolean)
    .join("\n\n");
}

function getMediumPayloadValue(payload: unknown): Record<string, unknown> | null {
  if (!payload || typeof payload !== "object") return null;
  const root = payload as Record<string, unknown>;
  if (root.payload && typeof root.payload === "object") {
    const nested = root.payload as Record<string, unknown>;
    if (nested.value && typeof nested.value === "object") {
      return nested.value as Record<string, unknown>;
    }
  }
  if (root.value && typeof root.value === "object") {
    return root.value as Record<string, unknown>;
  }
  return null;
}

function isRedirect(statusCode: number): boolean {
  return statusCode === 301 || statusCode === 302 || statusCode === 303 || statusCode === 307 || statusCode === 308;
}

function isRetryableNetworkError(error: Error & { code?: string }): boolean {
  return error.code === "UNABLE_TO_VERIFY_LEAF_SIGNATURE" || error.code === "EAI_AGAIN";
}

function canRetryViaMedium(url: string): boolean {
  try {
    const parsed = new URL(url);
    return extractMediumArticleId(parsed) !== null && parsed.hostname !== "medium.com";
  } catch {
    return false;
  }
}

/**
 * Extracts clean article content from a URL.
 *
 * Uses @extractus/article-extractor under the hood for reliable
 * content detection across news sites, blogs, and Medium articles.
 */
export class ArticleExtractor {
  private options: Required<ExtractionOptions>;
  private agent: ((url: URL) => http.Agent | https.Agent) | undefined;

  constructor(options: ExtractionOptions = {}) {
    this.options = {
      timeout: options.timeout ?? 10_000,
      maxLength: options.maxLength ?? 50_000,
      caCertPath: options.caCertPath ?? "",
      headers: options.headers ?? {},
    };
    this.agent = this.createAgent();
  }

  /**
   * Extract article content from a URL.
   * Returns null if extraction fails or no content is found.
   */
  async extract(url: string): Promise<ExtractedArticle | null> {
    try {
      const article = await this.extractWithFallback(url);

      if (!article || !article.content) return null;

      let content = stripHtml(article.content);

      if (content.length > this.options.maxLength) {
        content = content.slice(0, this.options.maxLength) + "...";
      }

      return {
        url,
        title: article.title || "Untitled",
        content,
        description: article.description || undefined,
        author: article.author || undefined,
        publishedDate: article.published || undefined,
        siteName: article.source || undefined,
        wordCount: countWords(content),
      };
    } catch (error) {
      const err = error as Error & { code?: string; cause?: unknown };
      const cause =
        err.cause instanceof Error
          ? `${err.cause.name}: ${err.cause.message}`
          : err.cause
            ? String(err.cause)
            : "";
      const details = [err.name, err.code, err.message, cause].filter(Boolean).join(" | ");
      console.warn(`[article-extractor] Failed to extract ${url}: ${details}`);
      return null;
    }
  }

  /**
   * Extract articles from multiple URLs.
   * Skips URLs that fail extraction.
   */
  async extractMany(urls: string[]): Promise<ExtractedArticle[]> {
    const results: ExtractedArticle[] = [];
    for (const url of urls) {
      const article = await this.extract(url);
      if (article) results.push(article);
    }
    return results;
  }

  private createAgent(): ((url: URL) => http.Agent | https.Agent) | undefined {
    const ca = this.options.caCertPath ? readFileSync(this.options.caCertPath, "utf8") : undefined;
    const httpAgent = new http.Agent({ keepAlive: true });
    const httpsAgent = new https.Agent({ keepAlive: true, ca });
    return (url: URL) => (url.protocol === "http:" ? httpAgent : httpsAgent);
  }

  private async extractWithFallback(url: string) {
    try {
      return await this.fetchArticle(url);
    } catch (error) {
      const err = error as Error & { code?: string };
      if (!isRetryableNetworkError(err) || !canRetryViaMedium(url)) {
        throw error;
      }

      const fallbackUrl = this.toMediumCanonicalUrl(url);
      if (!fallbackUrl || fallbackUrl === url) {
        throw error;
      }

      console.warn(`[article-extractor] Retrying via canonical Medium URL: ${fallbackUrl}`);
      return this.fetchMediumCanonicalArticle(fallbackUrl);
    }
  }

  private async fetchArticle(url: string) {
    return extract(url, {}, {
      headers: {
        "user-agent":
          "Mozilla/5.0 (X11; Linux x86_64; rv:128.0) Gecko/20100101 Firefox/128.0",
        ...this.options.headers,
      },
      agent: this.agent,
      signal: AbortSignal.timeout(this.options.timeout),
    });
  }

  private async fetchMediumCanonicalArticle(url: string) {
    const rawPayload = await this.fetchTextWithAgent(`${url}?output=1`);
    const parsedPayload = JSON.parse(stripMediumJsonPrefix(rawPayload));
    const value = getMediumPayloadValue(parsedPayload);
    if (!value) {
      throw new Error("Medium fallback payload missing article value");
    }

    const content = buildMediumContent(value);
    if (!content) {
      throw new Error("Medium fallback payload missing body content");
    }

    return {
      title: typeof value.title === "string" ? value.title : "Untitled",
      content,
      description: typeof value.contentSubtitle === "string" ? value.contentSubtitle : undefined,
      author: typeof value.creatorId === "string" ? value.creatorId : undefined,
      published:
        typeof value.firstPublishedAt === "number"
          ? new Date(value.firstPublishedAt).toISOString()
          : undefined,
      source: "Medium",
    };
  }

  private async fetchTextWithAgent(url: string, redirectCount = 0): Promise<string> {
    const parsedUrl = new URL(url);
    const transport = parsedUrl.protocol === "https:" ? https : http;
    const headers = {
      "user-agent":
        "Mozilla/5.0 (X11; Linux x86_64; rv:128.0) Gecko/20100101 Firefox/128.0",
      ...this.options.headers,
    };

    return new Promise<string>((resolve, reject) => {
      const request = transport.request(
        parsedUrl,
        {
          method: "GET",
          headers,
          agent: this.agent?.(parsedUrl),
        },
        (response) => {
          const statusCode = response.statusCode ?? 0;

          if (isRedirect(statusCode) && response.headers.location) {
            if (redirectCount >= 5) {
              response.resume();
              reject(new Error("Too many redirects in Medium fallback"));
              return;
            }

            const nextUrl = new URL(response.headers.location, parsedUrl).toString();
            response.resume();
            this.fetchTextWithAgent(nextUrl, redirectCount + 1).then(resolve).catch(reject);
            return;
          }

          if (statusCode < 200 || statusCode >= 300) {
            response.resume();
            reject(new Error(`Medium fallback failed with status ${statusCode}`));
            return;
          }

          const chunks: Buffer[] = [];
          response.on("data", (chunk) => {
            chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
          });
          response.on("end", () => {
            resolve(Buffer.concat(chunks).toString("utf8"));
          });
          response.on("error", reject);
        }
      );

      request.setTimeout(this.options.timeout, () => {
        request.destroy(new Error(`Medium fallback timed out after ${this.options.timeout}ms`));
      });
      request.on("error", reject);
      request.end();
    });
  }

  private toMediumCanonicalUrl(url: string): string | null {
    try {
      const parsed = new URL(url);
      const articleId = extractMediumArticleId(parsed);
      if (!articleId) return null;
      return `https://medium.com/p/${articleId}`;
    } catch {
      return null;
    }
  }
}
