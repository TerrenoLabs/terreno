/**
 * `BenchAdapter` backed by git and the `gh` CLI. Branches are built in a temporary
 * worktree so the caller's checkout is never touched.
 */
import {execFileSync} from "node:child_process";
import {appendFileSync, mkdtempSync, rmSync} from "node:fs";
import {tmpdir} from "node:os";
import {join} from "node:path";

import {githubPullRequestSource} from "../ciWallClock/github";
import {type BenchAdapter, type FileChange, MASTER_REF, nearestTouchTarget, touchLine} from "./lib";

const BENCH_LABEL = "ci-bench";

/** `git diff -z --name-status` output: status and path alternate, NUL-separated, unquoted. */
const parseNameStatus = (output: string): FileChange[] => {
  const fields = output.split("\0").filter((field) => field.length > 0);
  const changes: FileChange[] = [];
  for (let index = 0; index + 1 < fields.length; index += 2) {
    changes.push({path: fields[index + 1], status: fields[index]});
  }
  return changes;
};

const exec = ({args, command, cwd}: {args: string[]; command: string; cwd: string}): string =>
  execFileSync(command, args, {
    cwd,
    encoding: "utf8",
    maxBuffer: 64 * 1024 * 1024,
    stdio: ["ignore", "pipe", "pipe"],
  });

export const githubBenchAdapter = ({repoRoot}: {repoRoot: string}): BenchAdapter => {
  const git = (args: string[], cwd = repoRoot): string => exec({args, command: "git", cwd});
  const gh = (args: string[]): string => exec({args, command: "gh", cwd: repoRoot});
  const statuses = githubPullRequestSource({cwd: repoRoot});
  const caseDiff = ({
    mergeSha,
    parentSha,
    paths,
  }: {
    mergeSha: string;
    parentSha: string;
    paths: string[];
  }): string => git(["diff", "--binary", "--no-renames", parentSha, mergeSha, "--", ...paths]);
  let isLabelReady = false;

  return {
    caseChanges: async (
      pullRequest: number
    ): Promise<{changes: FileChange[]; mergeSha: string; parentSha: string}> => {
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
      const changes = parseNameStatus(
        git(["diff", "-z", "--no-renames", "--name-status", parentSha, mergeSha])
      );
      return {changes, mergeSha, parentSha};
    },
    closePullRequest: async ({number}: {branch: string; number: number}): Promise<void> => {
      gh(["pr", "close", String(number), "--delete-branch"]);
    },
    deleteBranch: async (branch: string): Promise<void> => {
      git(["push", "--quiet", "origin", "--delete", branch]);
    },
    experimentFiles: async (branch: string): Promise<FileChange[]> =>
      parseNameStatus(
        git(["diff", "-z", "--no-renames", "--name-status", `${MASTER_REF}...${branch}`])
      ),
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
      const number = Number(url.split("/").pop());
      if (!Number.isInteger(number)) {
        throw new Error(`gh pr create returned no PR URL: ${url}`);
      }
      return number;
    },
    prepareBranch: async ({baseRef, name, operations}): Promise<{headSha: string}> => {
      const worktree = mkdtempSync(join(tmpdir(), "ci-bench-"));
      try {
        git(["worktree", "add", "--quiet", "--detach", worktree, baseRef]);
        // Revert first, then pick touch targets from the reverted tree, so a touch never
        // lands on a file the revert just removed.
        for (const operation of operations) {
          if (operation.kind === "revert") {
            execFileSync("git", ["apply", "-R", "--index"], {
              cwd: worktree,
              input: caseDiff(operation),
              stdio: ["pipe", "pipe", "pipe"],
            });
          }
        }
        const trackedFiles = git(["ls-files", "-z"], worktree).split("\0").filter(Boolean);
        const touched = new Set<string>();
        for (const operation of operations) {
          if (operation.kind !== "touch") {
            continue;
          }
          const target = nearestTouchTarget({path: operation.path, trackedFiles});
          if (target === undefined || touched.has(target)) {
            continue;
          }
          touched.add(target);
          appendFileSync(join(worktree, target), touchLine(target));
          git(["add", "--", target], worktree);
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
    revertConflicts: async ({mergeSha, parentSha, paths}): Promise<string | undefined> => {
      // Check against a throwaway index of master: no checkout needed.
      const indexDirectory = mkdtempSync(join(tmpdir(), "ci-bench-index-"));
      const env = {...process.env, GIT_INDEX_FILE: join(indexDirectory, "index")};
      try {
        execFileSync("git", ["read-tree", MASTER_REF], {cwd: repoRoot, env});
        execFileSync("git", ["apply", "-R", "--cached", "--check"], {
          cwd: repoRoot,
          env,
          input: caseDiff({mergeSha, parentSha, paths}),
          stdio: ["pipe", "pipe", "pipe"],
        });
        return undefined;
      } catch (error) {
        const stderr = (error as {stderr?: Buffer}).stderr?.toString().trim();
        return stderr?.split("\n")[0] || String(error);
      } finally {
        rmSync(indexDirectory, {force: true, recursive: true});
      }
    },
    sleep: (milliseconds: number): Promise<void> =>
      new Promise((resolve) => setTimeout(resolve, milliseconds)),
  };
};
