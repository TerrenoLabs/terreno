import {describe, it} from "bun:test";
import {mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync} from "node:fs";
import {tmpdir} from "node:os";
import {join} from "node:path";
import {assert} from "chai";

const SCRIPT_PATH = join(import.meta.dir, "prepare-package-publish.mjs");

describe("prepare-package-publish", () => {
  it("pins the unscoped create-terreno-app dependency for MCP releases", () => {
    const repoRoot = mkdtempSync(join(tmpdir(), "prepare-package-publish-"));
    try {
      mkdirSync(join(repoRoot, "mcp-server"), {recursive: true});
      writeFileSync(join(repoRoot, "package.json"), JSON.stringify({catalog: {}}));
      writeFileSync(join(repoRoot, "CHANGELOG.md"), "# Changelog\n\n## [58.0.0] - 2026-10-26\n");
      writeFileSync(
        join(repoRoot, "mcp-server/package.json"),
        JSON.stringify({
          dependencies: {
            "@terreno/api": "workspace:*",
            "create-terreno-app": "workspace:*",
          },
          name: "@terreno/mcp",
          version: "1.0.0",
        })
      );

      const result = Bun.spawnSync({
        cmd: ["bun", SCRIPT_PATH, "mcp-server", "58.0.0", "release"],
        cwd: repoRoot,
        stderr: "pipe",
        stdout: "pipe",
      });
      assert.equal(result.exitCode, 0, result.stderr.toString());

      const publishedPackage = JSON.parse(
        readFileSync(join(repoRoot, "mcp-server/package.json"), "utf8")
      ) as {dependencies: Record<string, string>; version: string};
      assert.equal(publishedPackage.version, "58.0.0");
      assert.equal(publishedPackage.dependencies["@terreno/api"], "58.0.0");
      assert.equal(publishedPackage.dependencies["create-terreno-app"], "58.0.0");
      assert.include(
        readFileSync(join(repoRoot, "mcp-server/CHANGELOG.md"), "utf8"),
        "## [58.0.0]",
        "the root changelog ships inside the package"
      );
    } finally {
      rmSync(repoRoot, {force: true, recursive: true});
    }
  });
});
