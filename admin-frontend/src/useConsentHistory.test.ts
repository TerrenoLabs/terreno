import {afterEach, describe, expect, it} from "bun:test";
import {act, renderHook, waitFor} from "@testing-library/react-native";
import React from "react";

import {AdminProvider} from "./AdminProvider";
import type {ConsentHistoryEntry} from "./useConsentHistory";
import {useConsentHistory} from "./useConsentHistory";

const originalFetch = globalThis.fetch;

interface StubResult {
  status?: number;
  body?: unknown;
}

const stubFetch = (respond: (url: string) => StubResult): string[] => {
  const urls: string[] = [];
  globalThis.fetch = (async (url: string) => {
    urls.push(String(url));
    const {body = {}, status = 200} = respond(String(url));
    return new Response(JSON.stringify(body), {
      headers: {"Content-Type": "application/json"},
      status,
    });
  }) as typeof fetch;
  return urls;
};

const wrapper: React.FC<{children: React.ReactNode}> = ({children}) =>
  React.createElement(
    AdminProvider,
    {apiBase: "/admin", credentials: "same-origin", routeBase: "/admin"},
    children
  );

describe("useConsentHistory", () => {
  afterEach(() => {
    globalThis.fetch = originalFetch;
  });

  it("returns an array of entries when response is an array", async () => {
    const urls = stubFetch(() => ({
      body: [{_id: "1", agreed: true} as unknown as ConsentHistoryEntry],
    }));
    const {result} = renderHook(() => useConsentHistory(), {wrapper});
    await waitFor(() => {
      expect(result.current.entries).toHaveLength(1);
    });
    expect(urls).toEqual(["/consents/my"]);
  });

  it("unwraps .data property when response is object shape", async () => {
    const urls = stubFetch(() => ({
      body: {data: [{_id: "2", agreed: false} as unknown as ConsentHistoryEntry]},
    }));
    const {result} = renderHook(() => useConsentHistory("/api"), {wrapper});
    await waitFor(() => {
      expect(result.current.entries).toHaveLength(1);
    });
    expect(urls).toEqual(["/api/consents/my"]);
  });

  it("returns empty array while loading", () => {
    globalThis.fetch = (() => new Promise<Response>(() => {})) as unknown as typeof fetch;
    const {result} = renderHook(() => useConsentHistory(), {wrapper});
    expect(result.current.entries).toEqual([]);
    expect(result.current.isLoading).toBe(true);
  });

  it("surfaces request errors", async () => {
    stubFetch(() => ({body: {title: "boom"}, status: 500}));
    const {result} = renderHook(() => useConsentHistory(), {wrapper});
    await waitFor(() => {
      expect(result.current.error).toBeTruthy();
    });
    expect(result.current.entries).toEqual([]);
  });

  it("refetches when retry is called", async () => {
    const urls = stubFetch(() => ({body: []}));
    const {result} = renderHook(() => useConsentHistory(), {wrapper});
    await waitFor(() => {
      expect(result.current.isLoading).toBe(false);
    });
    let pending: Promise<void> | undefined;
    act(() => {
      pending = result.current.refetch();
    });
    await waitFor(() => {
      expect(urls).toHaveLength(2);
    });
    await pending;
  });
});
