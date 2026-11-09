import {describe, it} from "bun:test";
import {mkdirSync, mkdtempSync, readFileSync, writeFileSync} from "node:fs";
import {tmpdir} from "node:os";
import {dirname, join} from "node:path";
import {assert} from "chai";

import {isWhatsNewFileCurrent, writeWhatsNewFile} from "./io";
import {WHATS_NEW_OUTPUT_PATH} from "./lib";

const writeRepo = (changelog: string): string => {
  const repoRoot = mkdtempSync(join(tmpdir(), "whats-new-"));
  mkdirSync(dirname(join(repoRoot, WHATS_NEW_OUTPUT_PATH)), {recursive: true});
  writeFileSync(join(repoRoot, "CHANGELOG.md"), changelog);
  return repoRoot;
};

const CHANGELOG = "# Changelog\n\n## [1.0.0] - 2026-10-01\n\n### Added\n\n- First.\n";

describe("whats-new io", () => {
  it("reports a missing data file as stale", (): void => {
    assert.isFalse(isWhatsNewFileCurrent(writeRepo(CHANGELOG)));
  });

  it("writes data that then reads as current", (): void => {
    const repoRoot = writeRepo(CHANGELOG);
    const outputPath = writeWhatsNewFile(repoRoot);
    assert.include(readFileSync(outputPath, "utf8"), '"version": "1.0.0"');
    assert.isTrue(isWhatsNewFileCurrent(repoRoot));
  });

  it("reports a new release as stale until regenerated", (): void => {
    const repoRoot = writeRepo(CHANGELOG);
    writeWhatsNewFile(repoRoot);
    writeFileSync(
      join(repoRoot, "CHANGELOG.md"),
      CHANGELOG.replace(
        "## [1.0.0]",
        "## [1.1.0] - 2026-10-02\n\n### Fixed\n\n- Bug.\n\n## [1.0.0]"
      )
    );
    assert.isFalse(isWhatsNewFileCurrent(repoRoot));
  });
});
