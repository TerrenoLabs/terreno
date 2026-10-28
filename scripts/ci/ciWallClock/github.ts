/** `PullRequestSource` backed by the `gh` CLI for the repository in the working directory. */
import {execFileSync} from "node:child_process";

import type {CommitStatus, MergedPullRequest, PullRequestSource} from "./lib";

const gh = ({args, cwd}: {args: string[]; cwd: string}): string =>
  execFileSync("gh", args, {cwd, encoding: "utf8", maxBuffer: 64 * 1024 * 1024});

export const githubPullRequestSource = ({cwd}: {cwd: string}): PullRequestSource => ({
  // `gh pr list --json files` returns at most 100 files per PR, so a PR over 100 files can
  // undercount its directories.
  listMergedPullRequests: async (limit: number): Promise<MergedPullRequest[]> => {
    const pullRequests = JSON.parse(
      gh({
        args: [
          "pr",
          "list",
          "--state",
          "merged",
          "--limit",
          String(limit),
          "--json",
          "number,headRefOid,files",
        ],
        cwd,
      })
    ) as {files: {path: string}[]; headRefOid: string; number: number}[];
    return pullRequests.map((pullRequest) => ({
      files: pullRequest.files.map((file) => file.path),
      headSha: pullRequest.headRefOid,
      number: pullRequest.number,
    }));
  },
  listStatuses: async (sha: string): Promise<CommitStatus[]> => {
    // --slurp joins the pages into one array of pages.
    const pages = JSON.parse(
      gh({
        args: ["api", "--paginate", "--slurp", `repos/{owner}/{repo}/commits/${sha}/statuses`],
        cwd,
      })
    ) as CommitStatus[][];
    return pages.flat();
  },
});
