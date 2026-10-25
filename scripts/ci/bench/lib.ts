/**
 * Benchmark replay for the CircleCI PR speed loop
 * (docs/implementationPlans/circleci-pr-speed-loop.md).
 *
 * A bench case is a past average PR. Replaying it opens a draft PR that reverts the case's
 * hunks, so its diff against `master` touches the same files with real code. Cherry-picking
 * the case would be a no-op on current master, and comment-only edits would not trigger the
 * e2e affected gate, which strips comments.
 *
 * The treatment PR branches from the branch under test. The control PR branches from
 * `master` and touches the files the branch under test changes, so path filtering starts
 * the same workflows for both.
 */
import {
  type CommitStatus,
  finalTestJobStatuses,
  type MergedPullRequest,
  measureCiWallClock,
  topLevelDirectories,
} from "../ciWallClock/lib";

export interface BenchCase {
  name: string;
  pullRequest: number;
}

export interface FileChange {
  path: string;
  /** `git diff --name-status` letter: A (added), M (modified), D (deleted). */
  status: string;
}

export type BranchOperation =
  /** Reverse-apply the case PR's diff (`parentSha..mergeSha`), limited to `paths`. */
  | {kind: "revert"; mergeSha: string; parentSha: string; paths: string[]}
  | {kind: "touch"; path: string};

export type BenchRole = "control" | "treatment";

export interface BenchResult {
  case: string;
  /** Set when closing a PR or deleting a bench branch failed; clean it up by hand. */
  cleanupError?: string;
  lastJob?: string;
  minutes?: number;
  pullRequest?: number;
  reason?: string;
  role: BenchRole;
  run: number;
  status: "ok" | "invalid" | "timeout" | "error";
}

/** git and GitHub side effects, injected so the replay logic is testable. */
export interface BenchAdapter {
  caseChanges: (
    pullRequest: number
  ) => Promise<{changes: FileChange[]; mergeSha: string; parentSha: string}>;
  closePullRequest: (pullRequest: {branch: string; number: number}) => Promise<void>;
  deleteBranch: (branch: string) => Promise<void>;
  /** Files the branch under test changes relative to master, with their status. */
  experimentFiles: (branch: string) => Promise<FileChange[]>;
  /** Why the case's reverse patch does not apply cleanly to master; undefined when it does. */
  revertConflicts: (revert: {
    mergeSha: string;
    parentSha: string;
    paths: string[];
  }) => Promise<string | undefined>;
  listStatuses: (sha: string) => Promise<CommitStatus[]>;
  now: () => number;
  openDraftPullRequest: (pullRequest: {branch: string; title: string}) => Promise<number>;
  prepareBranch: (branch: {
    baseRef: string;
    name: string;
    operations: BranchOperation[];
  }) => Promise<{headSha: string}>;
  sleep: (milliseconds: number) => Promise<void>;
}

export const MASTER_REF = "origin/master";

const COMMENT_BY_EXTENSION: Record<string, string> = {
  cjs: "// ci-bench\n",
  js: "// ci-bench\n",
  jsx: "// ci-bench\n",
  md: "<!-- ci-bench -->\n",
  mjs: "// ci-bench\n",
  sh: "# ci-bench\n",
  toml: "# ci-bench\n",
  ts: "// ci-bench\n",
  tsx: "// ci-bench\n",
  yaml: "# ci-bench\n",
  yml: "# ci-bench\n",
};

/** Text appended to a file so it shows up in the diff without changing behavior. */
export const touchLine = (path: string): string => {
  const extension = path.split(".").pop() ?? "";
  return COMMENT_BY_EXTENSION[extension] ?? "\n";
};

const hasCommentSyntax = (path: string): boolean => touchLine(path) !== "\n";

const parentDirectory = (path: string): string | undefined => {
  const slash = path.lastIndexOf("/");
  return slash === -1 ? undefined : path.slice(0, slash);
};

/**
 * The file a control branch appends to for a path the branch under test changes. A path
 * master does not have yet maps to the nearest existing file with comment syntax in the
 * same directory or a parent, so the same path filters still fire. Undefined when there
 * is none, which skips the touch.
 */
export const nearestTouchTarget = ({
  path,
  trackedFiles,
}: {
  path: string;
  trackedFiles: string[];
}): string | undefined => {
  if (trackedFiles.includes(path)) {
    return path;
  }
  let directory = parentDirectory(path);
  while (true) {
    const prefix = directory === undefined ? "" : `${directory}/`;
    const candidate = trackedFiles
      .filter((file) => file.startsWith(prefix) && !file.slice(prefix.length).includes("/"))
      .filter(hasCommentSyntax)
      .sort()[0];
    if (candidate) {
      return candidate;
    }
    if (directory === undefined) {
      return undefined;
    }
    directory = parentDirectory(directory);
  }
};

/**
 * Docs, changelog, and website edits only drive the docs preview, which the metric ignores,
 * and later docs work makes most old reverts conflict. Replays leave them out.
 */
const NON_REPLAYED_PREFIXES = ["docs/", "changelog/", "website/"];

const replayPaths = (changes: FileChange[]): string[] =>
  changes
    .map((change) => change.path)
    .filter((path) => !NON_REPLAYED_PREFIXES.some((prefix) => path.startsWith(prefix)));

/**
 * Both roles undo the case PR's own hunks, keeping any later work in the same files. Files
 * the branch under test changes are left alone: reverting them would undo the experiment.
 */
export const planBenchBranch = ({
  changes,
  experimentFiles,
  mergeSha,
  parentSha,
  role,
}: {
  changes: FileChange[];
  experimentFiles: FileChange[];
  mergeSha: string;
  parentSha: string;
  role: BenchRole;
}): BranchOperation[] => {
  const experiment = new Set(experimentFiles.map((change) => change.path));
  const paths = replayPaths(changes).filter((path) => !experiment.has(path));
  const operations: BranchOperation[] =
    paths.length > 0 ? [{kind: "revert", mergeSha, parentSha, paths}] : [];
  if (role === "treatment") {
    return operations;
  }
  return [
    ...operations,
    ...experimentFiles.map((change): BranchOperation => ({kind: "touch", path: change.path})),
  ];
};

const MAX_STATUS_FAILURES = 3;

const errorMessage = (error: unknown): string =>
  error instanceof Error ? error.message : String(error);

const waitForSettledCi = async ({
  adapter,
  headSha,
  pollMs,
  quietMs,
  timeoutMs,
}: {
  adapter: BenchAdapter;
  headSha: string;
  pollMs: number;
  quietMs: number;
  timeoutMs: number;
}): Promise<CommitStatus[] | undefined> => {
  const deadline = adapter.now() + timeoutMs;
  let consecutiveFailures = 0;
  while (adapter.now() <= deadline) {
    let statuses: CommitStatus[];
    try {
      statuses = await adapter.listStatuses(headSha);
      consecutiveFailures = 0;
    } catch (error) {
      // One bad `gh api` call should not end a 15-minute measurement.
      consecutiveFailures += 1;
      if (consecutiveFailures >= MAX_STATUS_FAILURES) {
        throw new Error(
          `reading statuses failed ${MAX_STATUS_FAILURES} times in a row: ${errorMessage(error)}`
        );
      }
      await adapter.sleep(pollMs);
      continue;
    }
    const finals = [...finalTestJobStatuses({statuses}).values()];
    const lastChange = Math.max(0, ...finals.map((status) => Date.parse(status.created_at)));
    // Dependent jobs post their first status only when they start, so all-finished is not
    // enough: wait for a quiet period with no new job.
    const isSettled =
      measureCiWallClock({statuses}) !== undefined && adapter.now() - lastChange >= quietMs;
    if (isSettled) {
      return statuses;
    }
    await adapter.sleep(pollMs);
  }
  return undefined;
};

const replayRole = async ({
  adapter,
  benchCase,
  pullRequest,
  role,
  runIndex,
  ...wait
}: {
  adapter: BenchAdapter;
  benchCase: BenchCase;
  headSha: string;
  pollMs: number;
  pullRequest: number;
  quietMs: number;
  role: BenchRole;
  runIndex: number;
  timeoutMs: number;
}): Promise<BenchResult> => {
  const base = {case: benchCase.name, pullRequest, role, run: runIndex};
  let statuses: CommitStatus[] | undefined;
  try {
    statuses = await waitForSettledCi({adapter, ...wait});
  } catch (error) {
    // Report this role and let the other role finish its own measurement.
    return {...base, reason: errorMessage(error), status: "error"};
  }
  if (!statuses) {
    return {
      ...base,
      reason: `CI did not settle within ${wait.timeoutMs / 60_000} min`,
      status: "timeout",
    };
  }
  const wallClock = measureCiWallClock({statuses});
  const failed = [...finalTestJobStatuses({statuses})]
    .filter(([, status]) => status.state !== "success")
    .map(([job]) => job)
    .sort();
  if (failed.length > 0) {
    return {...base, ...wallClock, reason: `failed jobs: ${failed.join(", ")}`, status: "invalid"};
  }
  return {...base, ...wallClock, status: "ok"};
};

export const runBenchCase = async ({
  adapter,
  benchCase,
  branch,
  label,
  pollMs,
  quietMs,
  runIndex,
  timeoutMs,
}: {
  adapter: BenchAdapter;
  benchCase: BenchCase;
  branch: string;
  label: string;
  pollMs: number;
  quietMs: number;
  runIndex: number;
  timeoutMs: number;
}): Promise<BenchResult[]> => {
  const {changes, mergeSha, parentSha} = await adapter.caseChanges(benchCase.pullRequest);
  // A case whose reverse patch conflicts with later work cannot be replayed. Refuse before
  // pushing anything.
  const conflict = await adapter.revertConflicts({
    mergeSha,
    parentSha,
    paths: replayPaths(changes),
  });
  if (conflict !== undefined) {
    throw new Error(
      `#${benchCase.pullRequest} no longer reverts cleanly on master (${conflict}). ` +
        "Run `bun run ci:bench --suggest-cases` and update scripts/ci/bench/cases.ts"
    );
  }
  const isMaster = branch === MASTER_REF;
  const experimentFiles = isMaster ? [] : await adapter.experimentFiles(branch);
  const roles: BenchRole[] = isMaster ? ["control"] : ["control", "treatment"];

  // Every pushed branch, with its PR once opened, so cleanup never leaks one.
  const pushed: {branch: string; headSha: string; number?: number; role: BenchRole}[] = [];
  let results: BenchResult[] = [];
  let failure: unknown;
  try {
    for (const role of roles) {
      const name = `ci-bench/${label}/${benchCase.name}-${runIndex}-${role}`;
      const {headSha} = await adapter.prepareBranch({
        baseRef: role === "control" ? MASTER_REF : branch,
        name,
        operations: planBenchBranch({changes, experimentFiles, mergeSha, parentSha, role}),
      });
      const entry: (typeof pushed)[number] = {branch: name, headSha, role};
      pushed.push(entry);
      entry.number = await adapter.openDraftPullRequest({
        branch: name,
        title: `[ci-bench] ${label}: replay #${benchCase.pullRequest} (${role}, run ${runIndex})`,
      });
    }
    // Wait on both roles at once so they run under the same CircleCI load.
    results = await Promise.all(
      pushed.map(({headSha, number, role}) =>
        replayRole({
          adapter,
          benchCase,
          headSha,
          pollMs,
          pullRequest: number as number,
          quietMs,
          role,
          runIndex,
          timeoutMs,
        })
      )
    );
  } catch (error) {
    failure = error;
  }

  const cleanupErrors: string[] = [];
  for (const {branch: pushedBranch, number} of pushed) {
    try {
      if (number === undefined) {
        await adapter.deleteBranch(pushedBranch);
      } else {
        await adapter.closePullRequest({branch: pushedBranch, number});
      }
    } catch (error) {
      cleanupErrors.push(`${pushedBranch}: ${errorMessage(error)}`);
    }
  }
  if (failure !== undefined) {
    if (cleanupErrors.length === 0) {
      throw failure;
    }
    throw new Error(`${errorMessage(failure)}; cleanup failed: ${cleanupErrors.join("; ")}`, {
      cause: failure,
    });
  }
  if (cleanupErrors.length === 0) {
    return results;
  }
  return results.map((result) => ({...result, cleanupError: cleanupErrors.join("; ")}));
};

/**
 * Recent average PRs that can be replayed: they touch 1 to `maxDirectories` top-level
 * directories and their diff still reverse-applies cleanly to master.
 */
export const suggestBenchCases = async ({
  adapter,
  limit,
  maxDirectories,
  pullRequests,
}: {
  adapter: Pick<BenchAdapter, "caseChanges" | "revertConflicts">;
  limit: number;
  maxDirectories: number;
  pullRequests: MergedPullRequest[];
}): Promise<{directories: string[]; pullRequest: number}[]> => {
  const suggestions: {directories: string[]; pullRequest: number}[] = [];
  for (const pullRequest of pullRequests) {
    if (suggestions.length >= limit) {
      break;
    }
    const directories = topLevelDirectories(pullRequest.files);
    if (directories.length === 0 || directories.length > maxDirectories) {
      continue;
    }
    try {
      const {changes, mergeSha, parentSha} = await adapter.caseChanges(pullRequest.number);
      const conflict = await adapter.revertConflicts({
        mergeSha,
        parentSha,
        paths: replayPaths(changes),
      });
      if (conflict === undefined) {
        suggestions.push({directories, pullRequest: pullRequest.number});
      }
    } catch {
      // Merged into another branch (a stacked PR), so it has no merge commit on master.
    }
  }
  return suggestions;
};

const median = (values: number[]): number => {
  const sorted = [...values].sort((a, b) => a - b);
  const middle = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 1 ? sorted[middle] : (sorted[middle - 1] + sorted[middle]) / 2;
};

export interface BenchSummary {
  changePercent: number;
  control: number;
  invalid: number;
  perCase: {case: string; control: number; treatment: number}[];
  treatment: number;
}

/** Median of per-case medians, so one slow case cannot dominate. Only `ok` runs count. */
export const summarizeBench = (results: BenchResult[]): BenchSummary => {
  const valid = results.filter((result) => result.status === "ok" && result.minutes !== undefined);
  const caseNames = [...new Set(valid.map((result) => result.case))].sort();
  const caseMedian = (name: string, role: BenchRole): number | undefined => {
    const minutes = valid
      .filter((result) => result.case === name && result.role === role)
      .map((result) => result.minutes as number);
    return minutes.length > 0 ? median(minutes) : undefined;
  };
  const perCase = caseNames.flatMap((name) => {
    const control = caseMedian(name, "control");
    // On a master-only baseline the control is also the treatment.
    const treatment = caseMedian(name, "treatment") ?? control;
    return control === undefined || treatment === undefined
      ? []
      : [{case: name, control, treatment}];
  });
  const control = perCase.length > 0 ? median(perCase.map((row) => row.control)) : 0;
  const treatment = perCase.length > 0 ? median(perCase.map((row) => row.treatment)) : 0;
  return {
    changePercent: control === 0 ? 0 : Math.round(((treatment - control) / control) * 1000) / 10,
    control,
    invalid: results.length - valid.length,
    perCase,
    treatment,
  };
};
