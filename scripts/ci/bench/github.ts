/**
 * `BenchAdapter` backed by git and the `gh` CLI. Branches are built in a temporary
 * worktree so the caller's checkout is never touched.
 */
import {execFileSync} from "node:child_process";
import {appendFileSync, mkdtempSync, rmSync} from "node:fs";
import {tmpdir} from "node:os";
import {join} from "node:path";

import {githubPullRequestSource} from "../ciWallClock/github";
import {type BenchAdapter, type FileChange, MASTER_REF, touchLine} from "./lib";

const BENCH_LABEL = "ci-bench";

const exec = ({args, command, cwd}: {args: string[]; command: string; cwd: string}): string =>
  execFileSync(command, args, {cwd, encoding: "utf8", maxBuffer: 64 * 1024 * 1024});

export const githubBenchAdapter = ({repoRoot}: {repoRoot: string}): BenchAdapter => {
  const git = (args: string[], cwd = repoRoot): string => exec({args, command: "git", cwd});
  const gh = (args: string[]): string => exec({args, command: "gh", cwd: repoRoot});
  const statuses = githubPullRequestSource({cwd: repoRoot});
  let isLabelReady = false;

  return {
    caseChanges: async (
      pullRequest: number
    ): Promise<{changes: FileChange[]; parentSha: string}> => {
      const mergeSha = gh([
        "pr",
        "view",
        String(pullRequest),
        "--json",
        "mergeCommit",
        "-q",
        ".mergeCommit.oid",
      ]).trim();
      if (!mergeSha) {
        throw new Error(`#${pullRequest} has no merge commit`);
      }
      const parentSha = git(["rev-parse", `${mergeSha}^`]).trim();
      const changes = git(["diff", "--no-renames", "--name-status", parentSha, mergeSha])
        .split("\n")
        .filter((line) => line.length > 0)
        .map((line) => {
          const [status, path] = line.split("\t");
          return {path, status};
        });
      return {changes, parentSha};
    },
    closePullRequest: async ({number}: {branch: string; number: number}): Promise<void> => {
      gh(["pr", "close", String(number), "--delete-branch"]);
    },
    experimentFiles: async (branch: string): Promise<string[]> =>
      git(["diff", "--name-only", `${MASTER_REF}...${branch}`])
        .split("\n")
        .filter((line) => line.length > 0),
    listStatuses: statuses.listStatuses,
    now: (): number => Date.now(),
    openDraftPullRequest: async ({
      branch,
      title,
    }: {
      branch: string;
      title: string;
    }): Promise<number> => {
      if (!isLabelReady) {
        gh([
          "label",
          "create",
          BENCH_LABEL,
          "--force",
          "--description",
          "CircleCI speed benchmark replay; closed automatically",
        ]);
        isLabelReady = true;
      }
      const url = gh([
        "pr",
        "create",
        "--draft",
        "--base",
        "master",
        "--head",
        branch,
        "--label",
        BENCH_LABEL,
        "--title",
        title,
        "--body",
        "Benchmark replay for docs/implementationPlans/circleci-pr-speed-loop.md. Do not review or merge; `bun run ci:bench` closes it.",
      ]).trim();
      return Number(url.split("/").pop());
    },
    prepareBranch: async ({baseRef, name, operations}): Promise<{headSha: string}> => {
      const worktree = mkdtempSync(join(tmpdir(), "ci-bench-"));
      try {
        git(["worktree", "add", "--quiet", "--detach", worktree, baseRef]);
        for (const operation of operations) {
          if (operation.kind === "restore") {
            git(["checkout", operation.sha, "--", operation.path], worktree);
          } else if (operation.kind === "remove") {
            git(["rm", "--quiet", "--ignore-unmatch", "--", operation.path], worktree);
          } else {
            appendFileSync(join(worktree, operation.path), touchLine(operation.path));
            git(["add", "--", operation.path], worktree);
          }
        }
        git(
          ["commit", "--quiet", "--allow-empty", "--no-verify", "-m", `ci-bench: ${name}`],
          worktree
        );
        git(["push", "--quiet", "--force", "origin", `HEAD:refs/heads/${name}`], worktree);
        return {headSha: git(["rev-parse", "HEAD"], worktree).trim()};
      } finally {
        git(["worktree", "remove", "--force", worktree]);
        rmSync(worktree, {force: true, recursive: true});
      }
    },
    sleep: (milliseconds: number): Promise<void> =>
      new Promise((resolve) => setTimeout(resolve, milliseconds)),
  };
};
