import {describe, it, setDefaultTimeout} from "bun:test";
import {spawnSync} from "node:child_process";
import {mkdirSync, mkdtempSync, readFileSync, writeFileSync} from "node:fs";
import {tmpdir} from "node:os";
import {dirname, join} from "node:path";
import {assert} from "chai";

const script = join(import.meta.dir, "map-changed-files.sh");

setDefaultTimeout(30_000);

const git = ({args, cwd}: {args: string[]; cwd: string}): string => {
  const result = spawnSync("git", args, {cwd, encoding: "utf8"});
  if (result.status !== 0) {
    throw new Error(`git ${args.join(" ")} failed: ${result.stderr}`);
  }
  return result.stdout.trim();
};

const writeFiles = ({files, root}: {files: string[]; root: string}): void => {
  for (const file of files) {
    mkdirSync(dirname(join(root, file)), {recursive: true});
    writeFileSync(join(root, file), `${file}\n`);
  }
};

const commit = ({files, message, root}: {files: string[]; message: string; root: string}): void => {
  writeFiles({files, root});
  git({args: ["add", "-A"], cwd: root});
  git({args: ["commit", "-q", "-m", message], cwd: root});
};

const createRepo = (): string => {
  const root = mkdtempSync(join(tmpdir(), "map-changed-files-"));
  git({args: ["init", "-q", "-b", "master"], cwd: root});
  git({args: ["config", "user.email", "ci@example.com"], cwd: root});
  git({args: ["config", "user.name", "CI"], cwd: root});
  commit({files: ["README.md"], message: "init", root});
  return root;
};

const run = ({
  mapping,
  root,
}: {
  mapping: string;
  root: string;
}): {
  parameters: Record<string, unknown>;
  status: number | null;
  stderr: string;
  stdout: string;
} => {
  const outputPath = join(root, "..", `${root.split("/").pop()}-params.json`);
  // CircleCI sets these for the real checkout; the fixture repo must use its own HEAD.
  const {BASE_REVISION: _base, CIRCLE_SHA1: _sha, ...parentEnv} = process.env;
  const result = spawnSync("bash", [script], {
    cwd: root,
    encoding: "utf8",
    env: {
      ...parentEnv,
      CHANGED_FILES_PATH: `${outputPath}.files`,
      MAPPING: mapping,
      OUTPUT_PATH: outputPath,
    },
  });
  const parameters =
    result.status === 0
      ? (JSON.parse(readFileSync(outputPath, "utf8")) as Record<string, unknown>)
      : {};
  return {parameters, status: result.status, stderr: result.stderr, stdout: result.stdout};
};

const MAPPING = [
  "# comment lines and blank lines are ignored",
  "",
  "api/.* run-api true",
  "ui/.* run-ui true",
  "website/.* run-deploy-docs true",
  "bun\\.lock run-smoke true",
].join("\n");

describe("map-changed-files.sh", () => {
  it("sets parameters for mappings that match files changed on a branch", () => {
    const root = createRepo();
    git({args: ["checkout", "-q", "-b", "feature"], cwd: root});
    commit({files: ["api/src/index.ts", "docs/notes.md"], message: "change api", root});

    const {parameters, status, stderr} = run({mapping: MAPPING, root});

    assert.equal(status, 0, stderr);
    assert.deepEqual(parameters, {"run-api": true});
  });

  it("compares with the previous commit on the base branch itself", () => {
    const root = createRepo();
    commit({files: ["ui/src/Button.tsx"], message: "change ui", root});

    const {parameters, status, stderr} = run({mapping: MAPPING, root});

    assert.equal(status, 0, stderr);
    assert.deepEqual(parameters, {"run-ui": true});
  });

  it("anchors each regex to the whole path", () => {
    const root = createRepo();
    git({args: ["checkout", "-q", "-b", "feature"], cwd: root});
    commit({files: ["nested/api/x.ts", "bun.lockb"], message: "near misses", root});

    const {parameters, status, stderr} = run({mapping: MAPPING, root});

    assert.equal(status, 0, stderr);
    assert.deepEqual(parameters, {});
  });

  it("keeps non-boolean values and lets a later matching line win", () => {
    const root = createRepo();
    git({args: ["checkout", "-q", "-b", "feature"], cwd: root});
    commit({files: ["api/a.ts"], message: "change api", root});

    const {parameters, status, stderr} = run({
      mapping: "api/.* target staging\napi/.* target production\napi/.* count 3",
      root,
    });

    assert.equal(status, 0, stderr);
    assert.deepEqual(parameters, {count: 3, target: "production"});
  });

  it("reads the mapping from a file", () => {
    const root = createRepo();
    git({args: ["checkout", "-q", "-b", "feature"], cwd: root});
    commit({files: ["api/a.ts"], message: "change api", root});
    const mappingPath = join(root, "..", `${root.split("/").pop()}-mapping.txt`);
    writeFileSync(mappingPath, MAPPING);

    const {parameters, status, stderr} = run({mapping: mappingPath, root});

    assert.equal(status, 0, stderr);
    assert.deepEqual(parameters, {"run-api": true});
  });

  it("rejects a malformed mapping line", () => {
    const root = createRepo();

    const {status, stderr} = run({mapping: "api/.* run-api", root});

    assert.equal(status, 1);
    assert.include(stderr, "expected '<regex> <parameter> <value>'");
  });

  it("fails when MAPPING is empty", () => {
    const root = createRepo();

    const {status, stderr} = run({mapping: "", root});

    assert.equal(status, 1);
    assert.include(stderr, "MAPPING is empty");
  });

  it("maps a docs-cut sized commit against the real setup mapping in seconds", () => {
    const root = createRepo();
    const files = Array.from(
      {length: 1800},
      (_, index) => `website/versioned_docs/version-99.0.0/page-${index}.md`
    );
    commit({files, message: "chore: cut docs version 99.0.0", root});
    const setupConfig = readFileSync(
      join(import.meta.dir, "..", "..", ".circleci", "config.yml"),
      "utf8"
    );
    const mappingLines: string[] = [];
    for (const line of setupConfig.split("mapping: |\n")[1].split("\n")) {
      if (!line.startsWith("            ")) {
        break;
      }
      mappingLines.push(line);
    }
    const mapping = mappingLines.join("\n");

    const startedAt = performance.now();
    const {parameters, status, stderr} = run({mapping, root});
    const elapsedMs = performance.now() - startedAt;

    assert.equal(status, 0, stderr);
    assert.deepEqual(parameters, {"run-deploy-docs": true});
    assert.isBelow(elapsedMs, 20_000);
  });
});
