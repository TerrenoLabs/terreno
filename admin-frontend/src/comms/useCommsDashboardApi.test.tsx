import {afterEach, beforeEach, describe, expect, it} from "bun:test";
import {act, renderHook} from "@testing-library/react-native";
import React from "react";
import {AdminProvider} from "../AdminProvider";
import {commsMessageId, unwrapCommsMessage} from "./commsMessagePayload";
import {useCommsDashboardApi} from "./useCommsDashboardApi";

interface CapturedRequest {
  body: unknown;
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

describe("useCommsDashboardApi", () => {
  beforeEach(() => {
    requests.length = 0;
    globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      requests.push({
        body: typeof init?.body === "string" ? JSON.parse(init.body) : undefined,
        method: init?.method ?? "GET",
        url,
      });
      const body =
        url.split("?")[0] === "/comms/messages"
          ? {data: [], more: false, page: 1, total: 0}
          : {data: {_id: "m1"}};
      return new Response(JSON.stringify(body), {
        headers: {"Content-Type": "application/json"},
        status: 200,
      });
    }) as typeof fetch;
  });

  afterEach(() => {
    globalThis.fetch = originalFetch;
  });

  it("reads the list, detail, and stats routes with query params", async () => {
    const {result} = renderHook(
      () => {
        const api = useCommsDashboardApi();
        return {
          detail: api.useDetailQuery("m1"),
          list: api.useListQuery({channel: "mail", limit: 25, page: 2}),
          stats: api.useStatsQuery({status: "failed"}),
        };
      },
      {wrapper}
    );
    await flush();

    const urls = requests.map((request) => `${request.method} ${request.url}`);
    expect(urls).toContain("GET /comms/messages/m1");
    expect(urls).toContain("GET /comms/messages?channel=mail&limit=25&page=2");
    expect(urls).toContain("GET /comms/stats?status=failed");
    expect(result.current.list.data?.total).toBe(0);
    // Comms keeps the raw `{data}` envelope; screens unwrap it with `unwrapCommsMessage`.
    expect(unwrapCommsMessage(result.current.detail.data)?._id).toBe("m1");
  });

  it("posts retries and refetches the collection afterwards", async () => {
    const {result} = renderHook(
      () => {
        const api = useCommsDashboardApi();
        return {
          list: api.useListQuery({}),
          retry: api.useRetryMutation(),
          retryMany: api.useRetryManyMutation(),
        };
      },
      {wrapper}
    );
    await flush();
    const isListRead = (r: CapturedRequest): boolean =>
      r.method === "GET" && r.url === "/comms/messages";
    const listCallsBefore = requests.filter(isListRead).length;
    expect(listCallsBefore).toBe(1);

    await act(async () => {
      await result.current.retry[0]("m1").unwrap();
    });
    await act(async () => {
      await result.current.retryMany[0]({limit: 5}).unwrap();
    });
    await flush();

    expect(requests).toContainEqual({
      body: undefined,
      method: "POST",
      url: "/comms/messages/m1/retry",
    });
    expect(requests).toContainEqual({
      body: {limit: 5},
      method: "POST",
      url: "/comms/messages/retryMany",
    });
    const listCallsAfter = requests.filter(isListRead).length;
    expect(listCallsAfter).toBeGreaterThan(listCallsBefore);
  });
});

describe("unwrapCommsMessage", () => {
  it("reads the row out of a {data} envelope or an already-unwrapped row", () => {
    expect(unwrapCommsMessage({_id: "a"})?._id).toBe("a");
    expect(unwrapCommsMessage({data: {_id: "b"}})?._id).toBe("b");
    expect(unwrapCommsMessage({data: {data: {id: "c"}}})?._id).toBe("c");
  });

  it("normalizes a non-string id", () => {
    expect(unwrapCommsMessage({id: 42})?._id).toBe("42");
  });

  it("returns undefined for payloads without an id", () => {
    expect(unwrapCommsMessage(undefined)).toBeUndefined();
    expect(unwrapCommsMessage("row")).toBeUndefined();
    expect(unwrapCommsMessage({status: "failed"})).toBeUndefined();
    expect(unwrapCommsMessage({_id: ""})).toBeUndefined();
    expect(unwrapCommsMessage({data: []})).toBeUndefined();
  });
});

describe("commsMessageId", () => {
  it("prefers _id, falls back to id, and degrades to an empty string", () => {
    expect(
      commsMessageId({_id: "a", channel: "mail", provider: "p", status: "failed", to: "t"})
    ).toBe("a");
    expect(
      commsMessageId({channel: "mail", id: "b", provider: "p", status: "failed", to: "t"})
    ).toBe("b");
    expect(commsMessageId({channel: "mail", provider: "p", status: "failed", to: "t"})).toBe("");
  });
});
