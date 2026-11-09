import {describe, expect, it} from "bun:test";

import {
  type CommitStatus,
  collectWallClockRows,
  countTopLevelDirectories,
  measureCiWallClock,
  summarizeWallClock,
} from "./lib";

const status = (context: string, state: string, createdAt: string): CommitStatus => ({
  context: `ci/circleci: ${context}`,
  created_at: createdAt,
  state,
});

describe("measureCiWallClock", () => {
  it("measures from the first CircleCI status to the last finished test job", () => {
    const result = measureCiWallClock({
      statuses: [
        status("check-updated-files", "pending", "2026-10-25T21:20:00Z"),
        status("check-updated-files", "success", "2026-10-25T21:20:30Z"),
        status("api-ci", "pending", "2026-10-25T21:21:00Z"),
        status("api-ci", "success", "2026-10-25T21:29:30Z"),
        status("ui-ci", "pending", "2026-10-25T21:21:00Z"),
        status("ui-ci", "success", "2026-10-25T21:24:00Z"),
      ],
    });

    expect(result).toEqual({lastJob: "api-ci", minutes: 9.5});
  });

  it("ignores review bots, preview deploys, and serial deploy groups when picking the end", () => {
    const result = measureCiWallClock({
      statuses: [
        status("check-updated-files", "pending", "2026-10-25T10:00:00Z"),
        status("check-updated-files", "success", "2026-10-25T10:00:20Z"),
        status("ui-ci", "success", "2026-10-25T10:04:00Z"),
        status("approve", "success", "2026-10-25T10:30:00Z"),
        status("architectural-pr-review", "success", "2026-10-25T10:25:00Z"),
        status("dco", "success", "2026-10-25T10:20:00Z"),
        status("deploy-docs-preview", "success", "2026-10-25T10:15:00Z"),
        status("gcp-cd-preview", "success", "2026-10-25T10:16:00Z"),
        status("vercel-frontend-preview", "success", "2026-10-25T10:17:00Z"),
        status("serial-end-1", "success", "2026-10-25T10:18:00Z"),
        {context: "Cursor Bugbot", created_at: "2026-10-25T10:40:00Z", state: "success"},
      ],
    });

    expect(result).toEqual({lastJob: "ui-ci", minutes: 4});
  });

  it("uses the latest terminal status when a job was rerun and counts failures as finished", () => {
    const result = measureCiWallClock({
      statuses: [
        status("check-updated-files", "pending", "2026-10-25T10:00:00Z"),
        status("check-updated-files", "success", "2026-10-25T10:00:20Z"),
        status("api-ci", "failure", "2026-10-25T10:06:00Z"),
        status("api-ci", "pending", "2026-10-25T10:07:00Z"),
        status("api-ci", "failure", "2026-10-25T10:12:00Z"),
      ],
    });

    expect(result).toEqual({lastJob: "api-ci", minutes: 12});
  });

  it("treats a job as finished when its success shares a timestamp with its pending status", () => {
    const result = measureCiWallClock({
      statuses: [
        {...status("check-updated-files", "pending", "2026-10-25T10:00:00Z"), id: 1},
        {...status("check-updated-files", "success", "2026-10-25T10:00:20Z"), id: 2},
        {...status("ui-ci", "pending", "2026-10-25T10:03:00Z"), id: 3},
        {...status("ui-ci", "success", "2026-10-25T10:03:00Z"), id: 4},
      ],
    });

    expect(result).toEqual({lastJob: "ui-ci", minutes: 3});
  });

  it("returns undefined while a test job is still pending", () => {
    const result = measureCiWallClock({
      statuses: [
        status("check-updated-files", "pending", "2026-10-25T10:00:00Z"),
        status("check-updated-files", "success", "2026-10-25T10:01:00Z"),
        status("e2e-app", "pending", "2026-10-25T10:06:00Z"),
      ],
    });

    expect(result).toBeUndefined();
  });

  it("returns undefined when the commit has no CircleCI statuses", () => {
    expect(measureCiWallClock({statuses: []})).toBeUndefined();
  });
});

describe("countTopLevelDirectories", () => {
  it("counts top-level directories, skipping docs, website, dot-directories, and root files", () => {
    const count = countTopLevelDirectories([
      "api/src/api.ts",
      "api/src/api.test.ts",
      "changelog/1620.md",
      "docs/how-to/circleci.md",
      "website/sidebars.ts",
      ".circleci/config.yml",
      "bun.lock",
      "CHANGELOG.md",
    ]);

    expect(count).toBe(2);
  });
});

describe("summarizeWallClock", () => {
  it("reports medians for average PRs and all PRs plus which job finished last", () => {
    const summary = summarizeWallClock({
      maxDirectories: 3,
      rows: [
        {directories: 1, lastJob: "api-ci", minutes: 4, pullRequest: 1},
        {directories: 2, lastJob: "e2e-app", minutes: 10, pullRequest: 2},
        {directories: 3, lastJob: "api-ci", minutes: 8, pullRequest: 3},
        {directories: 9, lastJob: "maestro-e2e", minutes: 30, pullRequest: 4},
      ],
    });

    expect(summary).toEqual({
      all: {count: 4, median: 9, p25: 6, p75: 20},
      average: {count: 3, median: 8, p25: 6, p75: 9},
      lastJobOnAverage: [
        {count: 2, job: "api-ci"},
        {count: 1, job: "e2e-app"},
      ],
    });
  });
});

describe("collectWallClockRows", () => {
  it("measures each merged PR's head commit and drops PRs with no finished CircleCI run", async () => {
    const statusesBySha: Record<string, CommitStatus[]> = {
      aaa: [
        status("check-updated-files", "pending", "2026-10-25T10:00:00Z"),
        status("check-updated-files", "success", "2026-10-25T10:00:20Z"),
        status("api-ci", "success", "2026-10-25T10:07:30Z"),
      ],
      bbb: [],
      ccc: [
        status("check-updated-files", "pending", "2026-10-25T11:00:00Z"),
        status("e2e-app", "pending", "2026-10-25T11:05:00Z"),
      ],
    };
    const rows = await collectWallClockRows({
      limit: 3,
      source: {
        listMergedPullRequests: async (limit) =>
          [
            {files: ["api/src/api.ts", "changelog/1.md"], headSha: "aaa", number: 1},
            {files: ["docs/x.md"], headSha: "bbb", number: 2},
            {files: ["ui/src/Box.tsx"], headSha: "ccc", number: 3},
          ].slice(0, limit),
        listStatuses: async (sha) => statusesBySha[sha],
      },
    });

    expect(rows).toEqual([{directories: 2, lastJob: "api-ci", minutes: 7.5, pullRequest: 1}]);
  });
});
