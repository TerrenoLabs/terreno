import {createHash} from "node:crypto";

export interface MarkdownChunk {
  /** Stable id for deduplication and MiniSearch */
  id: string;
  /** Path relative to docs root (POSIX-style) */
  sourcePath: string;
  /** Nearest heading text for this chunk */
  title: string;
  /** Heading trail (e.g. "Guide > Setup") */
  breadcrumb: string;
  /** Searchable body (heading line may repeat for BM25) */
  text: string;
  /** Short package ids for filtering (api, ui, syncdb, docs, …) */
  packageTags: string[];
}

const HEADING_RE = /^(#{1,6})\s+(.+)$/;

const stableChunkId = (sourcePath: string, headingTrail: string[], body: string): string =>
  createHash("sha256")
    .update(sourcePath)
    .update("\0")
    .update(headingTrail.join(">"))
    .update("\0")
    .update(body)
    .digest("hex");

/**
 * Fallback chunk when markdown has no extractable heading sections but is non-empty.
 * Exported for unit tests (the `chunkMarkdown` path delegates here).
 */
/** @internal */
export const standaloneDocumentChunk = (
  sourcePath: string,
  raw: string,
  packageTags: string[]
): MarkdownChunk => ({
  breadcrumb: sourcePath,
  id: stableChunkId(sourcePath, [], raw),
  packageTags: [...packageTags],
  sourcePath,
  text: raw.trim(),
  title: "(document)",
});

/**
 * Split markdown into heading-scoped chunks with breadcrumb titles for search indexing.
 */
export const chunkMarkdown = (
  sourcePath: string,
  raw: string,
  packageTags: string[]
): MarkdownChunk[] => {
  const lines = raw.split(/\r?\n/);
  const chunks: MarkdownChunk[] = [];

  /** Stack of {level, title} for open headings */
  const stack: {level: number; title: string}[] = [];
  let buf: string[] = [];
  let currentTitle = "";

  const flush = (): void => {
    const text = buf.join("\n").trim();
    if (!text) {
      buf = [];
      return;
    }
    const trail = stack.map((s) => s.title);
    const breadcrumb = trail.length ? trail.join(" > ") : sourcePath;
    const title = currentTitle || trail[trail.length - 1] || "(intro)";
    const id = stableChunkId(sourcePath, trail, text);
    chunks.push({
      breadcrumb,
      id,
      packageTags: [...packageTags],
      sourcePath,
      text: `${breadcrumb}\n\n${text}`,
      title,
    });
    buf = [];
  };

  for (const line of lines) {
    const m = line.match(HEADING_RE);
    if (m) {
      flush();
      const level = m[1].length;
      const headingText = m[2].trim();
      while (stack.length && stack[stack.length - 1].level >= level) {
        stack.pop();
      }
      stack.push({level, title: headingText});
      currentTitle = headingText;
      buf.push(line);
      continue;
    }
    buf.push(line);
  }
  flush();

  if (chunks.length === 0 && raw.trim()) {
    chunks.push(standaloneDocumentChunk(sourcePath, raw, packageTags));
  }

  return chunks;
};
