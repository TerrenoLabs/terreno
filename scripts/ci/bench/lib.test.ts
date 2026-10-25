import {describe, expect, it} from "bun:test";

import type {CommitStatus} from "../ciWallClock/lib";
import {
  type BenchAdapter,
  type BenchResult,
  planBenchBranch,
  runBenchCase,
  summarizeBench,
  touchLine,
} from "./lib";

const MINUTE = 60_000;
const T0 = Date.parse("2026-10-26T10:00:00Z");

const status = (job: string, state: string, minutesAfterStart: number, id = 0): CommitStatus => ({
  context: `ci/circleci: ${job}`,
  created_at: new Date(T0 + minutesAfterStart * MINUTE).toISOString(),
  id,
  state,
});

interface FakeRun {
  closed: {branch: string; number: number}[];
  opened: {branch: string; title: string}[];
  prepared: {baseRef: string; name: string; operations: unknown[]}[];
}

/** Fake GitHub + git: each prepared branch gets a head sha whose statuses follow `timelines`. */
const fakeAdapter = ({
  timelines,
}: {
  timelines: Record<string, CommitStatus[]>;
}): {adapter: BenchAdapter; run: FakeRun} => {
  const run: FakeRun = {closed: [], opened: [], prepared: []};
  let clock = T0;
  let nextPullRequest = 900;
  const adapter: BenchAdapter = {
    caseChanges: async () => ({
      changes: [
        {path: "api/src/api.ts", status: "M"},
        {path: "api/src/newThing.ts", status: "A"},
      ],
      parentSha: "parent1",
    }),
    closePullRequest: async (pullRequest) => {
      run.closed.push(pullRequest);
    },
    experimentFiles: async () => [".circleci/continue-config.yml"],
    listStatuses: async (sha) =>
      (timelines[sha] ?? []).filter((entry) => Date.parse(entry.created_at) <= clock),
    now: () => clock,
    openDraftPullRequest: async ({branch, title}) => {
      run.opened.push({branch, title});
      nextPullRequest += 1;
      return nextPullRequest;
    },
    prepareBranch: async ({baseRef, name, operations}) => {
      run.prepared.push({baseRef, name, operations});
      return {headSha: name.endsWith("control") ? "control-sha" : "treatment-sha"};
    },
    sleep: async (milliseconds) => {
      clock += milliseconds;
    },
  };
  return {adapter, run};
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
  it("rewinds the case PR's files in both roles and mirrors the experiment's files in the control", () => {
    const changes = [
      {path: "api/src/api.ts", status: "M"},
      {path: "api/src/newThing.ts", status: "A"},
      {path: ".circleci/continue-config.yml", status: "M"},
    ];
    const experimentFiles = [".circleci/continue-config.yml", "scripts/ci/bench/lib.ts"];

    expect(planBenchBranch({changes, experimentFiles, parentSha: "p1", role: "treatment"})).toEqual(
      [
        {kind: "restore", path: "api/src/api.ts", sha: "p1"},
        {kind: "remove", path: "api/src/newThing.ts"},
      ]
    );
    expect(planBenchBranch({changes, experimentFiles, parentSha: "p1", role: "control"})).toEqual([
      {kind: "restore", path: "api/src/api.ts", sha: "p1"},
      {kind: "remove", path: "api/src/newThing.ts"},
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
