import {describe, expect, it, mock} from "bun:test";
import {configureStore, type UnknownAction} from "@reduxjs/toolkit";
import type {Api} from "@reduxjs/toolkit/query/react";
import {assert} from "chai";

import {
  buildOptimisticCreateItem,
  createOfflineMiddleware,
  isNetworkFetchError,
  shouldReplayQueuedMutation,
} from "./offlineMiddleware";
import {
  type OfflineState,
  type QueuedMutation,
  selectIsSyncing,
  selectOfflineQueue,
  setSyncing,
} from "./offlineSlice";

// Force IsWeb=true regardless of load order with the native test files.
mock.module("./platform", () => ({IsWeb: true}));

interface QueryEntry {
  data?: {data: Record<string, unknown>[] | Record<string, unknown>};
  originalArgs: unknown;
}

interface TestApiState {
  queries: Record<string, QueryEntry>;
}

interface TestState {
  auth: {userId?: string};
  offline: OfflineState;
  testApi: TestApiState;
}

const LIST_QUERY_ARGS = {};
const LIST_UPDATED_AT = "2026-05-23T21:00:00.123Z";
const BY_ID_UPDATED_AT = "2026-05-24T09:30:00.456Z";

const initialTestApiState: TestApiState = {
  queries: {
    "getTodos({})": {
      data: {
        data: [
          {
            _id: "todo-1",
            title: "Original",
            updated: LIST_UPDATED_AT,
          },
        ],
      },
      originalArgs: LIST_QUERY_ARGS,
    },
    'getTodosById({"id":"todo-2"})': {
      data: {data: {_id: "todo-2", title: "Detail only", updated: BY_ID_UPDATED_AT}},
      originalArgs: {id: "todo-2"},
    },
  },
};

const testApiReducer = (state: TestApiState = initialTestApiState): TestApiState => state;

// noExplicitAny: Test double covers only fields used by offline middleware.
// biome-ignore lint/suspicious/noExplicitAny: Test double covers only fields used by offline middleware.
const createTestApi = (): Api<any, any, any, any> => {
  return {
    endpoints: {
      getTodos: {
        select: (queryArg: unknown) => {
          return (state: TestState): QueryEntry | undefined => {
            return Object.values(state.testApi.queries).find(
              (entry) => entry.originalArgs === queryArg
            );
          };
        },
      },
    },
    reducerPath: "testApi",
    util: {
      invalidateTags: () => ({type: "testApi/invalidateTags"}),
      updateQueryData: () => ({type: "testApi/updateQueryData"}),
    },
    // noExplicitAny: Test double covers only fields used by offline middleware.
    // biome-ignore lint/suspicious/noExplicitAny: Test double covers only fields used by offline middleware.
  } as unknown as Api<any, any, any, any>;
};

describe("isNetworkFetchError", () => {
  it("returns true for TypeError error name", () => {
    expect(isNetworkFetchError({error: {name: "TypeError"}})).toBe(true);
  });

  it("returns true for network error messages", () => {
    expect(isNetworkFetchError({error: {message: "Failed to fetch"}})).toBe(true);
    expect(isNetworkFetchError({error: {message: "fetch failed"}})).toBe(true);
    expect(isNetworkFetchError({error: {message: "Network Error"}})).toBe(true);
    expect(isNetworkFetchError({error: {message: "Network unavailable"}})).toBe(true);
    expect(isNetworkFetchError({error: {message: "Load failed"}})).toBe(true);
  });

  it("returns true for string error fields", () => {
    expect(isNetworkFetchError({error: "fetch failed"})).toBe(true);
    expect(isNetworkFetchError({payload: {error: "network error"}})).toBe(true);
    expect(isNetworkFetchError({error: "Failed to fetch", status: "FETCH_ERROR"})).toBe(true);
  });

  it("returns false for non-network errors", () => {
    expect(isNetworkFetchError({error: "Unauthorized", status: "FETCH_ERROR"})).toBe(false);
    expect(isNetworkFetchError({error: {message: "Unauthorized"}})).toBe(false);
    expect(isNetworkFetchError(null)).toBe(false);
    expect(isNetworkFetchError(undefined)).toBe(false);
    expect(isNetworkFetchError({})).toBe(false);
  });
});

describe("shouldReplayQueuedMutation", () => {
  const baseMutation: QueuedMutation = {
    args: {body: {title: "Test"}},
    endpointName: "postTodos",
    id: "m1",
    timestamp: "2026-04-15T10:00:00.000Z",
    type: "create",
    userId: "user-a",
  };

  it("replays only mutations owned by the current user", () => {
    expect(shouldReplayQueuedMutation(baseMutation, "user-a")).toBe(true);
    expect(shouldReplayQueuedMutation(baseMutation, "user-b")).toBe(false);
    expect(shouldReplayQueuedMutation(baseMutation, undefined)).toBe(false);
  });

  it("does not replay legacy mutations without userId", () => {
    const legacy = {...baseMutation, userId: undefined};
    expect(shouldReplayQueuedMutation(legacy, "user-a")).toBe(false);
  });
});

describe("buildOptimisticCreateItem", () => {
  const mutation: QueuedMutation = {
    args: {body: {title: "New"}},
    endpointName: "postTodos",
    id: "queue-1",
    timestamp: "2026-04-15T10:00:00.000Z",
    type: "create",
  };

  it("applies temp ids after body spread so client ids cannot win", () => {
    const item = buildOptimisticCreateItem(mutation, {
      _id: "client-id",
      id: "client-id",
      title: "New",
    });

    expect(item._id).toBe("temp-queue-1");
    expect(item.id).toBe("temp-queue-1");
    expect(item.title).toBe("New");
    expect(item.created).toBe(mutation.timestamp);
    expect(item.updated).toBe(mutation.timestamp);
  });
});

describe("offlineMiddleware", () => {
  it("uses list-cache updated timestamp for queued update conflict headers", async () => {
    const api = createTestApi();
    const offline = createOfflineMiddleware({
      api,
      endpoints: ["patchTodosById"],
    });
    const store = configureStore({
      middleware: (getDefaultMiddleware) =>
        getDefaultMiddleware({serializableCheck: false}).concat(offline.middleware),
      reducer: {
        auth: (state = {userId: "user-a"}) => state,
        offline: offline.offlineReducer,
        testApi: testApiReducer,
      },
    });

    const rejectedMutation: UnknownAction = {
      error: {message: "Network unavailable"},
      meta: {
        arg: {
          endpointName: "patchTodosById",
          originalArgs: {
            body: {title: "Queued title"},
            id: "todo-1",
          },
        },
      },
      type: "testApi/executeMutation/rejected",
    };

    store.dispatch(rejectedMutation);
    await new Promise<void>((resolve) => setTimeout(resolve, 0));

    const queue = selectOfflineQueue(store.getState());
    expect(queue).toHaveLength(1);
    expect(queue[0].baseUpdatedAt).toBe(LIST_UPDATED_AT);
    expect(queue[0].timestamp).toBe(LIST_UPDATED_AT);
    expect(queue[0].userId).toBe("user-a");
  });

  it("falls back to the get-by-id cache updated timestamp for conflict headers", async () => {
    const api = createTestApi();
    const offline = createOfflineMiddleware({
      api,
      endpoints: ["patchTodosById"],
    });
    const store = configureStore({
      middleware: (getDefaultMiddleware) =>
        getDefaultMiddleware({serializableCheck: false}).concat(offline.middleware),
      reducer: {
        auth: (state = {userId: "user-a"}) => state,
        offline: offline.offlineReducer,
        testApi: testApiReducer,
      },
    });

    const rejectedMutation: UnknownAction = {
      error: {message: "Network unavailable"},
      meta: {
        arg: {
          endpointName: "patchTodosById",
          originalArgs: {
            body: {title: "Queued detail title"},
            id: "todo-2",
          },
        },
      },
      type: "testApi/executeMutation/rejected",
    };

    store.dispatch(rejectedMutation);
    await new Promise<void>((resolve) => setTimeout(resolve, 0));

    const queue = selectOfflineQueue(store.getState());
    assert.lengthOf(queue, 1);
    assert.equal(queue[0].baseUpdatedAt, BY_ID_UPDATED_AT);
  });

  it("ignores rejected mutations without a string endpoint name", async () => {
    const api = createTestApi();
    const offline = createOfflineMiddleware({
      api,
      endpoints: ["patchTodosById"],
    });
    const store = configureStore({
      middleware: (getDefaultMiddleware) =>
        getDefaultMiddleware({serializableCheck: false}).concat(offline.middleware),
      reducer: {
        auth: (state = {userId: "user-a"}) => state,
        offline: offline.offlineReducer,
        testApi: testApiReducer,
      },
    });

    const rejectedMutation: UnknownAction = {
      error: {message: "Network unavailable"},
      meta: {arg: {originalArgs: {id: "todo-1"}}},
      type: "testApi/executeMutation/rejected",
    };

    store.dispatch(rejectedMutation);
    await new Promise<void>((resolve) => setTimeout(resolve, 0));

    assert.lengthOf(selectOfflineQueue(store.getState()), 0);
  });

  it("resets a stuck isSyncing flag on rehydrate", () => {
    const api = createTestApi();
    const offline = createOfflineMiddleware({
      api,
      endpoints: ["patchTodosById"],
    });
    const store = configureStore({
      middleware: (getDefaultMiddleware) =>
        getDefaultMiddleware({serializableCheck: false}).concat(offline.middleware),
      reducer: {
        auth: (state = {userId: "user-a"}) => state,
        offline: offline.offlineReducer,
        testApi: testApiReducer,
      },
    });

    store.dispatch(setSyncing(true));
    assert.isTrue(selectIsSyncing(store.getState()));

    store.dispatch({type: "persist/REHYDRATE"});

    assert.isFalse(selectIsSyncing(store.getState()));
  });
});
