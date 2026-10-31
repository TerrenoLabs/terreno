import {afterEach, beforeEach, describe, expect, it} from "bun:test";
import {act, renderHook} from "@testing-library/react-native";
import React from "react";
import {AdminProvider} from "../AdminProvider";
import {jobRowId, unwrapJobRow} from "./jobPayload";
import {useJobsDashboardApi} from "./useJobsDashboardApi";

interface CapturedRequest {
  method: string;
  url: string;
}

const requests: CapturedRequest[] = [];
const originalFetch = globalThis.fetch;

const wrapper: React.FC<{children: React.ReactNode}> = ({children}) => (
  <AdminProvider apiBase="/admin" credentials="same-origin" routeBase="/admin">
    {children}
  </AdminProvider>
);

const flush = async (): Promise<void> => {
  await act(async () => {
    for (let i = 0; i < 5; i += 1) {
      await new Promise((resolve) => setTimeout(resolve, 0));
    }
  });
};

/** Mirrors the `@terreno/jobs` routes: lists keep the envelope, everything else wraps `{data}`. */
const responseFor = (method: string, url: string): unknown => {
  const path = url.split("?")[0];
  if (method === "GET" && path === "/jobs") {
    return {data: [{_id: "j1", name: "demo", status: "dead"}], more: false, page: 1, total: 1};
  }
  if (method === "GET" && path === "/jobs/stats") {
    return {data: {byStatus: {dead: 1}, total: 1}};
  }
  if (method === "GET" && path === "/jobs/schedules") {
    return {data: [{cron: "0 0 * * *", enabled: true, name: "nightly"}]};
  }
  return {data: {_id: "j1", name: "demo", status: "pending"}};
};

describe("useJobsDashboardApi", () => {
  beforeEach(() => {
    requests.length = 0;
    globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      const method = init?.method ?? "GET";
      requests.push({method, url});
      return new Response(JSON.stringify(responseFor(method, url)), {
        headers: {"Content-Type": "application/json"},
        status: 200,
      });
    }) as typeof fetch;
  });

  afterEach(() => {
    globalThis.fetch = originalFetch;
  });

  it("reads the list, detail, schedules, and stats routes and unwraps envelopes", async () => {
    const {result} = renderHook(
      () => {
        const api = useJobsDashboardApi();
        return {
          detail: api.useDetailQuery("j1"),
          list: api.useListQuery({limit: 25, status: "dead"}),
          schedules: api.useSchedulesQuery(),
          stats: api.useStatsQuery(),
        };
      },
      {wrapper}
    );
    await flush();

    const urls = requests.map((request) => `${request.method} ${request.url}`);
    expect(urls).toContain("GET /jobs?limit=25&status=dead");
    expect(urls).toContain("GET /jobs/j1");
    expect(urls).toContain("GET /jobs/schedules");
    expect(urls).toContain("GET /jobs/stats");
    expect(result.current.list.data?.total).toBe(1);
    expect(unwrapJobRow(result.current.detail.data)?._id).toBe("j1");
    expect(result.current.schedules.data?.[0]?.name).toBe("nightly");
    expect(result.current.stats.data?.total).toBe(1);
  });

  it("posts job and schedule actions and refetches the collection afterwards", async () => {
    const {result} = renderHook(
      () => {
        const api = useJobsDashboardApi();
        return {
          cancel: api.useCancelMutation(),
          list: api.useListQuery({}),
          pause: api.usePauseScheduleMutation(),
          requeue: api.useRequeueMutation(),
          resume: api.useResumeScheduleMutation(),
          retry: api.useRetryMutation(),
        };
      },
      {wrapper}
    );
    await flush();
    const isListRead = (r: CapturedRequest): boolean => r.method === "GET" && r.url === "/jobs";
    expect(requests.filter(isListRead)).toHaveLength(1);

    let retried: unknown;
    await act(async () => {
      retried = await result.current.retry[0]("j1").unwrap();
      await result.current.requeue[0]("j1").unwrap();
      await result.current.cancel[0]("j1").unwrap();
      await result.current.pause[0]("nightly run").unwrap();
      await result.current.resume[0]("nightly run").unwrap();
    });
    await flush();

    const posts = requests.filter((r) => r.method === "POST").map((r) => r.url);
    expect(posts).toEqual([
      "/jobs/j1/retry",
      "/jobs/j1/requeue",
      "/jobs/j1/cancel",
      "/jobs/schedules/nightly%20run/pause",
      "/jobs/schedules/nightly%20run/resume",
    ]);
    // Mutation responses unwrap single-document `{data}` envelopes.
    expect((retried as {_id?: string})._id).toBe("j1");
    expect(requests.filter(isListRead).length).toBeGreaterThan(1);
  });
});

describe("unwrapJobRow", () => {
  it("reads the row out of a {data} envelope or an already-unwrapped row", () => {
    expect(unwrapJobRow({_id: "a", name: "demo", status: "pending"})?._id).toBe("a");
    expect(unwrapJobRow({data: {_id: "b", name: "demo", status: "pending"}})?._id).toBe("b");
  });

  it("returns undefined for payloads without an id", () => {
    expect(unwrapJobRow(undefined)).toBeUndefined();
    expect(unwrapJobRow({status: "dead"})).toBeUndefined();
  });
});

describe("jobRowId", () => {
  it("prefers _id, falls back to id, and degrades to an empty string", () => {
    expect(jobRowId({_id: "a", name: "demo", status: "pending"})).toBe("a");
    expect(jobRowId({id: "b", name: "demo", status: "pending"})).toBe("b");
    expect(jobRowId({name: "demo", status: "pending"})).toBe("");
  });
});
