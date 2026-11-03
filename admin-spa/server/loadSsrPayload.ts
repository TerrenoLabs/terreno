import {adminRpcSeedKey} from "@terreno/admin-frontend";
import {getAdminSpaServerContext} from "../src/serverContext";

/** Request headers a loader may forward, lowercase. The admin hooks send only this one. */
const ALLOWED_SSR_HEADERS = new Set(["x-organization-id"]);

/** Base for parsing a request path on its own; any other origin means the URL was absolute. */
const PATH_BASE = "http://ssr.invalid";

/** One API read a server render needs, as the client hook would request it. */
export interface SsrPayloadRequest {
  /** Path plus query string, with route params already `encodeURIComponent`-encoded. */
  url: string;
  /** Allowlisted headers only (`X-Organization-Id`). */
  headers?: Record<string, string>;
}

/** Bodies and statuses keyed by `adminRpcSeedKey(url, headers)`; failed reads have no body. */
export interface SsrPayload {
  rpc: Record<string, unknown>;
  status: Record<string, number>;
}

interface PreparedRequest {
  headers: Record<string, string>;
  key: string;
  /** Path and query, as fetched. */
  path: string;
  /** Path without the query, the only part an error may name: a query can hold PHI. */
  pathname: string;
}

/**
 * Validate one request against the header allowlist and the path prefixes. Returns the
 * normalized path (dot segments resolved, encoded segments kept encoded) so the fetch goes
 * exactly where the check looked.
 */
const prepareRequest = (request: SsrPayloadRequest, prefixes: string[]): PreparedRequest => {
  const seenHeaders = new Set<string>();
  for (const name of Object.keys(request.headers ?? {})) {
    const lowerName = name.toLowerCase();
    if (!ALLOWED_SSR_HEADERS.has(lowerName)) {
      throw new Error(`SSR header not allowed: ${name}`);
    }
    // Two spellings of one header would be sent merged and key a seed the client never asks for.
    if (seenHeaders.has(lowerName)) {
      throw new Error(`SSR header not allowed: duplicate ${name}`);
    }
    seenHeaders.add(lowerName);
  }
  if (!request.url.startsWith("/") || request.url.startsWith("//") || request.url.includes("\\")) {
    throw new Error("SSR path not allowed");
  }
  const parsed = new URL(request.url, PATH_BASE);
  if (parsed.origin !== PATH_BASE) {
    throw new Error("SSR path not allowed");
  }
  const pathname = parsed.pathname;
  const isAllowed = prefixes.some(
    (prefix) => pathname === prefix || pathname.startsWith(`${prefix}/`)
  );
  if (!isAllowed) {
    throw new Error(`SSR path not allowed: ${pathname}`);
  }
  return {
    headers: request.headers ?? {},
    key: adminRpcSeedKey(request.url, request.headers),
    path: `${pathname}${parsed.search}`,
    pathname,
  };
};

/** Longest a server render waits on one loopback read, as the gate waits on its own. */
const SSR_FETCH_TIMEOUT_MS = 5000;

/**
 * One loopback read. A network error, a timeout or a body that is not JSON leaves the read out
 * (the screen loads it on the client) and warns with the path only: never the query string,
 * the cookie or the body, which can hold PHI.
 */
const readOne = async (
  {headers, key, path, pathname}: PreparedRequest,
  {
    cookie,
    internalOrigin,
    payload,
    timeoutMs,
  }: {
    cookie: string;
    internalOrigin: string;
    payload: SsrPayload;
    timeoutMs: number;
  }
): Promise<void> => {
  let response: Response;
  try {
    response = await fetch(`${internalOrigin}${path}`, {
      headers: {...headers, Accept: "application/json", Cookie: cookie},
      redirect: "manual",
      signal: AbortSignal.timeout(timeoutMs),
    });
  } catch (error) {
    const reason = error instanceof Error ? error.name : "unknown error";
    console.warn(`[adminSpaSsr] SSR fetch failed for ${pathname}: ${reason}`);
    return;
  }
  payload.status[key] = response.status;
  if (!response.ok) {
    return;
  }
  try {
    payload.rpc[key] = await response.json();
  } catch {
    delete payload.status[key];
    console.warn(`[adminSpaSsr] SSR response for ${pathname} is not JSON`);
  }
};

/**
 * Fetch the API reads a server render needs, in parallel, from the backend's own internal
 * origin with the incoming request's session cookie. Every request is checked before any is
 * sent, and a rejected request throws before anything is fetched. An anonymous request (no
 * cookie) fetches nothing, so anonymous traffic never shares the loopback address's rate-limit
 * bucket. Each read fails on its own (see `readOne`): its siblings still seed.
 */
export const loadSsrPayload = async (
  request: Request,
  {requests, timeoutMs = SSR_FETCH_TIMEOUT_MS}: {requests: SsrPayloadRequest[]; timeoutMs?: number}
): Promise<SsrPayload> => {
  const context = getAdminSpaServerContext();
  if (!context) {
    throw new Error("Admin SPA server context is not published");
  }
  const prepared = requests.map((entry) => prepareRequest(entry, context.ssrApiPrefixes));
  const payload: SsrPayload = {rpc: {}, status: {}};
  const cookie = request.headers.get("cookie");
  if (!cookie) {
    return payload;
  }
  const {internalOrigin} = context;
  await Promise.all(
    prepared.map((entry) => readOne(entry, {cookie, internalOrigin, payload, timeoutMs}))
  );
  return payload;
};
