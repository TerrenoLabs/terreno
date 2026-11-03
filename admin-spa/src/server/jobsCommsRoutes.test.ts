import {afterEach, beforeEach, describe, expect, it} from "bun:test";
import {DateTime, Settings} from "luxon";
import {commsSsrUrls, jobsSsrUrls} from "../../server/jobsCommsRoutes";

/**
 * The literals are the URLs the jobs and comms screens request on mount (none is prefixed with
 * the admin API base):
 * - jobs list `useJobsDashboardApi.tsx` `useListQuery` -> `withQueryString` over the screen's
 *   `listParams` (`JobsDashboardScreen.tsx:143-155`, `LIST_LIMIT` 20): `/jobs?limit=20&page=1`.
 * - `/jobs/stats` (`useStatsQuery`), `/jobs/schedules` (`useSchedulesQuery`), `/jobs/${id}`
 *   (`useDetailQuery`, id NOT encoded by the hook).
 * - comms list and stats: `useCommsDashboardApi.tsx` over `CommsDashboardScreen.tsx:160-185`.
 *   The default date range is `withDefaultCommsDashboardDates`: end = the next whole minute (UTC),
 *   start = end - 7 days. `withQueryString` keeps insertion order and encodes `:`.
 * - `/comms/messages/${id}` (`useDetailQuery`, id NOT encoded by the hook).
 */
/** Luxon reads its own clock; the test preload pins `Date.now`, so pin `Settings.now`. */
const setClock = (iso: string): void => {
  const millis = DateTime.fromISO(iso, {zone: "utc"}).toMillis();
  Settings.now = () => millis;
};

const NOW = "2026-11-03T12:00:00.000Z";
// The default range ends at the next whole minute, so a server render and the hydrating browser
// in the same minute build the same URL; it starts seven days before that.
const RANGE_END = "2026-11-03T12:01:00.000Z";
const WEEK_AGO = "2026-10-27T12:01:00.000Z";
const enc = (iso: string): string => iso.replace(/:/g, "%3A");

const sorted = (urls: string[]): string[] => [...urls].sort();

describe("jobsSsrUrls", () => {
  it("/jobs requests the first page of 20 jobs, the stats and the schedules", () => {
    expect(sorted(jobsSsrUrls("/jobs", {}))).toEqual(
      sorted(["/jobs?limit=20&page=1", "/jobs/stats", "/jobs/schedules"])
    );
  });

  it("/jobs/[id] requests the job", () => {
    expect(jobsSsrUrls("/jobs/[id]", {id: "j1"})).toEqual(["/jobs/j1"]);
  });

  it("builds the detail URL from the decoded id, as the hook does (no re-encoding)", () => {
    expect(jobsSsrUrls("/jobs/[id]", {id: "a b"})).toEqual(["/jobs/a b"]);
  });

  it.each(["../../admin/users", "a/b", "a?x=1", "a#x", "a\\b", "%2E", "..", "."])(
    "/jobs/[id] seeds nothing for an id that is not one path segment: %s",
    (id) => {
      expect(jobsSsrUrls("/jobs/[id]", {id})).toEqual([]);
    }
  );

  it("/jobs/[id] without an id requests nothing", () => {
    expect(jobsSsrUrls("/jobs/[id]", {})).toEqual([]);
    expect(jobsSsrUrls("/jobs/[id]", {id: ""})).toEqual([]);
  });
});

describe("commsSsrUrls", () => {
  beforeEach(() => {
    setClock(NOW);
  });

  afterEach(() => {
    Settings.now = () => Date.now();
  });

  it("/comms/[id] requests the message", () => {
    expect(commsSsrUrls("/comms/[id]", {id: "m1"})).toEqual(["/comms/messages/m1"]);
  });

  it("builds the detail URL from the decoded id, as the hook does (no re-encoding)", () => {
    expect(commsSsrUrls("/comms/[id]", {id: "a b"})).toEqual(["/comms/messages/a b"]);
  });

  it.each(["../../admin/users", "a/b", "a?x=1", "%2E", ".."])(
    "/comms/[id] seeds nothing for an id that is not one path segment: %s",
    (id) => {
      expect(commsSsrUrls("/comms/[id]", {id})).toEqual([]);
    }
  );

  it("/comms/[id] without an id requests nothing", () => {
    expect(commsSsrUrls("/comms/[id]", {})).toEqual([]);
    expect(commsSsrUrls("/comms/[id]", {id: ""})).toEqual([]);
  });

  it("/comms requests the list and the stats over the default 7 day range", () => {
    expect(sorted(commsSsrUrls("/comms", {}))).toEqual(
      sorted([
        `/comms/messages?endDate=${enc(RANGE_END)}&limit=20&page=1&startDate=${enc(WEEK_AGO)}`,
        `/comms/stats?endDate=${enc(RANGE_END)}&startDate=${enc(WEEK_AGO)}`,
      ])
    );
  });
});
