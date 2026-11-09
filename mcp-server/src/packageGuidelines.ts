import {existsSync, readFileSync} from "node:fs";
import {join} from "node:path";

import {getDocsRoot} from "./docsRoot.js";

const GUIDELINE_PACKAGE_IDS = ["api", "ui", "syncdb", "admin-backend", "admin-frontend"] as const;

export type GuidelinePackageId = (typeof GUIDELINE_PACKAGE_IDS)[number];

const normalizeGuidelinePackageId = (pkg: string): GuidelinePackageId | null => {
  const n = pkg
    .trim()
    .replace(/^@terreno\//i, "")
    .toLowerCase();
  if (
    n === "api" ||
    n === "ui" ||
    n === "syncdb" ||
    n === "admin-backend" ||
    n === "admin-frontend"
  ) {
    return n;
  }
  return null;
};

/**
 * Resolves which bundled guideline packages to include. Unknown ids (including the removed
 * `rtk` package) are dropped.
 * An empty array after filtering falls back to all known packages.
 */
export const resolveBootstrapGuidelinePackages = (requested?: string[]): GuidelinePackageId[] => {
  if (!requested?.length) {
    return [...GUIDELINE_PACKAGE_IDS];
  }
  const out: GuidelinePackageId[] = [];
  for (const raw of requested) {
    const id = normalizeGuidelinePackageId(raw);
    if (!id) {
      continue;
    }
    if (!out.includes(id)) {
      out.push(id);
    }
  }
  return out.length > 0 ? out : [...GUIDELINE_PACKAGE_IDS];
};

export const loadPackageGuidelineMarkdown = (
  packageId: string,
  fileName = "core.md"
): string | null => {
  const filePath = join(getDocsRoot(), "guidelines", packageId, "guidelines", fileName);
  if (!existsSync(filePath)) {
    return null;
  }
  return readFileSync(filePath, "utf-8").trim();
};

/** Concatenates package `core.md` bodies for root `.rulesync` rules (markdown only, no frontmatter). */
export const composePackageGuidelinesForRules = (
  packageIds: readonly GuidelinePackageId[]
): string => {
  const parts: string[] = [];
  for (const id of packageIds) {
    const md = loadPackageGuidelineMarkdown(id, "core.md");
    if (md) {
      parts.push(md);
    }
  }
  return parts.join("\n\n---\n\n");
};

/** Packages whose `core.md` is merged into root `.rulesync` rules (not admin-*). */
export const filterGuidelineIdsForRootRules = (
  ids: readonly GuidelinePackageId[]
): GuidelinePackageId[] =>
  ids.filter((id): id is GuidelinePackageId => id === "api" || id === "ui" || id === "syncdb");
