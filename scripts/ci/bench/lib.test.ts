import {describe, expect, it} from "bun:test";

import {DateTime} from "luxon";

import {type CommitStatus, toMillis} from "../ciWallClock/lib";
import {
  type BenchAdapter,
  type BenchResult,
  nearestTouchTarget,
  planBenchBranch,
  runBenchCase,
  suggestBenchCases,
  summarizeBench,
  touchLine,
} from "./lib";

const MINUTE = 60_000;
const T0 = DateTime.fromISO("2026-10-26T10:00:00Z").toMillis();

const status = (job: string, state: string, minutesAfterStart: number, id = 0): CommitStatus => ({
  context: `ci/circleci: ${job}`,
  created_at: DateTime.fromMillis(T0 + minutesAfterStart * MINUTE, {zone: "utc"}).toISO() ?? "",
  id,
  state,
});

interface FakeRun {
  closed: {branch: string; number: number}[];
  deleted: string[];
  opened: {branch: string; title: string}[];
  prepared: {baseRef: string; name: string; operations: unknown[]}[];
}

interface FakeFailures {
  /** Branch names whose PR close throws. */
  closeFails?: string[];
  /** Branch deletion throws. */
  deleteFails?: boolean;
  /** Why the case's reverse patch does not apply to master. */
  revertConflict?: string;
  /** Role whose PR fails to open after its branch was pushed. */
  openFailsFor?: "control" | "treatment";
  /** Head shas whose status reads throw: a number of times, or always. */
  statusFailures?: Record<string, number | "always">;
}

/** Fake GitHub + git: each prepared branch gets a head sha whose statuses follow `timelines`. */
const fakeAdapter = ({
  failures = {},
  timelines,
}: {
  failures?: FakeFailures;
  timelines: Record<string, CommitStatus[]>;
}): {adapter: BenchAdapter; run: FakeRun} => {
  const run: FakeRun = {closed: [], deleted: [], opened: [], prepared: []};
  const statusFailures = {...failures.statusFailures};
  let clock = T0;
  let nextPullRequest = 900;
  const adapter: BenchAdapter = {
    caseChanges: async () => ({
      changes: [
        {path: "api/src/api.ts", status: "M"},
        {path: "api/src/newThing.ts", status: "A"},
      ],
      mergeSha: "merge1",
      parentSha: "parent1",
    }),
    closePullRequest: async (pullRequest) => {
      if (failures.closeFails?.includes(pullRequest.branch)) {
        throw new Error(`gh pr close ${pullRequest.number} failed`);
      }
      run.closed.push(pullRequest);
    },
    deleteBranch: async (branch) => {
      if (failures.deleteFails) {
        throw new Error(`git push --delete ${branch} failed`);
      }
      run.deleted.push(branch);
    },
    experimentFiles: async () => [{path: ".circleci/continue-config.yml", status: "M"}],
    listStatuses: async (sha) => {
      const remaining = statusFailures[sha];
      if (remaining === "always" || (typeof remaining === "number" && remaining > 0)) {
        if (typeof remaining === "number") {
          statusFailures[sha] = remaining - 1;
        }
        throw new Error("gh api: HTTP 502");
      }
      return (timelines[sha] ?? []).filter((entry) => toMillis(entry.created_at) <= clock);
    },
    now: () => clock,
    openDraftPullRequest: async ({branch, title}) => {
      if (failures.openFailsFor && branch.endsWith(failures.openFailsFor)) {
        throw new Error("gh pr create failed");
      }
      run.opened.push({branch, title});
      nextPullRequest += 1;
      return nextPullRequest;
    },
    prepareBranch: async ({baseRef, name, operations}) => {
      run.prepared.push({baseRef, name, operations});
      return {headSha: name.endsWith("control") ? "control-sha" : "treatment-sha"};
    },
    revertConflicts: async () => failures.revertConflict,
    sleep: async (milliseconds) => {
      clock += milliseconds;
    },
  };
  return {adapter, run};
};

const BENCH = {
  benchCase: {name: "api-only", pullRequest: 1596},
  branch: "ci-speed/1-cache",
  label: "iter1",
  pollMs: MINUTE,
  quietMs: 3 * MINUTE,
  runIndex: 1,
  timeoutMs: 60 * MINUTE,
};

const greenRun = (lastJobMinutes: number): CommitStatus[] => [
  status("check-updated-files", "pending", 0, 1),
  status("check-updated-files", "success", 0.5, 2),
  status("api-ci", "pending", 1, 3),
  status("api-ci", "success", lastJobMinutes, 4),
];

describe("touchLine", () => {
  it("appends a comment in the file's own syntax, or a bare newline when it has none", () => {
    expect(touchLine(".circleci/continue-config.yml")).toBe("# ci-bench\n");
    expect(touchLine("scripts/ci/run.ts")).toBe("// ci-bench\n");
    expect(touchLine("docs/how-to/circleci.md")).toBe("<!-- ci-bench -->\n");
    expect(touchLine("package.json")).toBe("\n");
  });
});

describe("planBenchBranch", () => {
  it("reverts the case PR's code hunks in both roles and mirrors the experiment's files in the control", () => {
    const changes = [
      {path: "api/src/api.ts", status: "M"},
      {path: "api/src/newThing.ts", status: "A"},
      {path: ".circleci/continue-config.yml", status: "M"},
      {path: "docs/reference/api.md", status: "M"},
      {path: "changelog/unreleased/x.md", status: "A"},
    ];
    const experimentFiles = [
      {path: ".circleci/continue-config.yml", status: "M"},
      {path: "scripts/ci/bench/lib.ts", status: "A"},
    ];

    const revert = {
      kind: "revert",
      mergeSha: "m1",
      parentSha: "p1",
      paths: ["api/src/api.ts", "api/src/newThing.ts"],
    };

    expect(
      planBenchBranch({
        changes,
        experimentFiles,
        mergeSha: "m1",
        parentSha: "p1",
        role: "treatment",
      })
    ).toEqual([revert]);
    expect(
      planBenchBranch({changes, experimentFiles, mergeSha: "m1", parentSha: "p1", role: "control"})
    ).toEqual([
      revert,
      {kind: "touch", path: ".circleci/continue-config.yml"},
      {kind: "touch", path: "scripts/ci/bench/lib.ts"},
    ]);
  });
});

describe("runBenchCase", () => {
  it("replays the case as control and treatment PRs, measures both once CI settles, and closes them", async () => {
    const {adapter, run} = fakeAdapter({
      timelines: {"control-sha": greenRun(9), "treatment-sha": greenRun(6)},
    });

    const results = await runBenchCase({
      adapter,
      benchCase: {name: "api-only", pullRequest: 1596},
      branch: "ci-speed/1-cache",
      label: "iter1",
      pollMs: MINUTE,
      quietMs: 3 * MINUTE,
      runIndex: 1,
      timeoutMs: 60 * MINUTE,
    });

    expect(results).toEqual([
      {
        case: "api-only",
        lastJob: "api-ci",
        minutes: 9,
        pullRequest: 901,
        role: "control",
        run: 1,
        status: "ok",
      },
      {
        case: "api-only",
        lastJob: "api-ci",
        minutes: 6,
        pullRequest: 902,
        role: "treatment",
        run: 1,
        status: "ok",
      },
    ]);
    expect(run.prepared.map(({baseRef, name}) => ({baseRef, name}))).toEqual([
      {baseRef: "origin/master", name: "ci-bench/iter1/api-only-1-control"},
      {baseRef: "ci-speed/1-cache", name: "ci-bench/iter1/api-only-1-treatment"},
    ]);
    expect(run.closed).toEqual([
      {branch: "ci-bench/iter1/api-only-1-control", number: 901},
      {branch: "ci-bench/iter1/api-only-1-treatment", number: 902},
    ]);
  });

  it("runs only the control when the branch under test is master", async () => {
    const {adapter} = fakeAdapter({timelines: {"control-sha": greenRun(8)}});

    const results = await runBenchCase({
      adapter,
      benchCase: {name: "ui-only", pullRequest: 1612},
      branch: "origin/master",
      label: "baseline",
      pollMs: MINUTE,
      quietMs: 3 * MINUTE,
      runIndex: 2,
      timeoutMs: 60 * MINUTE,
    });

    expect(results).toEqual([
      {
        case: "ui-only",
        lastJob: "api-ci",
        minutes: 8,
        pullRequest: 901,
        role: "control",
        run: 2,
        status: "ok",
      },
    ]);
  });

  it("marks a run invalid when a counted job failed, because a broken replay ends CI early", async () => {
    const failing = [
      status("check-updated-files", "pending", 0, 1),
      status("check-updated-files", "success", 0.5, 2),
      status("api-ci", "failure", 3, 3),
    ];
    const {adapter} = fakeAdapter({timelines: {"control-sha": failing}});

    const [result] = await runBenchCase({
      adapter,
      benchCase: {name: "api-only", pullRequest: 1596},
      branch: "origin/master",
      label: "baseline",
      pollMs: MINUTE,
      quietMs: 3 * MINUTE,
      runIndex: 1,
      timeoutMs: 60 * MINUTE,
    });

    expect(result).toEqual({
      case: "api-only",
      lastJob: "api-ci",
      minutes: 3,
      pullRequest: 901,
      reason: "failed jobs: api-ci",
      role: "control",
      run: 1,
      status: "invalid",
    });
  });

  it("gives up after the timeout and still closes the PR", async () => {
    const stuck = [status("check-updated-files", "pending", 0, 1)];
    const {adapter, run} = fakeAdapter({timelines: {"control-sha": stuck}});

    const [result] = await runBenchCase({
      adapter,
      benchCase: {name: "api-only", pullRequest: 1596},
      branch: "origin/master",
      label: "baseline",
      pollMs: MINUTE,
      quietMs: 3 * MINUTE,
      runIndex: 1,
      timeoutMs: 10 * MINUTE,
    });

    expect(result).toEqual({
      case: "api-only",
      pullRequest: 901,
      reason: "CI did not settle within 10 min",
      role: "control",
      run: 1,
      status: "timeout",
    });
    expect(run.closed).toEqual([{branch: "ci-bench/baseline/api-only-1-control", number: 901}]);
  });
});

describe("nearestTouchTarget", () => {
  const tracked = [
    ".circleci/continue-config.yml",
    "package.json",
    "scripts/ci/bun-install-uncached.test.ts",
    "scripts/ci/docs-archive.sh",
    "scripts/ci/e2eAffected/git.ts",
    "scripts/ci/prepush/plan.json",
  ];

  it("touches the file itself when the base has it", () => {
    expect(nearestTouchTarget({path: ".circleci/continue-config.yml", trackedFiles: tracked})).toBe(
      ".circleci/continue-config.yml"
    );
  });

  it("touches the nearest existing file with comment syntax when the branch adds a new path", () => {
    expect(nearestTouchTarget({path: "scripts/ci/bench/lib.ts", trackedFiles: tracked})).toBe(
      "scripts/ci/bun-install-uncached.test.ts"
    );
    expect(nearestTouchTarget({path: "scripts/ci/prepush/new.ts", trackedFiles: tracked})).toBe(
      "scripts/ci/bun-install-uncached.test.ts"
    );
  });

  it("skips the touch when no directory up to the root has a file with comment syntax", () => {
    expect(
      nearestTouchTarget({path: "newpkg/src/a.ts", trackedFiles: ["package.json"]})
    ).toBeUndefined();
  });
});

describe("runBenchCase failure handling", () => {
  it("keeps measuring through a transient status read error", async () => {
    const {adapter} = fakeAdapter({
      failures: {statusFailures: {"control-sha": 2}},
      timelines: {"control-sha": greenRun(9), "treatment-sha": greenRun(6)},
    });

    const results = await runBenchCase({adapter, ...BENCH});

    expect(results.map(({minutes, role, status: state}) => ({minutes, role, state}))).toEqual([
      {minutes: 9, role: "control", state: "ok"},
      {minutes: 6, role: "treatment", state: "ok"},
    ]);
  });

  it("reports a role whose statuses keep failing as an error, measures the other, and closes both", async () => {
    const {adapter, run} = fakeAdapter({
      failures: {statusFailures: {"treatment-sha": "always"}},
      timelines: {"control-sha": greenRun(9)},
    });

    const results = await runBenchCase({adapter, ...BENCH});

    expect(results).toEqual([
      {
        case: "api-only",
        lastJob: "api-ci",
        minutes: 9,
        pullRequest: 901,
        role: "control",
        run: 1,
        status: "ok",
      },
      {
        case: "api-only",
        pullRequest: 902,
        reason: "reading statuses failed 3 times in a row: gh api: HTTP 502",
        role: "treatment",
        run: 1,
        status: "error",
      },
    ]);
    expect(run.closed.map(({number}) => number)).toEqual([901, 902]);
  });

  it("deletes a pushed branch whose PR failed to open, closes the PR that did open, and rethrows", async () => {
    const {adapter, run} = fakeAdapter({failures: {openFailsFor: "treatment"}, timelines: {}});

    await expect(runBenchCase({adapter, ...BENCH})).rejects.toThrow("gh pr create failed");

    expect(run.closed).toEqual([{branch: "ci-bench/iter1/api-only-1-control", number: 901}]);
    expect(run.deleted).toEqual(["ci-bench/iter1/api-only-1-treatment"]);
  });

  it("keeps closing PRs after one close fails and reports the cleanup failure on the results", async () => {
    const {adapter, run} = fakeAdapter({
      failures: {closeFails: ["ci-bench/iter1/api-only-1-control"]},
      timelines: {"control-sha": greenRun(9), "treatment-sha": greenRun(6)},
    });

    const results = await runBenchCase({adapter, ...BENCH});

    expect(run.closed).toEqual([{branch: "ci-bench/iter1/api-only-1-treatment", number: 902}]);
    expect(results.map((result) => result.cleanupError)).toEqual([
      "ci-bench/iter1/api-only-1-control: gh pr close 901 failed",
      "ci-bench/iter1/api-only-1-control: gh pr close 901 failed",
    ]);
  });
});

describe("runBenchCase stale cases", () => {
  it("refuses a case that no longer reverts cleanly on master, before pushing anything", async () => {
    const {adapter, run} = fakeAdapter({
      failures: {revertConflict: "error: patch failed: api/src/api.ts:12"},
      timelines: {},
    });

    await expect(runBenchCase({adapter, ...BENCH})).rejects.toThrow(
      "#1596 no longer reverts cleanly on master (error: patch failed: api/src/api.ts:12). Run `bun run ci:bench --suggest-cases` and update scripts/ci/bench/cases.ts"
    );
    expect(run.prepared).toEqual([]);
  });

  it("refuses a case with no code changes to replay, before pushing anything", async () => {
    const {adapter, run} = fakeAdapter({timelines: {}});
    const docsOnly: BenchAdapter = {
      ...adapter,
      caseChanges: async () => ({
        changes: [
          {path: "docs/how-to/x.md", status: "M"},
          {path: "changelog/unreleased/x.md", status: "A"},
        ],
        mergeSha: "merge1",
        parentSha: "parent1",
      }),
    };

    await expect(runBenchCase({adapter: docsOnly, ...BENCH})).rejects.toThrow(
      "#1596 has no code changes to replay"
    );
    expect(run.prepared).toEqual([]);
  });

  it("reports a cleanup failure together with the error that stopped the case", async () => {
    const {adapter} = fakeAdapter({
      failures: {deleteFails: true, openFailsFor: "treatment"},
      timelines: {},
    });

    await expect(runBenchCase({adapter, ...BENCH})).rejects.toThrow(
      "gh pr create failed; cleanup failed: ci-bench/iter1/api-only-1-treatment: git push --delete ci-bench/iter1/api-only-1-treatment failed"
    );
  });
});

describe("suggestBenchCases", () => {
  it("lists recent average PRs on master that still revert cleanly", async () => {
    const {adapter} = fakeAdapter({timelines: {}});
    const conflicts: Record<string, string> = {"merge-11": "error: patch failed: api/src/api.ts:3"};
    const suggestions = await suggestBenchCases({
      adapter: {
        ...adapter,
        caseChanges: async (pullRequest) => {
          if (pullRequest === 9) {
            throw new Error("merge commit is not on master");
          }
          return {
            changes: [{path: "api/src/api.ts", status: "M"}],
            mergeSha: `merge-${pullRequest}`,
            parentSha: `parent-${pullRequest}`,
          };
        },
        revertConflicts: async ({mergeSha}) => conflicts[mergeSha],
      },
      limit: 2,
      maxDirectories: 3,
      pullRequests: [
        {files: ["rtk/src/stacked.ts"], headSha: "h9", number: 9},
        {files: ["api/src/api.ts"], headSha: "h10", number: 10},
        {files: ["api/src/api.ts"], headSha: "h11", number: 11},
        {files: ["docs/how-to/x.md", "website/a.ts"], headSha: "h12", number: 12},
        {files: ["a/x.ts", "b/x.ts", "c/x.ts", "d/x.ts"], headSha: "h13", number: 13},
        {files: ["ui/src/Box.tsx", "changelog/x.md"], headSha: "h14", number: 14},
        {files: ["rtk/src/a.ts"], headSha: "h15", number: 15},
      ],
    });

    expect(suggestions).toEqual([
      {directories: ["api"], pullRequest: 10},
      {directories: ["changelog", "ui"], pullRequest: 14},
    ]);
  });
});

describe("summarizeBench", () => {
  it("compares the median of per-case medians for control and treatment, ignoring invalid runs", () => {
    const results: BenchResult[] = [
      {case: "a", minutes: 10, role: "control", run: 1, status: "ok"},
      {case: "a", minutes: 12, role: "control", run: 2, status: "ok"},
      {case: "a", minutes: 6, role: "treatment", run: 1, status: "ok"},
      {case: "a", minutes: 8, role: "treatment", run: 2, status: "ok"},
      {case: "b", minutes: 8, role: "control", run: 1, status: "ok"},
      {
        case: "b",
        minutes: 2,
        reason: "failed jobs: ui-ci",
        role: "treatment",
        run: 1,
        status: "invalid",
      },
      {case: "b", minutes: 7, role: "treatment", run: 2, status: "ok"},
    ];

    expect(summarizeBench(results)).toEqual({
      changePercent: -26.3,
      control: 9.5,
      invalid: 1,
      perCase: [
        {case: "a", control: 11, treatment: 7},
        {case: "b", control: 8, treatment: 7},
      ],
      treatment: 7,
    });
  });
});
