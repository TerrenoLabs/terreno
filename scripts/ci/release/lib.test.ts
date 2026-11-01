import {describe, expect, it} from "bun:test";

import {checkReleaseTag, planBotMerge, renderReleaseNotes} from "./lib";

const CHANGELOG = `# Changelog

## [Unreleased]

See changelog/unreleased/.

## [57.19.0] - 2026-10-26

### Added

- Ship CHANGELOG.md in every package. (#1621)

## [57.18.0] - 2026-10-25

### Added

- Vercel hosting. (#1562)
`;

const TRUSTED = {allowedAuthors: "joshgachnang, swanka", author: "joshgachnang"};

const RELEASE_FILES = [
  "CHANGELOG.md",
  "changelog/unreleased/ship-changelog.md",
  "example-frontend/constants/whatsNew.generated.json",
  "mcp-server/src/docs/upgrades/57.19.0.md",
];

describe("planBotMerge", () => {
  it("merges a release branch that only touches release notes", () => {
    const plan = planBotMerge({
      ...TRUSTED,
      changelog: CHANGELOG,
      files: RELEASE_FILES,
      headRef: "release/57.19.0",
    });
    expect(plan).toMatchObject({isEligible: true, kind: "release", version: "57.19.0"});
  });

  it("accepts the Cursor release branch prefix", () => {
    const plan = planBotMerge({
      ...TRUSTED,
      changelog: CHANGELOG,
      files: ["CHANGELOG.md"],
      headRef: "cursor/release-57.19.0",
    });
    expect(plan.isEligible).toBe(true);
    expect(plan.version).toBe("57.19.0");
  });

  it("refuses a release branch that also changes code", () => {
    const plan = planBotMerge({
      ...TRUSTED,
      changelog: CHANGELOG,
      files: [...RELEASE_FILES, "api/src/api.ts", ".rulesync/skills/release/SKILL.md"],
      headRef: "release/57.19.0",
    });
    expect(plan.isEligible).toBe(false);
    expect(plan.disallowedFiles).toEqual(["api/src/api.ts", ".rulesync/skills/release/SKILL.md"]);
  });

  it("refuses a release branch whose changelog has no section for the version", () => {
    const plan = planBotMerge({
      ...TRUSTED,
      changelog: CHANGELOG,
      files: ["CHANGELOG.md"],
      headRef: "release/57.20.0",
    });
    expect(plan.isEligible).toBe(false);
    expect(plan.reason).toContain("## [57.20.0]");
  });

  it("refuses prerelease and malformed release branch names", () => {
    for (const headRef of ["release/57.19.0-beta.1", "release/next", "release/57.19.0/x"]) {
      expect(
        planBotMerge({
          ...TRUSTED,
          changelog: CHANGELOG,
          files: ["CHANGELOG.md"],
          headRef,
        }).isEligible
      ).toBe(false);
    }
  });

  it("merges a roadmap branch that only touches roadmap files", () => {
    const plan = planBotMerge({
      ...TRUSTED,
      files: ["ROADMAP.md", "docs/explanation/roadmap-seed-issues.md"],
      headRef: "automation/roadmap-40320206760",
    });
    expect(plan).toMatchObject({isEligible: true, kind: "roadmap"});
  });

  it("refuses roadmap branches that touch release notes or code", () => {
    const plan = planBotMerge({
      ...TRUSTED,
      files: ["ROADMAP.md", "CHANGELOG.md"],
      headRef: "automation/roadmap-1",
    });
    expect(plan.isEligible).toBe(false);
    expect(plan.disallowedFiles).toEqual(["CHANGELOG.md"]);
  });

  it("ignores other branches and empty pull requests", () => {
    expect(
      planBotMerge({
        ...TRUSTED,
        files: ["ROADMAP.md"],
        headRef: "fix-login",
      }).isEligible
    ).toBe(false);
    expect(
      planBotMerge({
        ...TRUSTED,
        files: [],
        headRef: "automation/roadmap-1",
      }).isEligible
    ).toBe(false);
  });
});

describe("planBotMerge authors", () => {
  it("accepts any listed author, ignoring case and separators", () => {
    for (const author of ["joshgachnang", "Swanka"]) {
      const plan = planBotMerge({
        allowedAuthors: "joshgachnang,\n swanka ",
        author,
        files: ["ROADMAP.md"],
        headRef: "automation/roadmap-1",
      });
      expect(plan.isEligible).toBe(true);
    }
  });

  it("refuses an unlisted author before looking at files", () => {
    const plan = planBotMerge({
      allowedAuthors: "joshgachnang",
      author: "someone-else",
      files: ["ROADMAP.md"],
      headRef: "automation/roadmap-1",
    });
    expect(plan.isEligible).toBe(false);
    expect(plan.reason).toContain("someone-else is not in BOT_MERGE_AUTHORS");
  });

  it("refuses everyone when the allowlist is empty", () => {
    const plan = planBotMerge({
      allowedAuthors: " , ",
      author: "joshgachnang",
      files: ["ROADMAP.md"],
      headRef: "automation/roadmap-1",
    });
    expect(plan.isEligible).toBe(false);
  });

  it("does not match a login that is only a substring of a listed one", () => {
    const plan = planBotMerge({
      allowedAuthors: "joshgachnang",
      author: "josh",
      files: ["ROADMAP.md"],
      headRef: "automation/roadmap-1",
    });
    expect(plan.isEligible).toBe(false);
  });
});

describe("checkReleaseTag", () => {
  it("passes a stable tag on master with an assembled changelog", () => {
    const result = checkReleaseTag({
      changelog: CHANGELOG,
      isOnMaster: true,
      unreleasedFragmentCount: 0,
      version: "57.19.0",
    });
    expect(result).toEqual({failures: [], isValid: true});
  });

  it("fails a stable tag that is off master, lacks notes, and has leftover fragments", () => {
    const result = checkReleaseTag({
      changelog: CHANGELOG,
      isOnMaster: false,
      unreleasedFragmentCount: 2,
      version: "57.20.0",
    });
    expect(result.isValid).toBe(false);
    expect(result.failures).toHaveLength(3);
  });

  it("lets prereleases publish from any branch without assembled notes", () => {
    expect(
      checkReleaseTag({
        changelog: CHANGELOG,
        isOnMaster: false,
        unreleasedFragmentCount: 3,
        version: "57.20.0-beta.1",
      }).isValid
    ).toBe(true);
  });

  it("rejects a non-semver tag", () => {
    expect(
      checkReleaseTag({
        changelog: CHANGELOG,
        isOnMaster: true,
        unreleasedFragmentCount: 0,
        version: "v1",
      }).isValid
    ).toBe(false);
  });
});

describe("renderReleaseNotes", () => {
  it("renders the version section with a compare link", () => {
    const notes = renderReleaseNotes({
      changelog: CHANGELOG,
      previousVersion: "57.18.0",
      repository: "TerrenoLabs/terreno",
      version: "57.19.0",
    });
    expect(notes).toContain("Ship CHANGELOG.md in every package.");
    expect(notes).not.toContain("Vercel hosting");
    expect(notes).toContain("compare/57.18.0...57.19.0");
  });

  it("throws when the version has no section", () => {
    expect(() =>
      renderReleaseNotes({
        changelog: CHANGELOG,
        repository: "TerrenoLabs/terreno",
        version: "1.0.0",
      })
    ).toThrow();
  });
});
