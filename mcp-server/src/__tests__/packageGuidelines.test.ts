import {afterEach, beforeEach, describe, expect, it} from "bun:test";
import {mkdirSync, mkdtempSync, rmSync, writeFileSync} from "node:fs";
import {tmpdir} from "node:os";
import {join} from "node:path";

import {
  composePackageGuidelinesForRules,
  filterGuidelineIdsForRootRules,
  type GuidelinePackageId,
  loadPackageGuidelineMarkdown,
  resolveBootstrapGuidelinePackages,
} from "../packageGuidelines.js";

const ALL_PACKAGES: GuidelinePackageId[] = [
  "api",
  "ui",
  "rtk",
  "syncdb",
  "admin-backend",
  "admin-frontend",
];

describe("resolveBootstrapGuidelinePackages", () => {
  it("returns every package when nothing is requested", (): void => {
    expect(resolveBootstrapGuidelinePackages()).toEqual(ALL_PACKAGES);
    expect(resolveBootstrapGuidelinePackages([])).toEqual(ALL_PACKAGES);
  });

  it("normalizes scoped and mixed-case ids, drops unknown ids, and dedupes", (): void => {
    expect(
      resolveBootstrapGuidelinePackages([
        " @terreno/Admin-Backend ",
        "ADMIN-FRONTEND",
        "unknown",
        "@terreno/syncdb",
        "admin-backend",
      ])
    ).toEqual(["admin-backend", "admin-frontend", "syncdb"]);
  });

  it("falls back to every package when no requested id is known", (): void => {
    expect(resolveBootstrapGuidelinePackages(["mobile", "@terreno/web"])).toEqual(ALL_PACKAGES);
  });
});

describe("filterGuidelineIdsForRootRules", () => {
  it("keeps only packages merged into root rules", (): void => {
    expect(
      filterGuidelineIdsForRootRules(["admin-backend", "api", "admin-frontend", "ui"])
    ).toEqual(["api", "ui"]);
  });
});

describe("package guideline markdown", () => {
  let docsRoot: string;
  let previousDocsDir: string | undefined;

  const writeGuideline = (packageId: string, content: string): void => {
    const dir = join(docsRoot, "guidelines", packageId, "guidelines");
    mkdirSync(dir, {recursive: true});
    writeFileSync(join(dir, "core.md"), content);
  };

  beforeEach((): void => {
    docsRoot = mkdtempSync(join(tmpdir(), "terreno-package-guidelines-"));
    previousDocsDir = process.env.TERRENO_MCP_DOCS_DIR;
    process.env.TERRENO_MCP_DOCS_DIR = docsRoot;
  });

  afterEach((): void => {
    rmSync(docsRoot, {force: true, recursive: true});
    if (previousDocsDir === undefined) {
      Reflect.deleteProperty(process.env, "TERRENO_MCP_DOCS_DIR");
    } else {
      process.env.TERRENO_MCP_DOCS_DIR = previousDocsDir;
    }
  });

  it("returns null when a package has no bundled guideline file", (): void => {
    expect(loadPackageGuidelineMarkdown("api")).toBeNull();
    expect(composePackageGuidelinesForRules(["api", "ui"])).toBe("");
  });

  it("loads trimmed guideline bodies and joins only the packages that have one", (): void => {
    writeGuideline("api", "\n# API rules\n\n");
    writeGuideline("rtk", "# RTK rules\n");

    expect(loadPackageGuidelineMarkdown("api")).toBe("# API rules");
    expect(composePackageGuidelinesForRules(["api", "ui", "rtk"])).toBe(
      "# API rules\n\n---\n\n# RTK rules"
    );
  });
});
