import {afterEach, beforeEach, describe, expect, it, mock, spyOn} from "bun:test";
import type {AuthProvider} from "@terreno/syncdb";

import type {QueuedMutation} from "../offlineSlice";

mock.module("react-native", () => ({
  Platform: {OS: "web"},
  StyleSheet: {create: (styles: unknown) => styles},
}));
mock.module("../platform", () => ({IsWeb: true}));

let authToken: string | null = null;
let currentUserId: string | undefined = "test-user";

mock.module("../authSlice", () => ({
  getAuthToken: async () => authToken,
  selectCurrentUserId: (state: {auth?: {userId?: string}}) => state.auth?.userId,
}));
mock.module("../constants", () => ({
  baseUrl: "http://localhost:4000",
  LOGOUT_ACTION_TYPE: "auth/logout",
}));
// Stand-in for the built-in JWT token source, which rtk uses when no source is registered. Its
// delegation to getAuthToken is tested in emptyApi.staggered.isolated.ts and tokenSource.test.ts.
const fakeJwtTokenSource: AuthProvider = {
  getToken: async (): Promise<string | null> => authToken,
  getUserId: async (): Promise<string | null> => "jwt-source-user",
  onAuthChange: (): (() => void) => (): void => {},
};
mock.module("../emptyApi", () => ({
  isJwtTokenSource: (source: AuthProvider | undefined): boolean =>
    !source || source === fakeJwtTokenSource,
  jwtTokenSource: fakeJwtTokenSource,
}));

const {configureStore} = await import("@reduxjs/toolkit");
const {createApi, fetchBaseQuery, QueryStatus} = await import("@reduxjs/toolkit/query");
const {createOfflineMiddleware, isNetworkFetchError, shouldReplayQueuedMutation} = await import(
  "../offlineMiddleware"
);
const {
  enqueue,
  selectConflicts,
  selectIsOnline,
  selectIsSyncing,
  selectOfflineQueue,
  setOnlineStatus,
  setSyncing,
} = await import("../offlineSlice");
const {setTokenSource} = await import("../tokenSource");
const {selectLastUserId} = await import("../offlineSlice");

interface TodoRecord {
  _id?: string;
  id?: string;
  title: string;
  completed?: boolean;
  updated?: string | Date;
}

const persistedMutation = (id: string): QueuedMutation => ({
  args: {body: {title: id}, id},
  endpointName: "patchTodosById",
  id,
  timestamp: "2025-01-01T00:00:00.000Z",
  type: "update",
  userId: "test-user",
});

interface ListResponse {
  data: TodoRecord[];
}

type TestStore = ReturnType<typeof createTestStore>;

const SET_USER_ACTION_TYPE = "test/setUser";

const createResponse = ({
  data = {data: {_id: "123", title: "Synced"}},
  status = 200,
}: {
  data?: unknown;
  status?: number;
} = {}) => ({
  json: () => Promise.resolve(data),
  status,
});

const mockFetch = mock(() => Promise.resolve(createResponse()));
globalThis.fetch = mockFetch as unknown as typeof fetch;

const api = createApi({
  baseQuery: fetchBaseQuery({baseUrl: "http://localhost:4000"}),
  endpoints: (builder) => ({
    deleteTodosById: builder.mutation({
      query: (args: {id: string}) => ({
        method: "DELETE",
        url: `/todos/${args.id}`,
      }),
    }),
    getPutTodos: builder.query<ListResponse, Record<string, unknown> | undefined>({
      query: () => "/todos",
    }),
    getTodos: builder.query<ListResponse, Record<string, unknown> | undefined>({
      query: () => "/todos",
    }),
    getTodosById: builder.query<{data: TodoRecord}, {id: string}>({
      query: ({id}) => `/todos/${id}`,
    }),
    patchTodosById: builder.mutation({
      query: (args: {id: string; body: Record<string, unknown>}) => ({
        body: args.body,
        method: "PATCH",
        url: `/todos/${args.id}`,
      }),
    }),
    postTodos: builder.mutation({
      query: (args: {body: Record<string, unknown>}) => ({
        body: args.body,
        method: "POST",
        url: "/todos",
      }),
    }),
  }),
  reducerPath: "terreno-rtk",
});

const createTestStore = (endpoints = ["postTodos", "patchTodosById", "deleteTodosById"]) => {
  const offline = createOfflineMiddleware({
    api: api as unknown as Parameters<typeof createOfflineMiddleware>[0]["api"],
    endpoints,
  });

  return configureStore({
    middleware: (getDefault) =>
      getDefault({serializableCheck: false}).concat(api.middleware, offline.middleware),
    reducer: {
      auth: (
        state: {userId?: string} = {userId: currentUserId},
        action: {type: string; userId?: string}
      ) => (action.type === SET_USER_ACTION_TYPE ? {userId: action.userId} : state),
      [api.reducerPath]: api.reducer,
      offline: offline.offlineReducer,
    },
  });
};

const waitForEffects = async (ms = 0): Promise<void> => {
  await new Promise((resolve) => setTimeout(resolve, ms));
};

const queueRejectedMutation = (
  store: TestStore,
  {
    endpointName = "patchTodosById",
    error = {message: "fetch failed"},
    originalArgs = {body: {title: "Updated"}, id: "123"},
    payload = {error: "Network error", status: "FETCH_ERROR"},
  }: {
    endpointName?: string;
    error?: Record<string, unknown>;
    originalArgs?: unknown;
    payload?: unknown;
  } = {}
): void => {
  store.dispatch({
    error,
    meta: {
      arg: {
        endpointName,
        originalArgs,
      },
    },
    payload,
    type: "terreno-rtk/executeMutation/rejected",
  });
};

const goOfflineAndQueue = (
  store: TestStore,
  mutation?: Parameters<typeof queueRejectedMutation>[1]
): void => {
  store.dispatch(setOnlineStatus(false));
  queueRejectedMutation(store, mutation);
};

const syncQueuedMutations = async (store: TestStore | SourceStore, ms = 120): Promise<void> => {
  store.dispatch(setOnlineStatus(true));
  await waitForEffects(ms);
};

const getFetchCall = (index = 0): [string, RequestInit] =>
  mockFetch.mock.calls[index] as unknown as [string, RequestInit];

const seedTodosCache = async (
  store: TestStore,
  args: Record<string, unknown> | undefined,
  todos: TodoRecord[]
): Promise<void> => {
  store.dispatch(api.util.upsertQueryData("getTodos", args, {data: todos}));
  await waitForEffects();
};

const seedTodoByIdCache = async (
  store: TestStore,
  id: string,
  todo: TodoRecord & {updated: string}
): Promise<void> => {
  store.dispatch(api.util.upsertQueryData("getTodosById", {id}, {data: todo}));
  await waitForEffects();
};

const getCachedTodos = (
  store: TestStore,
  args: Record<string, unknown> | undefined
): TodoRecord[] =>
  api.endpoints.getTodos.select(args)(store.getState() as unknown as never).data?.data ?? [];

describe("createOfflineMiddleware", () => {
  let store: TestStore;

  beforeEach(() => {
    currentUserId = "test-user";
    store = createTestStore();
    authToken = null;
    mockFetch.mockReset();
    mockFetch.mockImplementation(() => Promise.resolve(createResponse()));
  });

  describe("network monitoring", () => {
    it("responds to explicit online and offline status changes", () => {
      store.dispatch(setOnlineStatus(false));
      expect(selectIsOnline(store.getState())).toBe(false);

      store.dispatch(setOnlineStatus(true));
      expect(selectIsOnline(store.getState())).toBe(true);
    });

    it("marks online again when any API request succeeds", async () => {
      store.dispatch(setOnlineStatus(false));
      mockFetch.mockImplementationOnce(() =>
        Promise.resolve(
          new Response(JSON.stringify({data: []}), {
            headers: {"content-type": "application/json"},
            status: 200,
          })
        )
      );

      const result = await store.dispatch(api.endpoints.getTodos.initiate(undefined));

      expect(result.status).toBe(QueryStatus.fulfilled);
      expect(selectIsOnline(store.getState())).toBe(true);
    });

    it("does not set up web event listeners (web uses useServerStatus)", async () => {
      const addedEvents: string[] = [];
      const globalWithDom = globalThis as unknown as {navigator?: unknown; window?: unknown};
      const originalWindow = globalWithDom.window;

      Object.defineProperty(globalThis, "window", {
        configurable: true,
        value: {
          addEventListener: (event: string) => {
            addedEvents.push(event);
          },
          removeEventListener: () => {},
        },
      });

      try {
        const webStore = createTestStore();
        webStore.dispatch({type: "init-network-monitoring"});
        await waitForEffects();

        expect(addedEvents).not.toContain("online");
        expect(addedEvents).not.toContain("offline");
      } finally {
        Object.defineProperty(globalThis, "window", {
          configurable: true,
          value: originalWindow,
        });
      }
    });
  });

  describe("mutation queueing", () => {
    it("queues a configured mutation when offline and a FETCH_ERROR arrives", () => {
      goOfflineAndQueue(store);

      const queue = selectOfflineQueue(store.getState());
      expect(queue).toHaveLength(1);
      expect(queue[0].endpointName).toBe("patchTodosById");
      expect(queue[0].type).toBe("update");
      expect(queue[0].args).toEqual({body: {title: "Updated"}, id: "123"});
    });

    it("queues mutations on network errors even when the browser reports online", () => {
      store.dispatch(setOnlineStatus(true));
      queueRejectedMutation(store, {
        error: {message: "Failed to fetch", name: "TypeError"},
        payload: {error: "TypeError: Failed to fetch", status: "FETCH_ERROR"},
      });

      expect(selectOfflineQueue(store.getState())).toHaveLength(1);
      expect(selectIsOnline(store.getState())).toBe(false);
    });

    it("does not queue auth-related FETCH_ERROR responses when online", () => {
      queueRejectedMutation(store, {
        error: {message: "No token found for postTodos"},
        payload: {error: "No token found for postTodos", status: "FETCH_ERROR"},
      });

      expect(selectOfflineQueue(store.getState())).toHaveLength(0);
    });

    it("does not queue non-network errors when online", () => {
      queueRejectedMutation(store, {
        error: {message: "Validation error"},
        payload: {data: {message: "Validation error"}, status: 400},
      });

      expect(selectOfflineQueue(store.getState())).toHaveLength(0);
    });

    it("marks offline when a query fails with a network error while online", () => {
      store.dispatch(setOnlineStatus(true));
      store.dispatch({
        error: {message: "Failed to fetch", name: "TypeError"},
        meta: {arg: {endpointName: "getTodos", originalArgs: {}}},
        payload: {error: "TypeError: Failed to fetch", status: "FETCH_ERROR"},
        type: "terreno-rtk/executeQuery/rejected",
      });

      expect(selectIsOnline(store.getState())).toBe(false);
      expect(selectOfflineQueue(store.getState())).toHaveLength(0);
    });

    it("does not queue unconfigured endpoint failures", () => {
      store.dispatch(setOnlineStatus(false));
      queueRejectedMutation(store, {
        endpointName: "someOtherMutation",
        originalArgs: {foo: "bar"},
      });

      expect(selectOfflineQueue(store.getState())).toHaveLength(0);
    });

    it("does not queue non-network errors while offline", () => {
      store.dispatch(setOnlineStatus(false));
      queueRejectedMutation(store, {
        error: {message: "Validation error"},
        payload: {data: {message: "Validation error"}, status: 400},
      });

      expect(selectOfflineQueue(store.getState())).toHaveLength(0);
    });

    it("recognizes fetch, network, and TypeError failure shapes", () => {
      store.dispatch(setOnlineStatus(false));
      queueRejectedMutation(store, {error: {message: "fetch failed"}});
      queueRejectedMutation(store, {error: {message: "network unavailable"}});
      queueRejectedMutation(store, {error: {name: "TypeError"}});

      expect(selectOfflineQueue(store.getState())).toHaveLength(3);
    });

    it("infers create, update, delete, and default update mutation types", () => {
      store.dispatch(setOnlineStatus(false));
      queueRejectedMutation(store, {
        endpointName: "postTodos",
        originalArgs: {body: {title: "New"}},
      });
      queueRejectedMutation(store, {
        endpointName: "patchTodosById",
        originalArgs: {body: {title: "Updated"}, id: "123"},
      });
      queueRejectedMutation(store, {
        endpointName: "deleteTodosById",
        originalArgs: {id: "123"},
      });

      const queue = selectOfflineQueue(store.getState());
      expect(queue.map((mutation) => mutation.type)).toEqual(["create", "update", "delete"]);
    });

    it("defaults configured non-standard mutation names to update", () => {
      const putStore = createTestStore(["putTodos"]);
      putStore.dispatch(setOnlineStatus(false));
      queueRejectedMutation(putStore, {
        endpointName: "putTodos",
        originalArgs: {body: {title: "Put update"}, id: "123"},
      });

      expect(selectOfflineQueue(putStore.getState())[0].type).toBe("update");
    });
  });

  describe("optimistic cache updates", () => {
    it("adds optimistic creates to every active list cache entry", async () => {
      await seedTodosCache(store, {}, [{id: "1", title: "Existing"}]);
      await seedTodosCache(store, {completed: false}, [{id: "2", title: "Filtered"}]);

      goOfflineAndQueue(store, {
        endpointName: "postTodos",
        originalArgs: {body: {completed: false, title: "Offline new"}},
      });

      const allTodos = getCachedTodos(store, {});
      const filteredTodos = getCachedTodos(store, {completed: false});
      expect(allTodos[0]).toMatchObject({completed: false, title: "Offline new"});
      expect(allTodos[0].id).toStartWith("temp-postTodos-");
      expect(filteredTodos[0]).toMatchObject({completed: false, title: "Offline new"});
    });

    it("updates optimistic changes by either id or _id across all list cache entries", async () => {
      await seedTodosCache(store, {}, [
        {_id: "mongo-id", title: "By mongo id"},
        {id: "plain-id", title: "By plain id"},
      ]);

      goOfflineAndQueue(store, {
        originalArgs: {body: {completed: true, title: "Updated mongo"}, id: "mongo-id"},
      });
      queueRejectedMutation(store, {
        originalArgs: {body: {completed: true, title: "Updated plain"}, id: "plain-id"},
      });

      expect(getCachedTodos(store, {})).toEqual([
        {_id: "mongo-id", completed: true, title: "Updated mongo"},
        {completed: true, id: "plain-id", title: "Updated plain"},
      ]);
    });

    it("ignores optimistic updates for missing ids or bodies without changing cached lists", async () => {
      const originalTodos = [{id: "1", title: "Existing"}];
      await seedTodosCache(store, {}, originalTodos);

      store.dispatch(setOnlineStatus(false));
      queueRejectedMutation(store, {originalArgs: {body: {title: "No id"}}});
      queueRejectedMutation(store, {originalArgs: {id: "1"}});

      expect(getCachedTodos(store, {})).toEqual(originalTodos);
    });

    it("removes optimistic deletes from every active list cache entry", async () => {
      await seedTodosCache(store, {}, [
        {id: "1", title: "Keep"},
        {_id: "2", title: "Delete by _id"},
        {id: "3", title: "Delete by id"},
      ]);

      goOfflineAndQueue(store, {
        endpointName: "deleteTodosById",
        originalArgs: {id: "2"},
      });
      queueRejectedMutation(store, {
        endpointName: "deleteTodosById",
        originalArgs: {id: "3"},
      });

      expect(getCachedTodos(store, {})).toEqual([{id: "1", title: "Keep"}]);
    });

    it("ignores rejected mutations without an endpoint name", () => {
      store.dispatch(setOnlineStatus(false));
      store.dispatch({
        error: {message: "fetch failed"},
        meta: {arg: {originalArgs: {id: "123"}}},
        payload: {error: "Network error", status: "FETCH_ERROR"},
        type: "terreno-rtk/executeMutation/rejected",
      });

      expect(selectOfflineQueue(store.getState())).toHaveLength(0);
    });

    it("does not throw when no matching list cache is active", () => {
      expect(() =>
        goOfflineAndQueue(store, {
          endpointName: "postTodos",
          originalArgs: {body: {title: "No cache"}},
        })
      ).not.toThrow();
      expect(selectOfflineQueue(store.getState())).toHaveLength(1);
    });
  });

  describe("sync on reconnect", () => {
    it("replays creates with POST, JSON body, auth header, and no conflict headers", async () => {
      authToken = "auth-token";
      goOfflineAndQueue(store, {
        endpointName: "postTodos",
        originalArgs: {body: {completed: false, title: "Created offline"}},
      });

      await syncQueuedMutations(store);

      const [url, options] = getFetchCall();
      const headers = options.headers as Record<string, string>;
      expect(url).toBe("http://localhost:4000/todos");
      expect(options.method).toBe("POST");
      expect(options.body).toBe(JSON.stringify({completed: false, title: "Created offline"}));
      expect(headers.authorization).toBe("Bearer auth-token");
      expect(headers["If-Unmodified-Since"]).toBeUndefined();
      expect(selectOfflineQueue(store.getState())).toHaveLength(0);
    });

    it("replays updates with PATCH, JSON body, HTTP-date and precise timestamp headers", async () => {
      await seedTodoByIdCache(store, "123", {
        _id: "123",
        title: "Original",
        updated: "2025-06-15T12:00:00.000Z",
      });
      goOfflineAndQueue(store, {
        endpointName: "patchTodosById",
        originalArgs: {body: {title: "Updated offline"}, id: "123"},
      });

      await syncQueuedMutations(store);

      const [url, options] = getFetchCall();
      const headers = options.headers as Record<string, string>;
      expect(url).toBe("http://localhost:4000/todos/123");
      expect(options.method).toBe("PATCH");
      expect(options.body).toBe(JSON.stringify({title: "Updated offline"}));
      expect(headers["If-Unmodified-Since"]).toContain("GMT");
      expect(new Date(headers["X-Unmodified-Since-ISO"]).toISOString()).toBe(
        headers["X-Unmodified-Since-ISO"]
      );
      expect(selectOfflineQueue(store.getState())).toHaveLength(0);
    });

    it("replays deletes with DELETE and handles 204 without parsing JSON", async () => {
      mockFetch.mockImplementationOnce(() => Promise.resolve(createResponse({status: 204})));
      goOfflineAndQueue(store, {
        endpointName: "deleteTodosById",
        originalArgs: {id: "123"},
      });

      await syncQueuedMutations(store);

      const [url, options] = getFetchCall();
      expect(url).toBe("http://localhost:4000/todos/123");
      expect(options.method).toBe("DELETE");
      expect(options.body).toBeUndefined();
      expect(selectOfflineQueue(store.getState())).toHaveLength(0);
    });

    it("does not replay when coming online with an empty queue", async () => {
      store.dispatch(setOnlineStatus(false));
      await syncQueuedMutations(store, 50);

      expect(mockFetch).not.toHaveBeenCalled();
      expect(selectIsSyncing(store.getState())).toBe(false);
    });

    it("does not replay while staying offline", async () => {
      goOfflineAndQueue(store);
      store.dispatch(setOnlineStatus(false));
      await waitForEffects(50);

      expect(mockFetch).not.toHaveBeenCalled();
      expect(selectOfflineQueue(store.getState())).toHaveLength(1);
    });

    it("replays multiple mutations in FIFO order", async () => {
      goOfflineAndQueue(store, {
        endpointName: "postTodos",
        originalArgs: {body: {title: "First"}},
      });
      queueRejectedMutation(store, {
        endpointName: "patchTodosById",
        originalArgs: {body: {completed: true}, id: "456"},
      });
      queueRejectedMutation(store, {
        endpointName: "deleteTodosById",
        originalArgs: {id: "789"},
      });

      await syncQueuedMutations(store);

      expect(
        mockFetch.mock.calls.map((call) =>
          ((call as unknown[])[0] as string).replace(baseUrlForTest, "")
        )
      ).toEqual(["/todos", "/todos/456", "/todos/789"]);
    });

    it("sets syncing during replay and clears it after success", async () => {
      mockFetch.mockImplementationOnce(
        () => new Promise((resolve) => setTimeout(() => resolve(createResponse({status: 200})), 50))
      );
      goOfflineAndQueue(store, {
        endpointName: "postTodos",
        originalArgs: {body: {title: "New"}},
      });

      store.dispatch(setOnlineStatus(true));
      await waitForEffects(10);
      expect(selectIsSyncing(store.getState())).toBe(true);

      await waitForEffects(100);
      expect(selectIsSyncing(store.getState())).toBe(false);
    });

    it("creates a conflict record from wrapped 409 server data and dequeues the mutation", async () => {
      mockFetch.mockImplementationOnce(() =>
        Promise.resolve(
          createResponse({
            data: {
              data: {_id: "123", completed: false, title: "Remote version"},
              error: "Conflict",
              message: "Document was modified since your last read",
            },
            status: 409,
          })
        )
      );
      goOfflineAndQueue(store, {
        originalArgs: {body: {completed: true}, id: "123"},
      });

      await syncQueuedMutations(store);

      const conflicts = selectConflicts(store.getState());
      expect(conflicts).toHaveLength(1);
      expect(conflicts[0]).toMatchObject({
        args: {body: {completed: true}, id: "123"},
        dismissed: false,
        endpointName: "patchTodosById",
        serverDocument: {_id: "123", completed: false, title: "Remote version"},
      });
      expect(selectOfflineQueue(store.getState())).toHaveLength(0);
    });

    it("creates a conflict record from raw 409 data when the server does not wrap data", async () => {
      mockFetch.mockImplementationOnce(() =>
        Promise.resolve(createResponse({data: {_id: "123", title: "Raw remote"}, status: 409}))
      );
      goOfflineAndQueue(store);

      await syncQueuedMutations(store);

      expect(selectConflicts(store.getState())[0].serverDocument).toEqual({
        _id: "123",
        title: "Raw remote",
      });
      expect(selectOfflineQueue(store.getState())).toHaveLength(0);
    });

    it("continues replaying after a conflict so later local changes still sync", async () => {
      mockFetch
        .mockImplementationOnce(() =>
          Promise.resolve(createResponse({data: {data: {_id: "1", title: "Remote"}}, status: 409}))
        )
        .mockImplementationOnce(() => Promise.resolve(createResponse()));
      goOfflineAndQueue(store, {
        originalArgs: {body: {title: "Conflicting local"}, id: "1"},
      });
      queueRejectedMutation(store, {
        originalArgs: {body: {title: "Later local"}, id: "2"},
      });

      await syncQueuedMutations(store);

      expect(mockFetch).toHaveBeenCalledTimes(2);
      expect(selectConflicts(store.getState())).toHaveLength(1);
      expect(selectOfflineQueue(store.getState())).toHaveLength(0);
    });

    it("dequeues permanent non-conflict 4xx failures to avoid infinite retry loops", async () => {
      mockFetch.mockImplementationOnce(() =>
        Promise.resolve(createResponse({data: {message: "Forbidden"}, status: 403}))
      );
      goOfflineAndQueue(store);

      await syncQueuedMutations(store);

      expect(selectConflicts(store.getState())).toHaveLength(0);
      expect(selectOfflineQueue(store.getState())).toHaveLength(0);
    });

    it("leaves 5xx failures queued for a future reconnect", async () => {
      mockFetch.mockImplementationOnce(() =>
        Promise.resolve(createResponse({data: {message: "Server error"}, status: 500}))
      );
      goOfflineAndQueue(store);

      await syncQueuedMutations(store);

      expect(selectOfflineQueue(store.getState())).toHaveLength(1);
      expect(selectIsSyncing(store.getState())).toBe(false);
    });

    it("stops replay after a thrown network error and preserves later mutations", async () => {
      mockFetch
        .mockImplementationOnce(() => Promise.reject(new Error("network down")))
        .mockImplementationOnce(() => Promise.resolve(createResponse()));
      goOfflineAndQueue(store, {
        originalArgs: {body: {title: "First"}, id: "1"},
      });
      queueRejectedMutation(store, {
        originalArgs: {body: {title: "Second"}, id: "2"},
      });

      await syncQueuedMutations(store);

      expect(mockFetch).toHaveBeenCalledTimes(1);
      expect(selectOfflineQueue(store.getState()).map((mutation) => mutation.args)).toEqual([
        {body: {title: "First"}, id: "1"},
        {body: {title: "Second"}, id: "2"},
      ]);
      expect(selectIsSyncing(store.getState())).toBe(false);
    });

    it("retries preserved mutations on a later online event after a transient failure", async () => {
      mockFetch
        .mockImplementationOnce(() => Promise.reject(new Error("network down")))
        .mockImplementation(() => Promise.resolve(createResponse()));
      goOfflineAndQueue(store);

      await syncQueuedMutations(store);
      expect(selectOfflineQueue(store.getState())).toHaveLength(1);

      store.dispatch(setOnlineStatus(false));
      await syncQueuedMutations(store);

      expect(mockFetch).toHaveBeenCalledTimes(2);
      expect(selectOfflineQueue(store.getState())).toHaveLength(0);
    });

    it("does not start concurrent replay for repeated online events", async () => {
      mockFetch.mockImplementationOnce(
        () => new Promise((resolve) => setTimeout(() => resolve(createResponse({status: 200})), 50))
      );
      goOfflineAndQueue(store);

      store.dispatch(setOnlineStatus(true));
      store.dispatch(setOnlineStatus(true));
      store.dispatch(setOnlineStatus(true));
      await waitForEffects(120);

      expect(mockFetch).toHaveBeenCalledTimes(1);
      expect(selectOfflineQueue(store.getState())).toHaveLength(0);
    });

    it("drops queued mutations owned by a different user instead of replaying them", async () => {
      goOfflineAndQueue(store);
      store.dispatch({type: SET_USER_ACTION_TYPE, userId: "someone-else"});

      await syncQueuedMutations(store);

      expect(mockFetch).not.toHaveBeenCalled();
      expect(selectOfflineQueue(store.getState())).toHaveLength(0);
      expect(selectIsSyncing(store.getState())).toBe(false);
    });

    it("resets a stuck syncing flag when coming online with an empty queue", async () => {
      store.dispatch(setOnlineStatus(false));
      store.dispatch(setSyncing(true));

      await syncQueuedMutations(store);

      expect(mockFetch).not.toHaveBeenCalled();
      expect(selectIsSyncing(store.getState())).toBe(false);
    });

    it("removes optimistic temp items from list caches after a create is replayed", async () => {
      await seedTodosCache(store, {}, [{id: "1", title: "Existing"}]);
      goOfflineAndQueue(store, {
        endpointName: "postTodos",
        originalArgs: {body: {title: "Offline new"}},
      });
      expect(getCachedTodos(store, {})).toHaveLength(2);

      await syncQueuedMutations(store);

      expect(getCachedTodos(store, {})).toEqual([{id: "1", title: "Existing"}]);
    });

    it("removes temp items for creates that end in a conflict or permanent failure", async () => {
      await seedTodosCache(store, {}, []);
      mockFetch.mockImplementationOnce(() =>
        Promise.resolve(createResponse({data: {data: {_id: "remote"}}, status: 409}))
      );
      mockFetch.mockImplementationOnce(() => Promise.resolve(createResponse({status: 422})));
      goOfflineAndQueue(store, {
        endpointName: "postTodos",
        originalArgs: {body: {title: "Conflicting"}},
      });
      queueRejectedMutation(store, {
        endpointName: "postTodos",
        originalArgs: {body: {title: "Invalid"}},
      });
      expect(getCachedTodos(store, {})).toHaveLength(2);

      await syncQueuedMutations(store);

      expect(mockFetch).toHaveBeenCalledTimes(2);
      expect(selectConflicts(store.getState())).toHaveLength(1);
      expect(selectOfflineQueue(store.getState())).toHaveLength(0);
      expect(getCachedTodos(store, {})).toEqual([]);
    });

    it("handles response JSON parse failures like transient replay failures", async () => {
      mockFetch.mockImplementationOnce(() =>
        Promise.resolve({
          json: () => Promise.reject(new Error("invalid json")),
          status: 502,
        })
      );
      goOfflineAndQueue(store);

      await syncQueuedMutations(store);

      expect(selectOfflineQueue(store.getState())).toHaveLength(1);
      expect(selectIsSyncing(store.getState())).toBe(false);
    });
  });

  describe("conflict base timestamps", () => {
    it("prefers the patch body _updatedAt over cached documents", async () => {
      await seedTodoByIdCache(store, "123", {
        _id: "123",
        title: "Original",
        updated: "2025-06-15T12:00:00.000Z",
      });
      goOfflineAndQueue(store, {
        originalArgs: {body: {_updatedAt: "2025-01-01T00:00:00.000Z", title: "Body"}, id: "123"},
      });

      await syncQueuedMutations(store);

      const [, options] = getFetchCall();
      const headers = options.headers as Record<string, string>;
      expect(headers["X-Unmodified-Since-ISO"]).toBe("2025-01-01T00:00:00.000Z");
    });

    it("falls back to the list cache updated string when no get-by-id entry exists", async () => {
      await seedTodosCache(store, {}, [
        {_id: "123", title: "Listed", updated: "2025-03-03T03:03:03.000Z"},
      ]);
      goOfflineAndQueue(store, {originalArgs: {body: {title: "Patched"}, id: "123"}});

      await syncQueuedMutations(store);

      const [, options] = getFetchCall();
      const headers = options.headers as Record<string, string>;
      expect(headers["X-Unmodified-Since-ISO"]).toBe("2025-03-03T03:03:03.000Z");
    });

    it("ignores get-by-id cache entries without a string updated value", async () => {
      store.dispatch(
        api.util.upsertQueryData(
          "getTodosById",
          {id: "123"},
          {
            data: {_id: "123", title: "No timestamp"},
          }
        )
      );
      await waitForEffects();
      goOfflineAndQueue(store, {originalArgs: {body: {title: "Patched"}, id: "123"}});

      await syncQueuedMutations(store);

      const [, options] = getFetchCall();
      const headers = options.headers as Record<string, string>;
      expect(headers["X-Unmodified-Since-ISO"]).toBeUndefined();
    });

    it("converts a list cache Date updated value to ISO", async () => {
      const updated = new Date("2025-04-04T04:04:04.000Z");
      await seedTodosCache(store, {}, [{id: "123", title: "Listed", updated}]);
      goOfflineAndQueue(store, {originalArgs: {body: {title: "Patched"}, id: "123"}});

      await syncQueuedMutations(store);

      const [, options] = getFetchCall();
      const headers = options.headers as Record<string, string>;
      expect(new Date(headers["X-Unmodified-Since-ISO"]).toISOString()).toBe(updated.toISOString());
    });
  });

  describe("logout and rehydrate", () => {
    it("clears the queue and conflicts on logout", async () => {
      mockFetch.mockImplementationOnce(() =>
        Promise.resolve(createResponse({data: {_id: "123"}, status: 409}))
      );
      goOfflineAndQueue(store);
      await syncQueuedMutations(store);
      goOfflineAndQueue(store);
      expect(selectConflicts(store.getState())).toHaveLength(1);
      expect(selectOfflineQueue(store.getState())).toHaveLength(1);

      store.dispatch({type: "auth/logout"});

      expect(selectConflicts(store.getState())).toHaveLength(0);
      expect(selectOfflineQueue(store.getState())).toHaveLength(0);
    });

    it("replays a persisted queue on the first rehydrate when already online", async () => {
      store.dispatch(enqueue(persistedMutation("first")));
      store.dispatch(setSyncing(true));
      expect(selectIsOnline(store.getState())).toBe(true);

      store.dispatch({type: "persist/REHYDRATE"});
      await waitForEffects(120);

      expect(mockFetch).toHaveBeenCalledTimes(1);
      expect(selectOfflineQueue(store.getState())).toHaveLength(0);
      expect(selectIsSyncing(store.getState())).toBe(false);

      store.dispatch(enqueue(persistedMutation("second")));
      store.dispatch({type: "persist/REHYDRATE"});
      await waitForEffects(120);

      expect(mockFetch).toHaveBeenCalledTimes(1);
      expect(selectOfflineQueue(store.getState())).toHaveLength(1);
    });

    it("only resets a stuck syncing flag on rehydrate when the queue is empty", async () => {
      store.dispatch(setSyncing(true));

      store.dispatch({type: "persist/REHYDRATE"});
      await waitForEffects();

      expect(mockFetch).not.toHaveBeenCalled();
      expect(selectIsSyncing(store.getState())).toBe(false);
    });
  });
});

describe("offline middleware helpers", () => {
  it("isNetworkFetchError inspects string errors and FETCH_ERROR payloads", () => {
    expect(isNetworkFetchError({error: "Network Error"})).toBe(true);
    expect(isNetworkFetchError({error: "load failed", status: "FETCH_ERROR"})).toBe(true);
    expect(isNetworkFetchError({payload: {error: "fetch failed"}})).toBe(true);
    expect(isNetworkFetchError({error: "No token found"})).toBe(false);
    expect(isNetworkFetchError(null)).toBe(false);
  });

  it("shouldReplayQueuedMutation rejects missing users and legacy entries", () => {
    const owned = persistedMutation("owned");
    const legacy: QueuedMutation = {...owned, userId: undefined};
    expect(shouldReplayQueuedMutation(owned, undefined)).toBe(false);
    expect(shouldReplayQueuedMutation(legacy, "test-user")).toBe(false);
    expect(shouldReplayQueuedMutation(owned, "test-user")).toBe(true);
    expect(shouldReplayQueuedMutation(owned, "someone-else")).toBe(false);
  });
});

const baseUrlForTest = "http://localhost:4000";

interface FakeTokenSource extends AuthProvider {
  authListenerCount: () => number;
  emitAuthChange: () => void;
  token: string | null;
  userId: string | null;
}

const makeTokenSource = ({
  token,
  userId,
}: {
  token: string | null;
  userId: string | null;
}): FakeTokenSource => {
  const listeners = new Set<() => void>();
  const source: FakeTokenSource = {
    authListenerCount: (): number => listeners.size,
    emitAuthChange: (): void => {
      for (const listener of listeners) {
        listener();
      }
    },
    getToken: mock(async (): Promise<string | null> => source.token),
    getUserId: mock(async (): Promise<string | null> => source.userId),
    onAuthChange: (callback: () => void): (() => void) => {
      listeners.add(callback);
      return (): void => {
        listeners.delete(callback);
      };
    },
    token,
    userId,
  };
  return source;
};

// A Better Auth app has no `auth` slice: the store holds only the API and offline reducers.
const createSourceStore = (tokenSource?: AuthProvider) => {
  const offline = createOfflineMiddleware({
    api: api as unknown as Parameters<typeof createOfflineMiddleware>[0]["api"],
    endpoints: ["postTodos", "patchTodosById", "deleteTodosById"],
    tokenSource,
  });

  // Stands in for redux-persist: REHYDRATE replaces the offline slice with the persisted one.
  const persistedOfflineReducer = (
    state: ReturnType<typeof offline.offlineReducer> | undefined,
    action: {type: string; payload?: {offline?: Partial<ReturnType<typeof offline.offlineReducer>>}}
  ): ReturnType<typeof offline.offlineReducer> => {
    const next = offline.offlineReducer(state, action);
    if (action.type === "persist/REHYDRATE" && action.payload?.offline) {
      return {...next, ...action.payload.offline};
    }
    return next;
  };

  return configureStore({
    middleware: (getDefault) =>
      getDefault({serializableCheck: false}).concat(api.middleware, offline.middleware),
    reducer: {
      [api.reducerPath]: api.reducer,
      offline: persistedOfflineReducer,
    },
  });
};

type SourceStore = ReturnType<typeof createSourceStore>;

const queueSourceMutation = (store: SourceStore, title: string): void => {
  store.dispatch({
    error: {message: "fetch failed"},
    meta: {arg: {endpointName: "postTodos", originalArgs: {body: {title}}}},
    payload: {error: "Network error", status: "FETCH_ERROR"},
    type: "terreno-rtk/executeMutation/rejected",
  });
};

// Any action primes the middleware's cached user id from the source.
const primeSourceStore = async (store: SourceStore): Promise<void> => {
  store.dispatch({type: "test/prime"});
  await waitForEffects();
};

// Holds every getUserId() read (each returns the user id at call time) until open() is called;
// reads made after that settle immediately.
const gateUserIdReads = (source: FakeTokenSource): {open: () => void} => {
  const pending: (() => void)[] = [];
  let isOpen = false;
  source.getUserId = mock((): Promise<string | null> => {
    const userId = source.userId;
    if (isOpen) {
      return Promise.resolve(userId);
    }
    return new Promise((resolve) => {
      pending.push(() => resolve(userId));
    });
  });
  return {
    open: (): void => {
      isOpen = true;
      for (const release of pending.splice(0)) {
        release();
      }
    },
  };
};

const rehydrateOffline = (
  store: SourceStore,
  offline: {isOnline: boolean; lastUserId?: string; queue?: QueuedMutation[]}
): void => {
  store.dispatch({
    payload: {offline: {conflicts: [], isSyncing: false, queue: [], ...offline}},
    type: "persist/REHYDRATE",
  });
};

const replayedAuthorizations = (): (string | undefined)[] =>
  mockFetch.mock.calls.map(
    (call) =>
      ((call as unknown[])[1] as RequestInit & {headers: Record<string, string>}).headers
        .authorization
  );

const replayedTitles = (): unknown[] =>
  mockFetch.mock.calls.map(
    (call) => JSON.parse(((call as unknown[])[1] as RequestInit).body as string).title
  );

describe("createOfflineMiddleware with a token source", () => {
  beforeEach(() => {
    authToken = null;
    setTokenSource(undefined);
    mockFetch.mockReset();
    mockFetch.mockImplementation(() => Promise.resolve(createResponse()));
  });

  afterEach(() => {
    setTokenSource(undefined);
  });

  it("queues an offline mutation under the registered source's user and replays it with its token", async () => {
    const store = createSourceStore();
    const source = makeTokenSource({token: "ba-token", userId: "ba-user"});
    setTokenSource(source);
    await primeSourceStore(store);

    store.dispatch(setOnlineStatus(false));
    queueSourceMutation(store, "Offline create");

    const queue = selectOfflineQueue(store.getState());
    expect(queue).toHaveLength(1);
    expect(queue[0].userId).toBe("ba-user");

    await syncQueuedMutations(store);

    expect(mockFetch).toHaveBeenCalledTimes(1);
    const [url, options] = getFetchCall();
    expect(url).toBe("http://localhost:4000/todos");
    expect((options.headers as Record<string, string>).authorization).toBe("Bearer ba-token");
    expect(selectOfflineQueue(store.getState())).toHaveLength(0);
  });

  it("tags offline mutations with the last known user when the source cannot read it offline", async () => {
    const source = makeTokenSource({token: "ba-token", userId: "ba-user"});
    setTokenSource(source);
    const store = createSourceStore();
    await primeSourceStore(store);

    // A Better Auth session read fails while offline and degrades to null.
    source.userId = null;
    store.dispatch(setOnlineStatus(false));
    queueSourceMutation(store, "Offline create");

    expect(selectOfflineQueue(store.getState())[0].userId).toBe("ba-user");
  });

  it("does not replay another user's queued mutations after a user switch", async () => {
    const source = makeTokenSource({token: "a-token", userId: "user-a"});
    setTokenSource(source);
    const store = createSourceStore();
    await primeSourceStore(store);

    store.dispatch(setOnlineStatus(false));
    queueSourceMutation(store, "Written by A");

    source.token = "b-token";
    source.userId = "user-b";
    source.emitAuthChange();
    await waitForEffects();
    queueSourceMutation(store, "Written by B");

    expect(selectOfflineQueue(store.getState()).map((m) => m.userId)).toEqual(["user-a", "user-b"]);

    await syncQueuedMutations(store);

    expect(replayedTitles()).toEqual(["Written by B"]);
    expect(replayedAuthorizations()).toEqual(["Bearer b-token"]);
    expect(selectOfflineQueue(store.getState())).toHaveLength(0);
  });

  it("replays without an authorization header when the source has no token", async () => {
    const source = makeTokenSource({token: null, userId: "ba-user"});
    setTokenSource(source);
    const store = createSourceStore();
    await primeSourceStore(store);

    store.dispatch(setOnlineStatus(false));
    queueSourceMutation(store, "Offline create");
    await syncQueuedMutations(store);

    expect(mockFetch).toHaveBeenCalledTimes(1);
    expect(replayedAuthorizations()).toEqual([undefined]);
  });

  it("keeps the queue and replays nothing when the source has no user on reconnect", async () => {
    const source = makeTokenSource({token: "ba-token", userId: "ba-user"});
    setTokenSource(source);
    const store = createSourceStore();
    await primeSourceStore(store);

    store.dispatch(setOnlineStatus(false));
    queueSourceMutation(store, "Offline create");
    source.userId = null;
    store.dispatch(setSyncing(true));
    await syncQueuedMutations(store);

    expect(mockFetch).not.toHaveBeenCalled();
    expect(selectOfflineQueue(store.getState())).toHaveLength(1);
    expect(selectIsSyncing(store.getState())).toBe(false);

    // The same user signing back in replays it on the next reconnect.
    source.userId = "ba-user";
    store.dispatch(setOnlineStatus(false));
    await syncQueuedMutations(store);

    expect(replayedTitles()).toEqual(["Offline create"]);
  });

  it("prefers the tokenSource option over the registered source", async () => {
    setTokenSource(makeTokenSource({token: "registered-token", userId: "registered-user"}));
    const option = makeTokenSource({token: "option-token", userId: "option-user"});
    const store = createSourceStore(option);
    await primeSourceStore(store);

    store.dispatch(setOnlineStatus(false));
    queueSourceMutation(store, "Offline create");
    expect(selectOfflineQueue(store.getState())[0].userId).toBe("option-user");

    await syncQueuedMutations(store);

    expect(replayedAuthorizations()).toEqual(["Bearer option-token"]);
  });

  it("keeps queue order while the first user id read is still in flight", async () => {
    const source = makeTokenSource({token: "ba-token", userId: "ba-user"});
    let releaseUserId: () => void = () => {};
    const userIdGate = new Promise<void>((resolve) => {
      releaseUserId = resolve;
    });
    source.getUserId = mock(async (): Promise<string | null> => {
      await userIdGate;
      return source.userId;
    });
    setTokenSource(source);
    const store = createSourceStore();

    store.dispatch(setOnlineStatus(false));
    queueSourceMutation(store, "First");
    queueSourceMutation(store, "Second");
    expect(selectOfflineQueue(store.getState())).toHaveLength(0);

    releaseUserId();
    await waitForEffects();
    queueSourceMutation(store, "Third");

    const queue = selectOfflineQueue(store.getState());
    expect(queue.map((m) => (m.args as {body: {title: string}}).body.title)).toEqual([
      "First",
      "Second",
      "Third",
    ]);
    expect(queue.every((m) => m.userId === "ba-user")).toBe(true);
  });

  it("includes mutations still waiting for a user id in a reconnect replay", async () => {
    const source = makeTokenSource({token: "ba-token", userId: "ba-user"});
    let releaseUserId: () => void = () => {};
    const userIdGate = new Promise<void>((resolve) => {
      releaseUserId = resolve;
    });
    source.getUserId = mock(async (): Promise<string | null> => {
      await userIdGate;
      return source.userId;
    });
    setTokenSource(source);
    const store = createSourceStore();

    store.dispatch(setOnlineStatus(false));
    queueSourceMutation(store, "Pending create");
    store.dispatch(setOnlineStatus(true));
    releaseUserId();
    await waitForEffects(120);

    expect(replayedTitles()).toEqual(["Pending create"]);
    expect(selectOfflineQueue(store.getState())).toHaveLength(0);
  });

  it("uses the newest user id when an auth change overtakes an earlier read", async () => {
    const source = makeTokenSource({token: "a-token", userId: "user-a"});
    const releases: (() => void)[] = [];
    source.getUserId = mock((): Promise<string | null> => {
      const userId = source.userId;
      return new Promise((resolve) => {
        releases.push(() => resolve(userId));
      });
    });
    setTokenSource(source);
    const store = createSourceStore();
    await primeSourceStore(store);

    source.userId = "user-b";
    source.emitAuthChange();
    // The newer read settles first; the stale read for user A must not overwrite it.
    releases[1]();
    await waitForEffects();
    releases[0]();
    await waitForEffects();

    store.dispatch(setOnlineStatus(false));
    queueSourceMutation(store, "Offline create");

    expect(selectOfflineQueue(store.getState())[0].userId).toBe("user-b");
  });

  it("queues without a user and drops the mutation on reconnect when the user id read throws", async () => {
    const source = makeTokenSource({token: "ba-token", userId: "ba-user"});
    source.getUserId = mock(async (): Promise<string | null> => {
      throw new Error("session read failed");
    });
    setTokenSource(source);
    const store = createSourceStore();
    await primeSourceStore(store);

    store.dispatch(setOnlineStatus(false));
    queueSourceMutation(store, "Offline create");
    expect(selectOfflineQueue(store.getState())[0].userId).toBeUndefined();

    source.getUserId = mock(async (): Promise<string | null> => "ba-user");
    await syncQueuedMutations(store);

    expect(mockFetch).not.toHaveBeenCalled();
    expect(selectOfflineQueue(store.getState())).toHaveLength(0);
  });

  it("drops mutations from an offline launch when no user id was ever persisted", async () => {
    // A Better Auth session read fails while offline, so an app launched offline has no user yet.
    const source = makeTokenSource({token: "ba-token", userId: null});
    setTokenSource(source);
    const store = createSourceStore();
    await primeSourceStore(store);

    store.dispatch(setOnlineStatus(false));
    queueSourceMutation(store, "Offline create");
    source.userId = "ba-user";
    await syncQueuedMutations(store);

    expect(mockFetch).not.toHaveBeenCalled();
    expect(selectOfflineQueue(store.getState())).toHaveLength(0);
  });

  it("does not replay with a new user's token when the user switches during the reconnect read", async () => {
    const source = makeTokenSource({token: "a-token", userId: "user-a"});
    const releases: (() => void)[] = [];
    source.getUserId = mock((): Promise<string | null> => {
      const userId = source.userId;
      return new Promise((resolve) => {
        releases.push(() => resolve(userId));
      });
    });
    setTokenSource(source);
    const store = createSourceStore();
    await primeSourceStore(store);
    releases[0]();
    await waitForEffects();

    store.dispatch(setOnlineStatus(false));
    queueSourceMutation(store, "Written by A");
    store.dispatch(setOnlineStatus(true));
    await waitForEffects();

    source.token = "b-token";
    source.userId = "user-b";
    source.emitAuthChange();
    // The reconnect read started for user A settles after the switch to user B.
    releases[1]();
    releases[2]();
    await waitForEffects(120);

    expect(mockFetch).not.toHaveBeenCalled();
    expect(selectOfflineQueue(store.getState()).map((m) => m.userId)).toEqual(["user-a"]);
  });

  it("stops a replay when the user switches partway through it", async () => {
    const source = makeTokenSource({token: "a-token", userId: "user-a"});
    setTokenSource(source);
    const store = createSourceStore();
    await primeSourceStore(store);

    store.dispatch(setOnlineStatus(false));
    queueSourceMutation(store, "First by A");
    queueSourceMutation(store, "Second by A");
    mockFetch.mockImplementationOnce(() => {
      source.token = "b-token";
      source.userId = "user-b";
      source.emitAuthChange();
      return Promise.resolve(createResponse());
    });

    await syncQueuedMutations(store);

    expect(replayedTitles()).toEqual(["First by A"]);
    expect(replayedAuthorizations()).toEqual(["Bearer a-token"]);
    expect(
      selectOfflineQueue(store.getState()).map(
        (m) => (m.args as {body: {title: string}}).body.title
      )
    ).toEqual(["Second by A"]);
  });

  it("tags no user on a mutation that fails while a user switch is being read", async () => {
    const source = makeTokenSource({token: "a-token", userId: "user-a"});
    const releases: (() => void)[] = [];
    source.getUserId = mock((): Promise<string | null> => {
      const userId = source.userId;
      return new Promise((resolve) => {
        releases.push(() => resolve(userId));
      });
    });
    setTokenSource(source);
    const store = createSourceStore();
    await primeSourceStore(store);
    releases[0]();
    await waitForEffects();

    source.token = "b-token";
    source.userId = "user-b";
    source.emitAuthChange();
    store.dispatch(setOnlineStatus(false));
    queueSourceMutation(store, "Failed during the switch");
    releases[1]();
    await waitForEffects();

    expect(selectOfflineQueue(store.getState())[0].userId).toBeUndefined();
  });

  it("tags no user after a sign-out, even when a reconnect read overtakes the sign-out read", async () => {
    const source = makeTokenSource({token: "a-token", userId: "user-a"});
    const releases: (() => void)[] = [];
    source.getUserId = mock((): Promise<string | null> => {
      const userId = source.userId;
      return new Promise((resolve) => {
        releases.push(() => resolve(userId));
      });
    });
    setTokenSource(source);
    const store = createSourceStore();
    await primeSourceStore(store);
    releases[0]();
    await waitForEffects();

    source.token = null;
    source.userId = null;
    source.emitAuthChange();
    store.dispatch(setOnlineStatus(false));
    store.dispatch(setOnlineStatus(true));
    await waitForEffects();
    // The reconnect read (null) settles first; the superseded sign-out read is ignored.
    releases[2]();
    await waitForEffects();
    releases[1]();
    await waitForEffects();

    store.dispatch(setOnlineStatus(false));
    queueSourceMutation(store, "After sign-out");

    expect(selectOfflineQueue(store.getState())[0].userId).toBeUndefined();
  });

  it("tags mutations after an offline launch with the persisted user and replays them as that user", async () => {
    // Offline, a Better Auth session read fails and the adapter reports no user.
    const source = makeTokenSource({token: "a-token", userId: null});
    setTokenSource(source);
    const store = createSourceStore();
    await primeSourceStore(store);
    rehydrateOffline(store, {isOnline: false, lastUserId: "user-a"});
    await waitForEffects();

    queueSourceMutation(store, "Offline launch create");
    expect(selectOfflineQueue(store.getState())[0].userId).toBe("user-a");

    source.userId = "user-a";
    await syncQueuedMutations(store);

    expect(replayedTitles()).toEqual(["Offline launch create"]);
    expect(replayedAuthorizations()).toEqual(["Bearer a-token"]);
    expect(selectOfflineQueue(store.getState())).toHaveLength(0);
  });

  it("does not send an offline-launch mutation when another user is signed in on reconnect", async () => {
    const source = makeTokenSource({token: "a-token", userId: null});
    setTokenSource(source);
    const store = createSourceStore();
    await primeSourceStore(store);
    rehydrateOffline(store, {isOnline: false, lastUserId: "user-a"});
    await waitForEffects();

    queueSourceMutation(store, "Written by A");
    source.token = "b-token";
    source.userId = "user-b";
    await syncQueuedMutations(store);

    expect(mockFetch).not.toHaveBeenCalled();
    expect(selectOfflineQueue(store.getState())).toHaveLength(0);
    expect(selectLastUserId(store.getState())).toBe("user-b");
  });

  it("clears the persisted user id on logout and on sign-out", async () => {
    const source = makeTokenSource({token: "a-token", userId: "user-a"});
    setTokenSource(source);
    const store = createSourceStore();
    await primeSourceStore(store);
    expect(selectLastUserId(store.getState())).toBe("user-a");

    store.dispatch({type: "auth/logout"});
    expect(selectLastUserId(store.getState())).toBeUndefined();

    store.dispatch(setOnlineStatus(false));
    store.dispatch(setOnlineStatus(true));
    await waitForEffects();
    expect(selectLastUserId(store.getState())).toBe("user-a");

    source.token = null;
    source.userId = null;
    source.emitAuthChange();
    await waitForEffects();
    expect(selectLastUserId(store.getState())).toBeUndefined();
  });

  it("tags no user when the user switches after a failure made before any user id was known", async () => {
    const source = makeTokenSource({token: "a-token", userId: "user-a"});
    const gate = gateUserIdReads(source);
    setTokenSource(source);
    const store = createSourceStore();
    await primeSourceStore(store);

    store.dispatch(setOnlineStatus(false));
    queueSourceMutation(store, "Written by A");
    source.token = "b-token";
    source.userId = "user-b";
    source.emitAuthChange();
    gate.open();
    await waitForEffects();

    expect(selectOfflineQueue(store.getState()).map((m) => m.userId)).toEqual([undefined]);

    await syncQueuedMutations(store);

    expect(mockFetch).not.toHaveBeenCalled();
  });

  it("tags no user when a sign-out and a new sign-in follow a failure before any user id was known", async () => {
    const source = makeTokenSource({token: "a-token", userId: "user-a"});
    const gate = gateUserIdReads(source);
    setTokenSource(source);
    const store = createSourceStore();
    await primeSourceStore(store);

    store.dispatch(setOnlineStatus(false));
    queueSourceMutation(store, "Written by A");
    source.token = null;
    source.userId = null;
    source.emitAuthChange();
    source.token = "b-token";
    source.userId = "user-b";
    source.emitAuthChange();
    gate.open();
    await waitForEffects();

    expect(selectOfflineQueue(store.getState()).map((m) => m.userId)).toEqual([undefined]);

    await syncQueuedMutations(store);

    expect(mockFetch).not.toHaveBeenCalled();
  });

  it("does not queue a mutation still waiting on a user id read once the user logs out", async () => {
    const source = makeTokenSource({token: "a-token", userId: "user-a"});
    const gate = gateUserIdReads(source);
    setTokenSource(source);
    const store = createSourceStore();
    await primeSourceStore(store);

    store.dispatch(setOnlineStatus(false));
    queueSourceMutation(store, "Written by A");
    store.dispatch({type: "auth/logout"});
    gate.open();
    await waitForEffects();

    expect(selectOfflineQueue(store.getState())).toHaveLength(0);

    // A signing back in must not replay the write made before the logout.
    await syncQueuedMutations(store);

    expect(mockFetch).not.toHaveBeenCalled();
  });

  it("stops a replay when the user logs out partway through it", async () => {
    const source = makeTokenSource({token: "a-token", userId: "user-a"});
    setTokenSource(source);
    const store = createSourceStore();
    await primeSourceStore(store);

    store.dispatch(setOnlineStatus(false));
    queueSourceMutation(store, "First by A");
    queueSourceMutation(store, "Second by A");
    mockFetch.mockImplementationOnce(() => {
      store.dispatch({type: "auth/logout"});
      return Promise.resolve(createResponse());
    });

    await syncQueuedMutations(store);

    expect(replayedTitles()).toEqual(["First by A"]);
    expect(selectOfflineQueue(store.getState())).toHaveLength(0);
  });

  it("never replays an offline-launch mutation tagged with a stale persisted user into that user's account", async () => {
    // A is signed in, but the persisted id is B (a lost write); offline, reads report no user.
    const source = makeTokenSource({token: "a-token", userId: null});
    setTokenSource(source);
    const store = createSourceStore();
    await primeSourceStore(store);
    rehydrateOffline(store, {isOnline: false, lastUserId: "user-b"});
    await waitForEffects();

    queueSourceMutation(store, "By A");
    expect(selectOfflineQueue(store.getState())[0]).toMatchObject({
      userId: "user-b",
      userIdConfirmed: false,
    });

    // A signs out, B signs in, and the device reconnects.
    source.emitAuthChange();
    await waitForEffects();
    source.token = "b-token";
    source.userId = "user-b";
    source.emitAuthChange();
    await waitForEffects();
    await syncQueuedMutations(store);

    expect(mockFetch).not.toHaveBeenCalled();
    expect(selectOfflineQueue(store.getState())).toHaveLength(0);
  });

  it("confirms offline-launch mutations when the reconnect read matches their user with no auth change", async () => {
    const source = makeTokenSource({token: "a-token", userId: null});
    setTokenSource(source);
    const store = createSourceStore();
    await primeSourceStore(store);
    rehydrateOffline(store, {isOnline: false, lastUserId: "user-a"});
    await waitForEffects();
    queueSourceMutation(store, "Offline launch create");
    expect(selectOfflineQueue(store.getState())[0].userIdConfirmed).toBe(false);

    source.userId = "user-a";
    await syncQueuedMutations(store);

    expect(replayedTitles()).toEqual(["Offline launch create"]);
    expect(replayedAuthorizations()).toEqual(["Bearer a-token"]);

    store.dispatch(setOnlineStatus(false));
    queueSourceMutation(store, "After confirmation");
    expect(selectOfflineQueue(store.getState())[0].userIdConfirmed).toBeUndefined();
  });

  it("drops offline-launch mutations when the reconnect read names another user", async () => {
    const source = makeTokenSource({token: "a-token", userId: null});
    setTokenSource(source);
    const store = createSourceStore();
    await primeSourceStore(store);
    rehydrateOffline(store, {isOnline: false, lastUserId: "user-b"});
    await waitForEffects();
    queueSourceMutation(store, "By A");

    source.userId = "user-a";
    await syncQueuedMutations(store);

    expect(mockFetch).not.toHaveBeenCalled();
    expect(selectOfflineQueue(store.getState())).toHaveLength(0);
    expect(selectLastUserId(store.getState())).toBe("user-a");
  });

  it("drops an unconfirmed mutation when a new sign-in's read settles before the sign-out's read", async () => {
    // P7b: the persisted id is B while A is signed in; A writes offline.
    const source = makeTokenSource({token: "a-token", userId: null});
    setTokenSource(source);
    const store = createSourceStore();
    await primeSourceStore(store);
    rehydrateOffline(store, {isOnline: false, lastUserId: "user-b"});
    await waitForEffects();
    queueSourceMutation(store, "By A");

    const releases: (() => void)[] = [];
    source.getUserId = mock((): Promise<string | null> => {
      const userId = source.userId;
      return new Promise((resolve) => {
        releases.push(() => resolve(userId));
      });
    });
    // A signs out, then B signs in; B's read settles first, so the sign-out read is superseded.
    source.emitAuthChange();
    source.token = "b-token";
    source.userId = "user-b";
    source.emitAuthChange();
    releases[1]();
    await waitForEffects();
    releases[0]();
    await waitForEffects();

    source.getUserId = mock(async (): Promise<string | null> => source.userId);
    await syncQueuedMutations(store);

    expect(mockFetch).not.toHaveBeenCalled();
    expect(selectOfflineQueue(store.getState())).toHaveLength(0);
  });

  it("drops an unconfirmed mutation when the user switches directly to the persisted user", async () => {
    // P7c: the persisted id is B while A is signed in; A writes offline, then B signs in directly.
    const source = makeTokenSource({token: "a-token", userId: null});
    setTokenSource(source);
    const store = createSourceStore();
    await primeSourceStore(store);
    rehydrateOffline(store, {isOnline: false, lastUserId: "user-b"});
    await waitForEffects();
    queueSourceMutation(store, "By A");

    source.token = "b-token";
    source.userId = "user-b";
    source.emitAuthChange();
    await waitForEffects();
    await syncQueuedMutations(store);

    expect(mockFetch).not.toHaveBeenCalled();
    expect(selectOfflineQueue(store.getState())).toHaveLength(0);
  });

  it("drops unconfirmed mutations on any auth change, even when the same user is reported", async () => {
    const source = makeTokenSource({token: "a-token", userId: null});
    setTokenSource(source);
    const store = createSourceStore();
    await primeSourceStore(store);
    rehydrateOffline(store, {isOnline: false, lastUserId: "user-a"});
    await waitForEffects();
    queueSourceMutation(store, "Unconfirmed by A");

    source.userId = "user-a";
    source.emitAuthChange();
    await waitForEffects();
    queueSourceMutation(store, "Confirmed by A");

    expect(
      selectOfflineQueue(store.getState()).map(
        (m) => (m.args as {body: {title: string}}).body.title
      )
    ).toEqual(["Confirmed by A"]);
  });

  it("drops unconfirmed mutations when the token source is swapped", async () => {
    const source = makeTokenSource({token: "a-token", userId: null});
    setTokenSource(source);
    const store = createSourceStore();
    await primeSourceStore(store);
    rehydrateOffline(store, {isOnline: false, lastUserId: "user-a"});
    await waitForEffects();
    queueSourceMutation(store, "Unconfirmed by A");
    const consoleError = spyOn(console, "error");

    try {
      const nextSource = makeTokenSource({token: "a-token", userId: "user-a"});
      setTokenSource(nextSource);
      await primeSourceStore(store);

      expect(selectOfflineQueue(store.getState())).toHaveLength(0);
      // The swap subscribes and reads once; it must not re-enter itself through its own dispatch.
      expect(source.authListenerCount()).toBe(0);
      expect(nextSource.authListenerCount()).toBe(1);
      expect(nextSource.getUserId).toHaveBeenCalledTimes(1);
      expect(consoleError).not.toHaveBeenCalled();
    } finally {
      consoleError.mockRestore();
    }
  });

  it("clears the queue when the source reports a sign-out", async () => {
    const source = makeTokenSource({token: "a-token", userId: "user-a"});
    setTokenSource(source);
    const store = createSourceStore();
    await primeSourceStore(store);
    store.dispatch(setOnlineStatus(false));
    queueSourceMutation(store, "Written by A");

    source.token = null;
    source.userId = null;
    source.emitAuthChange();
    await waitForEffects();

    expect(selectOfflineQueue(store.getState())).toHaveLength(0);

    source.token = "a-token";
    source.userId = "user-a";
    source.emitAuthChange();
    await syncQueuedMutations(store);

    expect(mockFetch).not.toHaveBeenCalled();
  });

  it("clears the queue on the Better Auth slice's logout action", async () => {
    const source = makeTokenSource({token: "a-token", userId: "user-a"});
    setTokenSource(source);
    const store = createSourceStore();
    await primeSourceStore(store);
    store.dispatch(setOnlineStatus(false));
    queueSourceMutation(store, "Written by A");

    store.dispatch({type: "betterAuth/logout"});

    expect(selectOfflineQueue(store.getState())).toHaveLength(0);
    expect(selectLastUserId(store.getState())).toBeUndefined();
  });

  it("stops listening to a source once the app goes back to the JWT path", async () => {
    const source = makeTokenSource({token: "ba-token", userId: "ba-user"});
    setTokenSource(source);
    const store = createSourceStore();
    await primeSourceStore(store);
    expect(source.authListenerCount()).toBe(1);
    expect(source.getUserId).toHaveBeenCalledTimes(1);
    const consoleError = spyOn(console, "error");

    try {
      setTokenSource(undefined);
      await primeSourceStore(store);

      expect(source.authListenerCount()).toBe(0);
      expect(source.getUserId).toHaveBeenCalledTimes(1);
      expect(consoleError).not.toHaveBeenCalled();
    } finally {
      consoleError.mockRestore();
    }
  });

  it("leaves the JWT queue alone on the Better Auth slice's logout action", () => {
    const store = createTestStore();
    goOfflineAndQueue(store);

    store.dispatch({type: "betterAuth/logout"});

    expect(selectOfflineQueue(store.getState())).toHaveLength(1);
  });

  it("keeps the JWT path when the built-in JWT source is registered explicitly", async () => {
    setTokenSource(fakeJwtTokenSource);
    currentUserId = "test-user";
    authToken = "jwt-token";
    const store = createTestStore();

    goOfflineAndQueue(store, {
      endpointName: "postTodos",
      originalArgs: {body: {title: "JWT create"}},
    });
    expect(selectOfflineQueue(store.getState())[0].userId).toBe("test-user");

    await syncQueuedMutations(store);

    expect(replayedAuthorizations()).toEqual(["Bearer jwt-token"]);
  });
});
