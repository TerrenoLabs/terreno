import {encodeQueryParams} from "../query/where";
import type {
  AuthProvider,
  ListResponse,
  SyncAck,
  SyncEntitiesResponse,
  SyncMutateBatchRequest,
  SyncMutateRequest,
  SyncNack,
  SyncSnapshotResponse,
  SyncStreamInfo,
} from "../types";
import type {SendMutationBatchResult, SendMutationResult} from "./transport";

/**
 * Thrown when the server answers 401: the bearer token is missing or expired.
 * Distinguishable from ordinary transport errors so callers can pause and wait
 * for the next auth change instead of retrying with the same dead token.
 */
export class AuthRequiredError extends Error {
  constructor(message = "Authentication required") {
    super(message);
    this.name = "AuthRequiredError";
  }
}

export interface FetchSnapshotPageArgs {
  /** C2: the stream key to page (e.g. "todos|owner:123"), not a collection. */
  stream: string;
  /** Resume cursor (highest seq already applied); 0 = from the beginning. */
  cursor: number;
  /** Page size; server default applies when omitted. */
  limit?: number;
  /** C3: opaque legacy-stratum token echoed back from a prior page. */
  legacyCursor?: string;
}

/**
 * HTTP side of the sync protocol: snapshot paging for bootstrap/reconcile and
 * the `POST /sync/mutate` fallback used when the socket is unavailable.
 */
export interface HttpChannel {
  fetchSnapshotPage: (args: FetchSnapshotPageArgs) => Promise<SyncSnapshotResponse>;
  /**
   * Point lookup for entity repair: fetch canonical server state for specific ids
   * (`GET /sync/entities`). Used when deltas were skipped while an entity was
   * pending-protected and the cursor advanced past the missed seq.
   */
  fetchEntities: (args: {collection: string; ids: string[]}) => Promise<SyncEntitiesResponse>;
  /**
   * C2: the authoritative set of streams the caller currently belongs to
   * (`GET /sync/streams`). Drives join-backfill / leave-purge diffs; 401 rejects with
   * {@link AuthRequiredError} so a transport/auth error is never mistaken for a
   * membership change (INV-2).
   */
  fetchStreams: () => Promise<SyncStreamInfo[]>;
  /**
   * `GET {path}?{params}` against a `modelRouter` list endpoint, for query windows.
   * Params are qs-encoded so Mongo operators (`$in`, `$gte`, …) survive.
   */
  fetchList?: (args: {path: string; params: Record<string, unknown>}) => Promise<ListResponse>;
  /**
   * POST the mutation; 200 resolves `{type: "ack"}`, nack statuses
   * (409/403/422/500 with a `{nack}` body) resolve `{type: "nack"}`, 401
   * rejects with {@link AuthRequiredError}, anything else rejects.
   */
  sendMutation: (request: SyncMutateRequest) => Promise<SendMutationResult>;
  /**
   * POST the batch to `/sync/mutate/batch`; resolves `{type: "results", results}`
   * on 200/422 (both carry a `results` array — see server contract), resolves
   * `{type: "unsupported"}` on 404 (older server with no batch route), 401
   * rejects with {@link AuthRequiredError}, anything else rejects.
   */
  sendMutationBatch?: (request: SyncMutateBatchRequest) => Promise<SendMutationBatchResult>;
  /**
   * Fetch the caller's per-user key material from `GET /sync/key` — feeds the
   * default server-derived encryption KeyProvider.
   */
  fetchKeyMaterial: () => Promise<string>;
}

/** JSON:API-style error body `@terreno/api` returns (`APIError#toJSON`). */
interface ApiErrorBody {
  code?: string;
  detail?: string;
  title?: string;
  source?: {parameter?: string};
  meta?: {allowedQueryFields?: unknown; model?: unknown; queryParam?: unknown};
}

/** A `modelRouter` list request the server rejected (non-401). */
export class ListRequestError extends Error {
  readonly status: number;
  readonly code?: string;
  readonly path: string;
  readonly detail?: string;

  constructor({
    message,
    status,
    code,
    path,
    detail,
  }: {
    message: string;
    status: number;
    code?: string;
    path: string;
    detail?: string;
  }) {
    super(message);
    this.name = "ListRequestError";
    this.status = status;
    this.code = code;
    this.path = path;
    this.detail = detail;
  }
}

/**
 * A query window filtered on a field the route's `queryFields` does not allow
 * (server code `query-param-not-allowed`). Fix: add `field` to `queryFields` on
 * the `modelRouter`, or drop it from `where`.
 */
export class QueryFieldNotAllowedError extends ListRequestError {
  readonly field: string;
  readonly allowedQueryFields: string[];
  readonly model?: string;

  constructor({
    path,
    field,
    allowedQueryFields,
    model,
    detail,
  }: {
    path: string;
    field: string;
    allowedQueryFields: string[];
    model?: string;
    detail?: string;
  }) {
    const allowed = allowedQueryFields.length > 0 ? allowedQueryFields.join(", ") : "(none)";
    super({
      code: "query-param-not-allowed",
      detail,
      message:
        `GET ${path} rejected where field "${field}": it is not in queryFields on the ` +
        `${model ?? "route's"} modelRouter. Add "${field}" to queryFields or remove it from ` +
        `the window's where. Allowed: ${allowed}.`,
      path,
      status: 400,
    });
    this.name = "QueryFieldNotAllowedError";
    this.field = field;
    this.allowedQueryFields = allowedQueryFields;
    this.model = model;
  }
}

const readErrorBody = async (response: Response): Promise<ApiErrorBody> => {
  try {
    const body = (await response.json()) as ApiErrorBody | {errors?: ApiErrorBody[]};
    if (body && "errors" in body && Array.isArray(body.errors)) {
      return body.errors[0] ?? {};
    }
    return (body as ApiErrorBody) ?? {};
  } catch {
    return {};
  }
};

const listRequestError = async (path: string, response: Response): Promise<ListRequestError> => {
  const body = await readErrorBody(response);
  if (body.code === "query-param-not-allowed") {
    const allowed = Array.isArray(body.meta?.allowedQueryFields)
      ? body.meta.allowedQueryFields.filter((field): field is string => typeof field === "string")
      : [];
    const field =
      (typeof body.meta?.queryParam === "string" ? body.meta.queryParam : undefined) ??
      body.source?.parameter ??
      "unknown";
    return new QueryFieldNotAllowedError({
      allowedQueryFields: allowed,
      detail: body.detail,
      field,
      model: typeof body.meta?.model === "string" ? body.meta.model : undefined,
      path,
    });
  }
  const reason = body.detail ?? body.title;
  return new ListRequestError({
    code: body.code,
    detail: body.detail,
    message: `List request for ${path} failed with status ${response.status}${reason ? `: ${reason}` : ""}`,
    path,
    status: response.status,
  });
};

/** Minimal fetch signature (global fetch is assignable; tests inject stubs). */
export type FetchLike = (input: string, init?: RequestInit) => Promise<Response>;

export interface HttpChannelConfig {
  /** Server origin, e.g. "http://localhost:4000". */
  baseUrl: string;
  /** Token source; `getToken()` is called fresh on every request (never cached). */
  authProvider: Pick<AuthProvider, "getToken">;
  /** Fetch implementation override for tests/SSR (defaults to global fetch). */
  fetchImpl?: FetchLike;
  /** Selected organization id attached as `X-Organization-Id` when present. */
  organizationIdProvider?: () => string | undefined;
}

/** Create an {@link HttpChannel} speaking @terreno/api's `/sync/*` routes. */
export const createHttpChannel = ({
  baseUrl,
  authProvider,
  fetchImpl,
  organizationIdProvider,
}: HttpChannelConfig): HttpChannel => {
  const fetcher: FetchLike = fetchImpl ?? ((input, init) => globalThis.fetch(input, init));

  const request = async (path: string, init?: RequestInit): Promise<Response> => {
    const token = await authProvider.getToken();
    const organizationId = organizationIdProvider?.()?.trim();
    const headers: Record<string, string> = {
      Accept: "application/json",
      ...(init?.body !== undefined ? {"Content-Type": "application/json"} : {}),
      ...(token ? {Authorization: `Bearer ${token}`} : {}),
      ...(organizationId ? {"X-Organization-Id": organizationId} : {}),
    };
    const response = await fetcher(`${baseUrl}${path}`, {...init, headers});
    if (response.status === 401) {
      throw new AuthRequiredError(`401 from ${path}`);
    }
    return response;
  };

  const fetchSnapshotPage = async ({
    stream,
    cursor,
    limit,
    legacyCursor,
  }: FetchSnapshotPageArgs): Promise<SyncSnapshotResponse> => {
    const query = new URLSearchParams({cursor: String(cursor), stream});
    if (limit !== undefined) {
      query.set("limit", String(limit));
    }
    if (legacyCursor !== undefined) {
      query.set("legacyCursor", legacyCursor);
    }
    const response = await request(`/sync/snapshot?${query.toString()}`);
    if (!response.ok) {
      throw new Error(`Snapshot request for ${stream} failed with status ${response.status}`);
    }
    return (await response.json()) as SyncSnapshotResponse;
  };

  const fetchEntities = async ({
    collection,
    ids,
  }: {
    collection: string;
    ids: string[];
  }): Promise<SyncEntitiesResponse> => {
    const query = new URLSearchParams({
      collection,
      ids: ids.join(","),
    });
    const response = await request(`/sync/entities?${query.toString()}`);
    if (!response.ok) {
      throw new Error(`Entities request for ${collection} failed with status ${response.status}`);
    }
    return (await response.json()) as SyncEntitiesResponse;
  };

  const fetchList = async ({
    path,
    params,
  }: {
    path: string;
    params: Record<string, unknown>;
  }): Promise<ListResponse> => {
    const query = encodeQueryParams(params);
    const response = await request(query ? `${path}?${query}` : path);
    if (!response.ok) {
      throw await listRequestError(path, response);
    }
    return (await response.json()) as ListResponse;
  };

  const fetchStreams = async (): Promise<SyncStreamInfo[]> => {
    const response = await request("/sync/streams");
    if (!response.ok) {
      throw new Error(`Sync streams request failed with status ${response.status}`);
    }
    const body = (await response.json()) as {streams?: SyncStreamInfo[]};
    return Array.isArray(body.streams) ? body.streams : [];
  };

  const sendMutation = async (mutation: SyncMutateRequest): Promise<SendMutationResult> => {
    const response = await request("/sync/mutate", {
      body: JSON.stringify(mutation),
      method: "POST",
    });
    let body: unknown;
    try {
      body = await response.json();
    } catch {
      throw new Error(`Sync mutate returned a non-JSON response (status ${response.status})`);
    }
    const parsed = body as {ack?: SyncAck; nack?: SyncNack};
    if (response.ok && parsed.ack) {
      return {ack: parsed.ack, type: "ack"};
    }
    if (parsed.nack) {
      return {nack: parsed.nack, type: "nack"};
    }
    throw new Error(`Sync mutate failed with status ${response.status}`);
  };

  const sendMutationBatch = async (
    batch: SyncMutateBatchRequest
  ): Promise<SendMutationBatchResult> => {
    const response = await request("/sync/mutate/batch", {
      body: JSON.stringify(batch),
      method: "POST",
    });
    if (response.status === 404) {
      return {type: "unsupported"};
    }
    let body: unknown;
    try {
      body = await response.json();
    } catch {
      throw new Error(`Sync mutate batch returned a non-JSON response (status ${response.status})`);
    }
    const parsed = body as {results?: SendMutationResult[]};
    if (!Array.isArray(parsed.results)) {
      throw new Error(`Sync mutate batch failed with status ${response.status}`);
    }
    return {results: parsed.results, type: "results"};
  };

  const fetchKeyMaterial = async (): Promise<string> => {
    const response = await request("/sync/key");
    if (!response.ok) {
      throw new Error(`Sync key request failed with status ${response.status}`);
    }
    const body = (await response.json()) as {keyMaterial?: string};
    if (!body.keyMaterial) {
      throw new Error("Sync key response is missing keyMaterial");
    }
    return body.keyMaterial;
  };

  return {
    fetchEntities,
    fetchKeyMaterial,
    fetchList,
    fetchSnapshotPage,
    fetchStreams,
    sendMutation,
    sendMutationBatch,
  };
};
