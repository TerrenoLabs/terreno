/**
 * Fake observability backend for AI observability screen tests.
 *
 * Screens render inside a real `AdminProvider`, so every request runs through the
 * production hooks, the host-bound admin client, and `fetch`. Each
 * {@link FakeObservabilityServer} owns a unique API origin; the stubbed `fetch`
 * routes requests for that origin to the server's route table and records them.
 *
 * Route keys are `"<METHOD> <path>"`, where `:param` matches one path segment
 * (`"GET /ai/observability/datasets/:id/items"`). A route is either:
 * - a {@link FakeQueryState} read at request time: `isLoading` keeps the request
 *   pending, `isError` answers with an error status, otherwise `data` is the body;
 * - a handler `(request) => body`: its return value (or resolved promise) is the
 *   JSON body; a thrown `{status?, data: {title}}` becomes an error response.
 *
 * Unmatched GETs answer `204 No Content` (no data, no error); unmatched writes
 * answer `{}`.
 */
import {act} from "@testing-library/react-native";
import React, {useState} from "react";
import {AdminProvider} from "../AdminProvider";

/** One request the fake server received. */
export interface FakeObservabilityRequest {
  body?: unknown;
  headers: Record<string, string>;
  method: string;
  /** Path without the origin or query string. */
  path: string;
  /** Matched `:param` values. */
  params: Record<string, string>;
  query: Record<string, string>;
  url: string;
}

/** Server state for a GET route, read each time the route is requested. */
export interface FakeQueryState {
  data?: unknown;
  error?: unknown;
  isError?: boolean;
  isLoading?: boolean;
}

export type FakeObservabilityHandler = (request: FakeObservabilityRequest) => unknown;

export type FakeObservabilityRoute = FakeObservabilityHandler | FakeQueryState;

export type FakeObservabilityRoutes = Record<string, FakeObservabilityRoute>;

export interface FakeObservabilityServer {
  /** Every request this server answered, in order. */
  calls: FakeObservabilityRequest[];
  /** Requests whose `"<METHOD> <path>"` matched `routeKey` (a route-table key). */
  callsTo: (routeKey: string) => FakeObservabilityRequest[];
  origin: string;
  routes: FakeObservabilityRoutes;
}

interface StubResponse {
  body?: unknown;
  status: number;
}

const servers = new Map<string, FakeObservabilityServer>();
let serverCount = 0;

const splitPath = (path: string): string[] => path.split("/").filter(Boolean);

const matchRoute = ({
  method,
  path,
  routeKey,
}: {
  method: string;
  path: string;
  routeKey: string;
}): Record<string, string> | null => {
  const [routeMethod, routePath = ""] = routeKey.split(" ");
  if (routeMethod !== method) {
    return null;
  }
  const routeSegments = splitPath(routePath);
  const pathSegments = splitPath(path);
  if (routeSegments.length !== pathSegments.length) {
    return null;
  }
  const params: Record<string, string> = {};
  for (let index = 0; index < routeSegments.length; index += 1) {
    const routeSegment = routeSegments[index] ?? "";
    const pathSegment = pathSegments[index] ?? "";
    if (routeSegment.startsWith(":")) {
      params[routeSegment.slice(1)] = decodeURIComponent(pathSegment);
      continue;
    }
    if (routeSegment !== pathSegment) {
      return null;
    }
  }
  return params;
};

/** Literal routes win over `:param` routes so `/experiments/estimate` beats `/experiments/:id`. */
const paramCount = (routeKey: string): number => (routeKey.match(/:/g) ?? []).length;

const findRoute = ({
  method,
  path,
  routes,
}: {
  method: string;
  path: string;
  routes: FakeObservabilityRoutes;
}): {params: Record<string, string>; route: FakeObservabilityRoute} | null => {
  const keys = Object.keys(routes).sort((left, right) => paramCount(left) - paramCount(right));
  for (const routeKey of keys) {
    const params = matchRoute({method, path, routeKey});
    const route = routes[routeKey];
    if (params && route) {
      return {params, route};
    }
  }
  return null;
};

const errorResponse = (error: unknown, fallbackStatus: number): StubResponse => {
  const shape = (error ?? {}) as {
    data?: {detail?: string; title?: string};
    message?: string;
    status?: number;
  };
  const title = shape.data?.title || shape.message || "Request failed";
  return {
    body: {detail: shape.data?.detail, title},
    status: typeof shape.status === "number" ? shape.status : fallbackStatus,
  };
};

const pendingUntilAborted = (signal?: AbortSignal | null): Promise<StubResponse> => {
  return new Promise((_resolve, reject) => {
    signal?.addEventListener("abort", () => {
      reject(new DOMException("Aborted", "AbortError"));
    });
  });
};

const respond = async ({
  request,
  route,
  signal,
}: {
  request: FakeObservabilityRequest;
  route: FakeObservabilityRoute | undefined;
  signal?: AbortSignal | null;
}): Promise<StubResponse> => {
  if (!route) {
    return request.method === "GET" ? {status: 204} : {body: {}, status: 200};
  }
  if (typeof route === "function") {
    try {
      const body = await route(request);
      return body === undefined ? {status: 204} : {body, status: 200};
    } catch (error) {
      return errorResponse(error, 400);
    }
  }
  if (route.isLoading) {
    return pendingUntilAborted(signal);
  }
  if (route.isError) {
    return errorResponse(route.error, 500);
  }
  return route.data === undefined ? {status: 204} : {body: route.data, status: 200};
};

const parseBody = (body: BodyInit | null | undefined): unknown => {
  if (typeof body !== "string") {
    return body ?? undefined;
  }
  try {
    return JSON.parse(body);
  } catch {
    return body;
  }
};

let originalFetch: typeof fetch | undefined;

/** Route `fetch` calls for fake-server origins; other URLs use the real `fetch`. */
const installFetchStub = (): void => {
  if (originalFetch) {
    return;
  }
  const realFetch = globalThis.fetch;
  originalFetch = realFetch;
  globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = new URL(String(input));
    const server = servers.get(url.origin);
    if (!server) {
      return realFetch(input, init);
    }
    const method = init?.method ?? "GET";
    const headers: Record<string, string> = {};
    new Headers(init?.headers).forEach((value, key) => {
      headers[key] = value;
    });
    const query: Record<string, string> = {};
    url.searchParams.forEach((value, key) => {
      query[key] = value;
    });
    const match = findRoute({method, path: url.pathname, routes: server.routes});
    const request: FakeObservabilityRequest = {
      body: parseBody(init?.body),
      headers,
      method,
      params: match?.params ?? {},
      path: url.pathname,
      query,
      url: url.toString(),
    };
    server.calls.push(request);
    const {body, status} = await respond({request, route: match?.route, signal: init?.signal});
    if (status === 204) {
      return new Response(null, {status});
    }
    return new Response(JSON.stringify(body), {
      headers: {"Content-Type": "application/json"},
      status,
    });
  }) as typeof fetch;
};

/** Create a fake backend with its own origin; pass it to a widget wrapped by {@link withObservabilityServer}. */
export const createObservabilityServer = (
  routes: FakeObservabilityRoutes = {}
): FakeObservabilityServer => {
  installFetchStub();
  serverCount += 1;
  const origin = `http://observability-${serverCount}.test`;
  const server: FakeObservabilityServer = {
    calls: [],
    callsTo: (routeKey: string): FakeObservabilityRequest[] =>
      server.calls.filter((request) =>
        Boolean(matchRoute({method: request.method, path: request.path, routeKey}))
      ),
    origin,
    routes,
  };
  servers.set(origin, server);
  return server;
};

/** Wrap a widget in an `AdminProvider` whose API origin is the given fake server. */
export const withObservabilityServer = <P extends object>(
  Widget: React.ComponentType<P>
): React.FC<P & {server?: FakeObservabilityServer}> => {
  const Wrapped: React.FC<P & {server?: FakeObservabilityServer}> = ({server, ...props}) => {
    // Widgets rendered without a server still get a stable origin of their own.
    const [fallbackOrigin] = useState(() => (server ? "" : createObservabilityServer().origin));
    const origin = server?.origin ?? fallbackOrigin;
    return (
      <AdminProvider apiBase="/admin" apiOrigin={origin} routeBase="/admin">
        <Widget {...(props as P)} />
      </AdminProvider>
    );
  };
  return Wrapped;
};

/** Let pending fake requests and the state updates they trigger settle. */
export const flushObservabilityRequests = async (): Promise<void> => {
  for (let index = 0; index < 4; index += 1) {
    await act(async () => {
      await Promise.resolve();
      await new Promise((resolve) => setTimeout(resolve, 0));
    });
  }
};
