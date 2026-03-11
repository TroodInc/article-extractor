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
  timeout?: number;
  maxLength?: number;
  caCertPath?: string;
  headers?: Record<string, string>;
}
