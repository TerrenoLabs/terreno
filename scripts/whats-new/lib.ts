/** Number of most recent releases shipped in the what's new data. */
const WHATS_NEW_RELEASE_LIMIT = 10;

export const WHATS_NEW_OUTPUT_PATH = "example-frontend/constants/whatsNew.generated.json";

const REPOSITORY_URL = "https://github.com/TerrenoLabs/terreno";
const RELEASE_HEADING_PATTERN = /^## \[([^\]]+)\](?:\s+-\s+(\S+))?\s*$/;
const LINK_REFERENCE_PATTERN = /^\[[^\]]+\]:\s+\S+\s*$/;
const RELATIVE_LINK_PATTERN = /\]\((?!https?:|mailto:|#)([^)\s]+)\)/g;
const PULL_REQUEST_PATTERN = /\(#(\d+)\)/g;
// An indented line continuing a list item, but not a nested list item.
const WRAPPED_LIST_LINE_PATTERN = /([^\n])\n {2,}(?![-*+] |\d+\. )(?=\S)/g;

export interface WhatsNewEntry {
  body: string;
  date?: string;
  version: string;
}

// Changelog links are repo-relative; in the app they must point at GitHub. Hard-wrapped list
// items are joined because MarkdownView renders each source line break.
const prepareBody = (body: string): string => {
  return body
    .replace(WRAPPED_LIST_LINE_PATTERN, "$1 ")
    .replace(RELATIVE_LINK_PATTERN, (_match, path: string) => {
      return `](${REPOSITORY_URL}/blob/master/${path.replace(/^\.\//, "")})`;
    })
    .replace(PULL_REQUEST_PATTERN, (_match, number: string) => {
      return `([#${number}](${REPOSITORY_URL}/pull/${number}))`;
    });
};

/** Parses released CHANGELOG.md sections, newest first, skipping Unreleased. */
export const parseWhatsNewEntries = ({
  changelog,
  limit = WHATS_NEW_RELEASE_LIMIT,
}: {
  changelog: string;
  limit?: number;
}): WhatsNewEntry[] => {
  const entries: WhatsNewEntry[] = [];
  let current: {date?: string; lines: string[]; version: string} | undefined;

  const flush = (): void => {
    if (!current) {
      return;
    }
    const body = current.lines
      .filter((line) => !LINK_REFERENCE_PATTERN.test(line))
      .join("\n")
      .trim();
    if (body) {
      entries.push({
        body: prepareBody(body),
        ...(current.date ? {date: current.date} : {}),
        version: current.version,
      });
    }
    current = undefined;
  };

  for (const line of changelog.split(/\r?\n/)) {
    const heading = line.match(RELEASE_HEADING_PATTERN);
    if (heading) {
      flush();
      const version = heading[1] ?? "";
      if (version.toLowerCase() !== "unreleased") {
        current = {date: heading[2], lines: [], version};
      }
      continue;
    }
    if (line.startsWith("## ")) {
      flush();
      continue;
    }
    current?.lines.push(line);
  }
  flush();

  return entries.slice(0, limit);
};

export const renderWhatsNewFile = (entries: WhatsNewEntry[]): string => {
  return `${JSON.stringify(entries, null, 2)}\n`;
};
