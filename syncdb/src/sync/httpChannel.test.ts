import {describe, expect, it} from "bun:test";

import type {AuthProvider} from "../types";
import {
  AuthRequiredError,
  createHttpChannel,
  type FetchLike,
  ListRequestError,
  QueryFieldNotAllowedError,
} from "./httpChannel";

const authProvider: Pick<AuthProvider, "getToken"> = {
  getToken: async () => "token-123",
};

interface RecordedRequest {
  input: string;
  init?: RequestInit;
}

const makeFetch = (
  responder: (input: string, init?: RequestInit) => Response | Promise<Response>
): {fetchImpl: FetchLike; requests: RecordedRequest[]} => {
  const requests: RecordedRequest[] = [];
  const fetchImpl: FetchLike = async (input, init) => {
    requests.push({init, input});
    return responder(input, init);
  };
  return {fetchImpl, requests};
};

const headersOf = (request: RecordedRequest | undefined): Record<string, string> =>
  (request?.init?.headers ?? {}) as Record<string, string>;

const json = (body: unknown, status = 200): Response =>
  new Response(JSON.stringify(body), {
    headers: {"Content-Type": "application/json"},
    status,
  });

describe("createHttpChannel", () => {
  describe("fetchSnapshotPage", () => {
    it("requests the snapshot with bearer token, stream, cursor, and limit", async () => {
      const page = {
        cursor: 5,
        entities: [],
        frontierSeq: 5,
        hasMore: false,
        oldestRetainedSeq: 0,
        stream: "todos|owner:u1",
      };
      const {fetchImpl, requests} = makeFetch(() => json(page));
      const channel = createHttpChannel({authProvider, baseUrl: "http://api", fetchImpl});
      const result = await channel.fetchSnapshotPage({
        cursor: 3,
        limit: 10,
        stream: "todos|owner:u1",
      });
      expect(result).toEqual(page);
      expect(requests[0]?.input).toBe(
        "http://api/sync/snapshot?cursor=3&stream=todos%7Cowner%3Au1&limit=10"
      );
      expect(headersOf(requests[0]).Authorization).toBe("Bearer token-123");
    });

    it("attaches X-Organization-Id when an organizationIdProvider returns an id", async () => {
      const {fetchImpl, requests} = makeFetch(() =>
        json({
          cursor: 0,
          entities: [],
          frontierSeq: 0,
          hasMore: false,
          oldestRetainedSeq: 0,
          stream: "todos|owner:u1",
        })
      );
      const channel = createHttpChannel({
        authProvider,
        baseUrl: "http://api",
        fetchImpl,
        organizationIdProvider: () => "org-selected",
      });
      await channel.fetchSnapshotPage({cursor: 0, stream: "todos|owner:u1"});
      expect(headersOf(requests[0])["X-Organization-Id"]).toBe("org-selected");
    });

    it("forwards the legacyCursor token (C3) when provided", async () => {
      const page = {
        cursor: 0,
        entities: [],
        frontierSeq: 0,
        hasMore: true,
        legacyCursor: "abc123",
        oldestRetainedSeq: 0,
        stream: "todos|owner:u1",
      };
      const {fetchImpl, requests} = makeFetch(() => json(page));
      const channel = createHttpChannel({authProvider, baseUrl: "http://api", fetchImpl});
      const result = await channel.fetchSnapshotPage({
        cursor: 0,
        legacyCursor: "prev-id",
        stream: "todos|owner:u1",
      });
      expect(result.legacyCursor).toBe("abc123");
      expect(requests[0]?.input).toContain("legacyCursor=prev-id");
    });

    it("omits the limit parameter and the auth header when absent", async () => {
      const {fetchImpl, requests} = makeFetch(() =>
        json({
          cursor: 0,
          entities: [],
          frontierSeq: 0,
          hasMore: false,
          oldestRetainedSeq: 0,
          stream: "todos|owner:u1",
        })
      );
      const channel = createHttpChannel({
        authProvider: {getToken: async () => null},
        baseUrl: "http://api",
        fetchImpl,
      });
      await channel.fetchSnapshotPage({cursor: 0, stream: "todos|owner:u1"});
      expect(requests[0]?.input).toBe(
        "http://api/sync/snapshot?cursor=0&stream=todos%7Cowner%3Au1"
      );
      expect(headersOf(requests[0]).Authorization).toBeUndefined();
    });

    it("rejects with AuthRequiredError on 401", async () => {
      const {fetchImpl} = makeFetch(() => json({}, 401));
      const channel = createHttpChannel({authProvider, baseUrl: "http://api", fetchImpl});
      await expect(
        channel.fetchSnapshotPage({cursor: 0, stream: "todos|owner:u1"})
      ).rejects.toThrow(AuthRequiredError);
    });

    it("rejects on non-ok statuses", async () => {
      const {fetchImpl} = makeFetch(() => json({}, 404));
      const channel = createHttpChannel({authProvider, baseUrl: "http://api", fetchImpl});
      await expect(
        channel.fetchSnapshotPage({cursor: 0, stream: "todos|owner:u1"})
      ).rejects.toThrow("status 404");
    });

    it("propagates network errors", async () => {
      const {fetchImpl} = makeFetch(() => {
        throw new Error("offline");
      });
      const channel = createHttpChannel({authProvider, baseUrl: "http://api", fetchImpl});
      await expect(
        channel.fetchSnapshotPage({cursor: 0, stream: "todos|owner:u1"})
      ).rejects.toThrow("offline");
    });
  });

  describe("fetchStreams", () => {
    it("GETs /sync/streams and returns the membership set", async () => {
      const streams = [
        {collection: "todos", stream: "todos|owner:u1"},
        {collection: "todos", stream: "todos|tenant:org1"},
      ];
      const {fetchImpl, requests} = makeFetch(() => json({streams}));
      const channel = createHttpChannel({authProvider, baseUrl: "http://api", fetchImpl});
      await expect(channel.fetchStreams()).resolves.toEqual(streams);
      expect(requests[0]?.input).toBe("http://api/sync/streams");
      expect(headersOf(requests[0]).Authorization).toBe("Bearer token-123");
    });

    it("returns an empty array when the body has no streams field", async () => {
      const {fetchImpl} = makeFetch(() => json({}));
      const channel = createHttpChannel({authProvider, baseUrl: "http://api", fetchImpl});
      await expect(channel.fetchStreams()).resolves.toEqual([]);
    });

    it("rejects with AuthRequiredError on 401 (INV-2: never treated as a leave)", async () => {
      const {fetchImpl} = makeFetch(() => json({}, 401));
      const channel = createHttpChannel({authProvider, baseUrl: "http://api", fetchImpl});
      await expect(channel.fetchStreams()).rejects.toBeInstanceOf(AuthRequiredError);
    });

    it("rejects on non-ok statuses", async () => {
      const {fetchImpl} = makeFetch(() => json({}, 500));
      const channel = createHttpChannel({authProvider, baseUrl: "http://api", fetchImpl});
      await expect(channel.fetchStreams()).rejects.toThrow("status 500");
    });
  });

  describe("sendMutation", () => {
    const mutation = {
      collection: "todos",
      data: {title: "hi"},
      id: "t1",
      mutationId: "m1",
      operation: "create" as const,
    };

    it("POSTs the mutation and maps 200 {ack} to an ack result", async () => {
      const ack = {id: "t1", mutationId: "m1", seq: 7};
      const {fetchImpl, requests} = makeFetch(() => json({ack}));
      const channel = createHttpChannel({authProvider, baseUrl: "http://api", fetchImpl});
      const result = await channel.sendMutation(mutation);
      expect(result).toEqual({ack, type: "ack"});
      expect(requests[0]?.input).toBe("http://api/sync/mutate");
      expect(requests[0]?.init?.method).toBe("POST");
      expect(JSON.parse(String(requests[0]?.init?.body))).toEqual(mutation);
      const headers = requests[0]?.init?.headers as Record<string, string>;
      expect(headers["Content-Type"]).toBe("application/json");
    });

    it.each([
      [409, "conflict"],
      [403, "unauthorized"],
      [422, "validation"],
      [500, "error"],
    ] as const)("maps %i {nack} bodies to nack results", async (status, code) => {
      const nack = {code, mutationId: "m1", serverSeq: 3};
      const {fetchImpl} = makeFetch(() => json({nack}, status));
      const channel = createHttpChannel({authProvider, baseUrl: "http://api", fetchImpl});
      const result = await channel.sendMutation(mutation);
      expect(result).toEqual({nack, type: "nack"});
    });

    it("rejects with AuthRequiredError on 401", async () => {
      const {fetchImpl} = makeFetch(() => json({}, 401));
      const channel = createHttpChannel({authProvider, baseUrl: "http://api", fetchImpl});
      await expect(channel.sendMutation(mutation)).rejects.toThrow(AuthRequiredError);
    });

    it("rejects when an error status has no nack body", async () => {
      const {fetchImpl} = makeFetch(() => json({}, 500));
      const channel = createHttpChannel({authProvider, baseUrl: "http://api", fetchImpl});
      await expect(channel.sendMutation(mutation)).rejects.toThrow("status 500");
    });

    it("rejects on non-JSON responses", async () => {
      const {fetchImpl} = makeFetch(() => new Response("<html>bad gateway</html>", {status: 502}));
      const channel = createHttpChannel({authProvider, baseUrl: "http://api", fetchImpl});
      await expect(channel.sendMutation(mutation)).rejects.toThrow("non-JSON");
    });

    it("rejects when a 200 body carries neither ack nor nack", async () => {
      const {fetchImpl} = makeFetch(() => json({}));
      const channel = createHttpChannel({authProvider, baseUrl: "http://api", fetchImpl});
      await expect(channel.sendMutation(mutation)).rejects.toThrow("status 200");
    });
  });

  describe("fetchEntities", () => {
    it("GETs /sync/entities with collection and ids", async () => {
      const body = {
        entities: [{data: {title: "a"}, deleted: false, id: "a", seq: 1}],
      };
      const {fetchImpl, requests} = makeFetch(() => json(body));
      const channel = createHttpChannel({authProvider, baseUrl: "http://api", fetchImpl});
      await expect(channel.fetchEntities({collection: "todos", ids: ["a", "b"]})).resolves.toEqual(
        body
      );
      expect(requests[0]?.input).toBe("http://api/sync/entities?collection=todos&ids=a%2Cb");
    });

    it("rejects on non-ok statuses", async () => {
      const {fetchImpl} = makeFetch(() => json({}, 500));
      const channel = createHttpChannel({authProvider, baseUrl: "http://api", fetchImpl});
      await expect(channel.fetchEntities({collection: "todos", ids: ["a"]})).rejects.toThrow(
        "status 500"
      );
    });
  });

  describe("sendMutationBatch", () => {
    const batch = {
      mutations: [
        {
          collection: "todos",
          data: {title: "hi"},
          id: "t1",
          mutationId: "m1",
          operation: "create" as const,
        },
      ],
    };

    it("maps 200 results to a results payload", async () => {
      const results = [{ack: {id: "t1", mutationId: "m1", seq: 1}, type: "ack" as const}];
      const {fetchImpl} = makeFetch(() => json({results}));
      const channel = createHttpChannel({authProvider, baseUrl: "http://api", fetchImpl});
      await expect(channel.sendMutationBatch?.(batch)).resolves.toEqual({results, type: "results"});
    });

    it("maps 404 to unsupported", async () => {
      const {fetchImpl} = makeFetch(() => json({}, 404));
      const channel = createHttpChannel({authProvider, baseUrl: "http://api", fetchImpl});
      await expect(channel.sendMutationBatch?.(batch)).resolves.toEqual({type: "unsupported"});
    });

    it("rejects on non-JSON responses", async () => {
      const {fetchImpl} = makeFetch(() => new Response("nope", {status: 500}));
      const channel = createHttpChannel({authProvider, baseUrl: "http://api", fetchImpl});
      await expect(channel.sendMutationBatch?.(batch)).rejects.toThrow("non-JSON");
    });

    it("rejects when results is missing", async () => {
      const {fetchImpl} = makeFetch(() => json({}));
      const channel = createHttpChannel({authProvider, baseUrl: "http://api", fetchImpl});
      await expect(channel.sendMutationBatch?.(batch)).rejects.toThrow("status 200");
    });
  });

  it("uses global fetch when no fetchImpl is provided (network error path)", async () => {
    const channel = createHttpChannel({
      authProvider,
      // Port 9 (discard) is never listening locally; fetch fails fast.
      baseUrl: "http://127.0.0.1:9",
    });
    await expect(
      channel.fetchSnapshotPage({cursor: 0, stream: "todos|owner:u1"})
    ).rejects.toThrow();
  });

  describe("fetchKeyMaterial", () => {
    it("fetches GET /sync/key with the bearer token and returns the material", async () => {
      const {fetchImpl, requests} = makeFetch(() => json({keyMaterial: "material-abc"}));
      const channel = createHttpChannel({authProvider, baseUrl: "http://api", fetchImpl});
      await expect(channel.fetchKeyMaterial()).resolves.toBe("material-abc");
      expect(requests[0].input).toBe("http://api/sync/key");
      expect(headersOf(requests[0]).Authorization).toBe("Bearer token-123");
    });

    it("rejects with AuthRequiredError on 401", async () => {
      const {fetchImpl} = makeFetch(() => json({}, 401));
      const channel = createHttpChannel({authProvider, baseUrl: "http://api", fetchImpl});
      await expect(channel.fetchKeyMaterial()).rejects.toBeInstanceOf(AuthRequiredError);
    });

    it("rejects on non-ok statuses and missing keyMaterial", async () => {
      const bad = createHttpChannel({
        authProvider,
        baseUrl: "http://api",
        fetchImpl: makeFetch(() => json({}, 500)).fetchImpl,
      });
      await expect(bad.fetchKeyMaterial()).rejects.toThrow(/status 500/);

      const empty = createHttpChannel({
        authProvider,
        baseUrl: "http://api",
        fetchImpl: makeFetch(() => json({})).fetchImpl,
      });
      await expect(empty.fetchKeyMaterial()).rejects.toThrow(/missing keyMaterial/);
    });
  });

  describe("fetchList", () => {
    it("qs-encodes params against the list path", async () => {
      const {fetchImpl, requests} = makeFetch(() => json({data: [], limit: 10, more: false}));
      const channel = createHttpChannel({authProvider, baseUrl: "https://api.test", fetchImpl});
      await channel.fetchList?.({params: {completed: false, limit: 10, page: 1}, path: "/todos"});
      expect(decodeURIComponent(requests[0].input)).toBe(
        "https://api.test/todos?completed=false&limit=10&page=1"
      );
    });

    it("raises QueryFieldNotAllowedError naming the field and allowed queryFields", async () => {
      const {fetchImpl} = makeFetch(() =>
        json(
          {
            code: "query-param-not-allowed",
            detail: 'title is not allowed as a query param. Add "title" to queryFields…',
            meta: {
              allowedQueryFields: ["completed", "ownerId"],
              model: "Todo",
              queryParam: "title",
            },
            source: {parameter: "title"},
            status: 400,
            title: "Query parameter not allowed",
          },
          400
        )
      );
      const channel = createHttpChannel({authProvider, baseUrl: "https://api.test", fetchImpl});
      const error = await channel
        .fetchList?.({params: {title: "x"}, path: "/todos"})
        .catch((caught: unknown) => caught);
      expect(error).toBeInstanceOf(QueryFieldNotAllowedError);
      const typed = error as QueryFieldNotAllowedError;
      expect(typed.field).toBe("title");
      expect(typed.allowedQueryFields).toEqual(["completed", "ownerId"]);
      expect(typed.model).toBe("Todo");
      expect(typed.code).toBe("query-param-not-allowed");
      expect(typed.message).toContain('Add "title" to queryFields');
      expect(typed.message).toContain("Allowed: completed, ownerId.");
    });

    it("raises ListRequestError with the server detail for other failures", async () => {
      const {fetchImpl} = makeFetch(() =>
        json({code: "list-error", detail: "boom", status: 500, title: "List error"}, 500)
      );
      const channel = createHttpChannel({authProvider, baseUrl: "https://api.test", fetchImpl});
      const error = await channel
        .fetchList?.({params: {}, path: "/todos"})
        .catch((caught: unknown) => caught);
      expect(error).toBeInstanceOf(ListRequestError);
      expect(error).not.toBeInstanceOf(QueryFieldNotAllowedError);
      expect((error as ListRequestError).message).toBe(
        "List request for /todos failed with status 500: boom"
      );
    });
  });
});
