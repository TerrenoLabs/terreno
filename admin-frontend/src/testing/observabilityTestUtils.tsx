import {act} from "@testing-library/react-native";
import React from "react";
import {AdminProvider} from "../AdminProvider";

/** One request the stubbed `fetch` received. */
export interface CapturedObservabilityRequest {
  body?: unknown;
  headers: Record<string, string>;
  method: string;
  url: string;
}

interface StubResponse {
  body?: unknown;
  status?: number;
}

/**
 * Replace `globalThis.fetch` for observability hook tests. `respond` picks the JSON
 * body per request (default `{data: {}}`); call `restore()` in `afterEach`.
 */
export const stubObservabilityFetch = (
  respond?: (request: CapturedObservabilityRequest) => StubResponse
): {calls: CapturedObservabilityRequest[]; restore: () => void} => {
  const originalFetch = globalThis.fetch;
  const calls: CapturedObservabilityRequest[] = [];
  globalThis.fetch = (async (input: string, init?: RequestInit) => {
    const headers: Record<string, string> = {};
    new Headers(init?.headers).forEach((value, key) => {
      headers[key] = value;
    });
    const request: CapturedObservabilityRequest = {
      body: typeof init?.body === "string" ? JSON.parse(init.body) : init?.body,
      headers,
      method: init?.method ?? "GET",
      url: String(input),
    };
    calls.push(request);
    const {body = {data: {}}, status = 200} = respond?.(request) ?? {};
    return new Response(JSON.stringify(body), {
      headers: {"Content-Type": "application/json"},
      status,
    });
  }) as typeof fetch;
  return {
    calls,
    restore: (): void => {
      globalThis.fetch = originalFetch;
    },
  };
};

/** `renderHook` wrapper that supplies the host-bound admin client. */
export const ObservabilityTestProvider: React.FC<{children: React.ReactNode}> = ({children}) => {
  return (
    <AdminProvider apiBase="/admin" credentials="same-origin" routeBase="/admin">
      {children}
    </AdminProvider>
  );
};

/** Let pending fetch promises and the state updates they trigger settle. */
export const flushObservabilityRequests = async (): Promise<void> => {
  for (let index = 0; index < 4; index += 1) {
    await act(async () => {
      await Promise.resolve();
      await new Promise((resolve) => setTimeout(resolve, 0));
    });
  }
};
