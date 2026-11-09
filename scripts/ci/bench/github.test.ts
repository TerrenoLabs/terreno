import {afterEach, describe, expect, it} from "bun:test";
import {execFileSync} from "node:child_process";
import {mkdirSync, mkdtempSync, readdirSync, rmSync, writeFileSync} from "node:fs";
import {tmpdir} from "node:os";
import {dirname, join} from "node:path";

import {githubBenchAdapter} from "./github";

const roots: string[] = [];

const git = (cwd: string, args: string[]): string =>
  execFileSync("git", args, {cwd, encoding: "utf8"}).trim();

const commitFiles = (repo: string, files: Record<string, string>, message: string): string => {
  for (const [path, contents] of Object.entries(files)) {
    mkdirSync(dirname(join(repo, path)), {recursive: true});
    writeFileSync(join(repo, path), contents);
  }
  git(repo, ["add", "--all"]);
  git(repo, ["commit", "--quiet", "--allow-empty", "-m", message]);
  return git(repo, ["rev-parse", "HEAD"]);
};

/** A clone whose `origin` is a local bare repository, so pushes never leave the machine. */
const createRepo = (): string => {
  const root = mkdtempSync(join(tmpdir(), "ci-bench-test-"));
  roots.push(root);
  const origin = join(root, "origin.git");
  const repo = join(root, "repo");
  execFileSync("git", ["init", "--quiet", "--bare", "--initial-branch=master", origin]);
  execFileSync("git", ["clone", "--quiet", origin, repo], {stdio: "ignore"});
  git(repo, ["config", "user.email", "bench@example.com"]);
  git(repo, ["config", "user.name", "Bench"]);
  git(repo, ["config", "commit.gpgsign", "false"]);
  return repo;
};

const pushMaster = (repo: string): void => {
  git(repo, ["push", "--quiet", "origin", "HEAD:master"]);
  git(repo, ["fetch", "--quiet", "origin"]);
};

afterEach(() => {
  for (const root of roots.splice(0)) {
    rmSync(root, {force: true, recursive: true});
  }
});

describe("githubBenchAdapter git operations", () => {
  it("reverts only the case's hunks, keeps later work, and never touches a file the revert removed", async () => {
    const repo = createRepo();
    commitFiles(
      repo,
      {"pkg/keep.json": "{}\n", "pkg/util.ts": "a\nb\nc\n", "README.md": "# repo\n"},
      "base"
    );
    const parentSha = git(repo, ["rev-parse", "HEAD"]);
    const mergeSha = commitFiles(
      repo,
      {"pkg/a.ts": "export const a = 1;\n", "pkg/util.ts": "a\nB\nc\n"},
      "case adds pkg/a.ts and edits util"
    );
    commitFiles(repo, {"pkg/util.ts": "a\nB\nc\nlater\n"}, "later work in the same file");
    pushMaster(repo);
    const adapter = githubBenchAdapter({repoRoot: repo});

    const {headSha} = await adapter.prepareBranch({
      baseRef: "origin/master",
      name: "ci-bench/test/case-1-control",
      operations: [
        {kind: "revert", mergeSha, parentSha, paths: ["pkg/a.ts", "pkg/util.ts"]},
        {kind: "touch", path: "pkg/new.ts"},
      ],
    });

    git(repo, ["fetch", "--quiet", "origin"]);
    expect(git(repo, ["rev-parse", "origin/ci-bench/test/case-1-control"])).toBe(headSha);
    expect(git(repo, ["diff", "--name-status", "origin/master", headSha])).toBe(
      ["D\tpkg/a.ts", "M\tpkg/util.ts"].join("\n")
    );
    // The case's B is reverted, the later line stays, and the touch lands on util.ts (the
    // nearest file with comment syntax once a.ts is gone), not on the removed a.ts.
    expect(git(repo, ["show", `${headSha}:pkg/util.ts`])).toBe("a\nb\nc\nlater\n// ci-bench");
    expect(git(repo, ["worktree", "list"]).split("\n")).toHaveLength(1);
  });

  it("explains why a case no longer reverts when later work overlaps its hunks", async () => {
    const repo = createRepo();
    commitFiles(repo, {"api/a.ts": "1\n", "api/b.ts": "1\n"}, "base");
    const parentSha = git(repo, ["rev-parse", "HEAD"]);
    const mergeSha = commitFiles(repo, {"api/a.ts": "2\n", "api/b.ts": "2\n"}, "case");
    commitFiles(repo, {"api/b.ts": "3\n"}, "later work rewrites the case's line");
    pushMaster(repo);
    const adapter = githubBenchAdapter({repoRoot: repo});

    expect(
      await adapter.revertConflicts({mergeSha, parentSha, paths: ["api/a.ts"]})
    ).toBeUndefined();
    expect(
      await adapter.revertConflicts({mergeSha, parentSha, paths: ["api/a.ts", "api/b.ts"]})
    ).toBe("error: patch failed: api/b.ts:1");
  });

  it("treats bracketed Expo Router paths literally when reverting", async () => {
    const repo = createRepo();
    commitFiles(repo, {"app/[model].tsx": "1\n", "app/m.tsx": "1\n"}, "base");
    const parentSha = git(repo, ["rev-parse", "HEAD"]);
    const mergeSha = commitFiles(repo, {"app/[model].tsx": "2\n", "app/m.tsx": "2\n"}, "case");
    pushMaster(repo);
    const adapter = githubBenchAdapter({repoRoot: repo});

    const {headSha} = await adapter.prepareBranch({
      baseRef: "origin/master",
      name: "ci-bench/test/brackets-1-treatment",
      operations: [{kind: "revert", mergeSha, parentSha, paths: ["app/[model].tsx"]}],
    });

    git(repo, ["fetch", "--quiet", "origin"]);
    expect(git(repo, ["diff", "--name-only", "origin/master", headSha])).toBe("app/[model].tsx");
  });

  it("surfaces the git error and leaves no temp directory when the base ref does not exist", async () => {
    const repo = createRepo();
    commitFiles(repo, {"README.md": "# repo\n"}, "base");
    pushMaster(repo);
    const adapter = githubBenchAdapter({repoRoot: repo});
    const leftovers = (): string[] =>
      readdirSync(tmpdir()).filter(
        (entry) => entry.startsWith("ci-bench-") && !entry.startsWith("ci-bench-test-")
      );
    const before = leftovers();

    await expect(
      adapter.prepareBranch({
        baseRef: "origin/no-such-branch",
        name: "ci-bench/test/x",
        operations: [],
      })
    ).rejects.toThrow("origin/no-such-branch");
    expect(leftovers()).toEqual(before);
  });

  it("deletes a pushed bench branch", async () => {
    const repo = createRepo();
    commitFiles(repo, {"README.md": "# repo\n"}, "base");
    pushMaster(repo);
    git(repo, ["push", "--quiet", "origin", "HEAD:refs/heads/ci-bench/test/orphan"]);
    const adapter = githubBenchAdapter({repoRoot: repo});

    await adapter.deleteBranch("ci-bench/test/orphan");

    expect(git(repo, ["ls-remote", "origin", "refs/heads/ci-bench/*"])).toBe("");
  });
});
