import {existsSync, readFileSync, writeFileSync} from "node:fs";
import {join} from "node:path";

import {parseWhatsNewEntries, renderWhatsNewFile, WHATS_NEW_OUTPUT_PATH} from "./lib";

const buildWhatsNewFile = (repoRoot: string): string => {
  const changelog = readFileSync(join(repoRoot, "CHANGELOG.md"), "utf8");
  return renderWhatsNewFile(parseWhatsNewEntries({changelog}));
};

/** Regenerates the what's new data from CHANGELOG.md. Returns the written path. */
export const writeWhatsNewFile = (repoRoot: string): string => {
  const outputPath = join(repoRoot, WHATS_NEW_OUTPUT_PATH);
  writeFileSync(outputPath, buildWhatsNewFile(repoRoot));
  return outputPath;
};

/** True when the committed what's new data matches CHANGELOG.md. */
export const isWhatsNewFileCurrent = (repoRoot: string): boolean => {
  const outputPath = join(repoRoot, WHATS_NEW_OUTPUT_PATH);
  if (!existsSync(outputPath)) {
    return false;
  }
  return readFileSync(outputPath, "utf8") === buildWhatsNewFile(repoRoot);
};
