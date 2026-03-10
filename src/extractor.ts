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

/**
 * Extracts clean article content from a URL.
 *
 * Uses @extractus/article-extractor under the hood for reliable
 * content detection across news sites, blogs, and Medium articles.
 */
export class ArticleExtractor {
  private options: Required<ExtractionOptions>;

  constructor(options: ExtractionOptions = {}) {
    this.options = {
      timeout: options.timeout ?? 10_000,
      maxLength: options.maxLength ?? 50_000,
    };
  }

  /**
   * Extract article content from a URL.
   * Returns null if extraction fails or no content is found.
   */
  async extract(url: string): Promise<ExtractedArticle | null> {
    try {
      const article = await extract(url);

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
      const msg = error instanceof Error ? error.message : String(error);
      console.warn(`[article-extractor] Failed to extract ${url}: ${msg}`);
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
}
