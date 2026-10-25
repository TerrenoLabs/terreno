/**
 * Benchmark replay for the CircleCI PR speed loop
 * (docs/implementationPlans/circleci-pr-speed-loop.md).
 *
 * A bench case is a past average PR. Replaying it opens a draft PR whose diff against
 * `master` touches the same files with real code: every file the case changed is rewound
 * to its content before the case merged. Cherry-picking the case would be a no-op on
 * current master, and comment-only edits would not trigger the e2e affected gate, which
 * strips comments.
 *
 * The treatment PR branches from the branch under test. The control PR branches from
 * `master` and touches the files the branch under test changes, so path filtering starts
 * the same workflows for both.
 */
import {type CommitStatus, finalTestJobStatuses, measureCiWallClock} from "../ciWallClock/lib";

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
  | {kind: "restore"; path: string; sha: string}
  | {kind: "remove"; path: string}
  | {kind: "touch"; path: string};

export type BenchRole = "control" | "treatment";

export interface BenchResult {
  case: string;
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
  caseChanges: (pullRequest: number) => Promise<{changes: FileChange[]; parentSha: string}>;
  closePullRequest: (pullRequest: {branch: string; number: number}) => Promise<void>;
  experimentFiles: (branch: string) => Promise<string[]>;
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

/**
 * Files the branch under test changes keep the branch's version in both roles. Rewinding
 * them would undo the experiment.
 */
export const planBenchBranch = ({
  changes,
  experimentFiles,
  parentSha,
  role,
}: {
  changes: FileChange[];
  experimentFiles: string[];
  parentSha: string;
  role: BenchRole;
}): BranchOperation[] => {
  const experiment = new Set(experimentFiles);
  const operations: BranchOperation[] = changes
    .filter((change) => !experiment.has(change.path))
    .map((change) =>
      change.status === "A"
        ? {kind: "remove", path: change.path}
        : {kind: "restore", path: change.path, sha: parentSha}
    );
  if (role === "treatment") {
    return operations;
  }
  return [
    ...operations,
    ...experimentFiles.map((path): BranchOperation => ({kind: "touch", path})),
  ];
};

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
  while (adapter.now() <= deadline) {
    const statuses = await adapter.listStatuses(headSha);
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
  const statuses = await waitForSettledCi({adapter, ...wait});
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
  const {changes, parentSha} = await adapter.caseChanges(benchCase.pullRequest);
  const isMaster = branch === MASTER_REF;
  const experimentFiles = isMaster ? [] : await adapter.experimentFiles(branch);
  const roles: BenchRole[] = isMaster ? ["control"] : ["control", "treatment"];

  const opened: {branch: string; headSha: string; number: number; role: BenchRole}[] = [];
  try {
    for (const role of roles) {
      const name = `ci-bench/${label}/${benchCase.name}-${runIndex}-${role}`;
      const {headSha} = await adapter.prepareBranch({
        baseRef: role === "control" ? MASTER_REF : branch,
        name,
        operations: planBenchBranch({changes, experimentFiles, parentSha, role}),
      });
      const number = await adapter.openDraftPullRequest({
        branch: name,
        title: `[ci-bench] ${label}: replay #${benchCase.pullRequest} (${role}, run ${runIndex})`,
      });
      opened.push({branch: name, headSha, number, role});
    }
    // Wait on both roles at once so they run under the same CircleCI load.
    return await Promise.all(
      opened.map(({headSha, number, role}) =>
        replayRole({
          adapter,
          benchCase,
          headSha,
          pollMs,
          pullRequest: number,
          quietMs,
          role,
          runIndex,
          timeoutMs,
        })
      )
    );
  } finally {
    for (const {branch: openedBranch, number} of opened) {
      await adapter.closePullRequest({branch: openedBranch, number});
    }
  }
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
