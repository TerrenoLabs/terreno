import {afterEach, describe, expect, it} from "bun:test";
import {act, renderHook} from "@testing-library/react-native";
import React from "react";
import {AdminProvider} from "../AdminProvider";
import {useJobsDashboardApi} from "../jobs/useJobsDashboardApi";

const originalFetch = globalThis.fetch;

describe("useJobsDashboardApi isolated", () => {
  afterEach(() => {
    globalThis.fetch = originalFetch;
  });

  it("reads jobs admin data from the server /jobs path through the host fetch client", async () => {
    const urls: string[] = [];
    const headers: Headers[] = [];
    globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
      urls.push(String(input));
      headers.push(new Headers(init?.headers));
      return new Response(JSON.stringify({data: []}), {
        headers: {"Content-Type": "application/json"},
        status: 200,
      });
    }) as typeof fetch;

    const wrapper: React.FC<{children: React.ReactNode}> = ({children}) => (
      <AdminProvider
        apiBase="/admin"
        apiOrigin="http://api.test"
        getAuthHeaders={() => ({Authorization: "Bearer token-1"})}
        routeBase="/admin"
      >
        {children}
      </AdminProvider>
    );
    renderHook(
      () => {
        const api = useJobsDashboardApi();
        api.useListQuery({});
        api.useDetailQuery("abc");
        api.useSchedulesQuery();
        api.useStatsQuery();
      },
      {wrapper}
    );
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 0));
    });

    expect(urls.sort()).toEqual([
      "http://api.test/jobs",
      "http://api.test/jobs/abc",
      "http://api.test/jobs/schedules",
      "http://api.test/jobs/stats",
    ]);
    for (const header of headers) {
      expect(header.get("Authorization")).toBe("Bearer token-1");
    }
  });
});
