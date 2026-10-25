/**
 * PR CI wall clock: the speed metric for docs/implementationPlans/circleci-pr-speed-loop.md.
 *
 * Wall clock runs from the first `ci/circleci:` status on a commit to the last terminal
 * status of a test or build job. Review bots and preview deploys do not end the clock:
 * they are not tests, and a PR is not waiting on them to learn whether it is green.
 */

export interface CommitStatus {
  /** GitHub status id; breaks ties when two statuses share a timestamp. */
  id?: number;
  context: string;
  state: string;
  created_at: string;
}

export interface WallClock {
  lastJob: string;
  minutes: number;
}

export interface WallClockRow extends WallClock {
  directories: number;
  pullRequest: number;
}

interface Distribution {
  count: number;
  median: number;
  p25: number;
  p75: number;
}

export interface WallClockSummary {
  all: Distribution;
  average: Distribution;
  lastJobOnAverage: {count: number; job: string}[];
}

const CIRCLECI_PREFIX = "ci/circleci: ";

/** Jobs that never end the clock: review bots and preview deploys. */
const NON_TEST_JOBS = new Set(["approve", "architectural-pr-review", "dco"]);

const isTestJob = (job: string): boolean => {
  if (NON_TEST_JOBS.has(job)) {
    return false;
  }
  return !job.startsWith("deploy-") && !job.endsWith("-preview") && !job.startsWith("serial-");
};

const roundMinutes = (milliseconds: number): number => Math.round((milliseconds / 60000) * 10) / 10;

export const measureCiWallClock = ({
  statuses,
}: {
  statuses: CommitStatus[];
}): WallClock | undefined => {
  const circleStatuses = statuses.filter((status) => status.context.startsWith(CIRCLECI_PREFIX));
  if (circleStatuses.length === 0) {
    return undefined;
  }
  const start = Math.min(...circleStatuses.map((status) => Date.parse(status.created_at)));

  // Statuses for one job, newest first: the newest decides whether the job is still running.
  const byJob = new Map<string, CommitStatus[]>();
  for (const status of circleStatuses) {
    const job = status.context.slice(CIRCLECI_PREFIX.length);
    if (!isTestJob(job)) {
      continue;
    }
    byJob.set(job, [...(byJob.get(job) ?? []), status]);
  }

  let lastJob: string | undefined;
  let end = 0;
  for (const [job, jobStatuses] of byJob) {
    const newest = [...jobStatuses].sort(
      (a, b) => Date.parse(b.created_at) - Date.parse(a.created_at) || (b.id ?? 0) - (a.id ?? 0)
    )[0];
    if (newest.state === "pending") {
      return undefined;
    }
    const finished = Date.parse(newest.created_at);
    if (finished > end) {
      end = finished;
      lastJob = job;
    }
  }
  if (!lastJob) {
    return undefined;
  }
  return {lastJob, minutes: roundMinutes(end - start)};
};

/** Directories a PR touches, not counting docs, the website, dot-directories, or root files. */
export const countTopLevelDirectories = (paths: string[]): number => {
  const directories = new Set<string>();
  for (const path of paths) {
    const [first, ...rest] = path.split("/");
    if (rest.length === 0 || first.startsWith(".") || first === "docs" || first === "website") {
      continue;
    }
    directories.add(first);
  }
  return directories.size;
};

const medianOf = (sorted: number[]): number => {
  const middle = Math.floor(sorted.length / 2);
  if (sorted.length % 2 === 1) {
    return sorted[middle];
  }
  return (sorted[middle - 1] + sorted[middle]) / 2;
};

/** Median with Tukey's hinges for p25/p75, so small samples stay readable. */
const distributionOf = (values: number[]): Distribution => {
  const sorted = [...values].sort((a, b) => a - b);
  if (sorted.length === 0) {
    return {count: 0, median: 0, p25: 0, p75: 0};
  }
  const half = Math.ceil(sorted.length / 2);
  return {
    count: sorted.length,
    median: medianOf(sorted),
    p25: medianOf(sorted.slice(0, half)),
    p75: medianOf(sorted.slice(sorted.length - half)),
  };
};

export const summarizeWallClock = ({
  maxDirectories,
  rows,
}: {
  maxDirectories: number;
  rows: WallClockRow[];
}): WallClockSummary => {
  const average = rows.filter((row) => row.directories <= maxDirectories);
  const counts = new Map<string, number>();
  for (const row of average) {
    counts.set(row.lastJob, (counts.get(row.lastJob) ?? 0) + 1);
  }
  return {
    all: distributionOf(rows.map((row) => row.minutes)),
    average: distributionOf(average.map((row) => row.minutes)),
    lastJobOnAverage: [...counts]
      .map(([job, count]) => ({count, job}))
      .sort((a, b) => b.count - a.count || a.job.localeCompare(b.job)),
  };
};

export interface MergedPullRequest {
  files: string[];
  headSha: string;
  number: number;
}

/** Where merged PRs and their commit statuses come from (GitHub in production). */
export interface PullRequestSource {
  listMergedPullRequests: (limit: number) => Promise<MergedPullRequest[]>;
  listStatuses: (sha: string) => Promise<CommitStatus[]>;
}

export const collectWallClockRows = async ({
  limit,
  source,
}: {
  limit: number;
  source: PullRequestSource;
}): Promise<WallClockRow[]> => {
  const rows: WallClockRow[] = [];
  for (const pullRequest of await source.listMergedPullRequests(limit)) {
    const wallClock = measureCiWallClock({
      statuses: await source.listStatuses(pullRequest.headSha),
    });
    if (!wallClock) {
      continue;
    }
    rows.push({
      ...wallClock,
      directories: countTopLevelDirectories(pullRequest.files),
      pullRequest: pullRequest.number,
    });
  }
  return rows;
};
