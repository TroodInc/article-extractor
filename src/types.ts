/** Extracted article content */
export interface ExtractedArticle {
  /** Source URL */
  url: string;
  /** Article title */
  title: string;
  /** Clean article text (HTML stripped) */
  content: string;
  /** Short description or lead */
  description?: string;
  /** Author name */
  author?: string;
  /** Publication date (ISO string) */
  publishedDate?: string;
  /** Source site name */
  siteName?: string;
  /** Approximate word count */
  wordCount: number;
}

/** Options for article extraction */
export interface ExtractionOptions {
  /** Request timeout in ms (default 10000) */
  timeout?: number;
  /** Maximum content length in characters (default 50000) */
  maxLength?: number;
}
