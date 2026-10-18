import {describe, expect, it} from "bun:test";
import {
  checkPublishedPackageDocs,
  findInternalLeakageHits,
  isNonStubReadme,
  parsePublishWorkingDirectories,
  referencePageForPackage,
} from "./docs-audit";

describe("docs-audit helpers", () => {
  it("parses unique working directories from publish-on-tag.yml", () => {
    const yaml = `
publish-api:
  defaults:
    run:
      working-directory: api
publish-ui:
  defaults:
    run:
      working-directory: ui
publish-ui-types:
  defaults:
    run:
      working-directory: ui
publish-feature-flags:
  defaults:
    run:
      working-directory: feature-flags
`;
    expect(parsePublishWorkingDirectories(yaml)).toEqual(["api", "feature-flags", "ui"]);
  });

  it("maps rtk and mcp-server to their reference pages", () => {
    expect(referencePageForPackage("rtk")).toBe("docs/reference/legacy/rtk.md");
    expect(referencePageForPackage("mcp-server")).toBe("docs/reference/mcp-server.md");
    expect(referencePageForPackage("feature-flags")).toBe("docs/reference/feature-flags.md");
  });

  it("rejects stub READMEs without ## Install", () => {
    expect(isNonStubReadme("short\n")).toBe(false);
    const body = `${"line\n".repeat(31)}## Install\n`;
    expect(isNonStubReadme(body)).toBe(true);
  });

  it("detects internal leakage strings", () => {
    expect(findInternalLeakageHits("see .cursor/rules/api")).toEqual([".cursor/rules"]);
    expect(findInternalLeakageHits("project flourish-terreno")).toEqual(["flourish-terreno"]);
    expect(findInternalLeakageHits("https://github.com/TerrenoLabs/terreno")).toEqual([]);
    expect(findInternalLeakageHits("Slack webhook")).toEqual([]);
  });

  it("names the package when README.md is missing", () => {
    const issues = checkPublishedPackageDocs({
      packageDirs: ["feature-flags"],
      repoRoot: "/tmp/does-not-exist-docs-audit",
    });
    expect(issues.some((issue) => issue.message.includes("feature-flags"))).toBe(true);
    expect(issues.some((issue) => issue.message.includes("missing README.md"))).toBe(true);
  });
});
