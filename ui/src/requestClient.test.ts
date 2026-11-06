import {describe, expect, it, mock} from "bun:test";
import {act, renderHook, waitFor} from "@testing-library/react-native";
import {useCallback} from "react";

import {
  invalidateClientTags,
  type TerrenoRequestClient,
  unwrapDataEnvelope,
  useClientMutation,
  useClientQuery,
} from "./requestClient";
import {createFakeRequestClient, fakeHttpError} from "./test-utils";

// Mirror of `@terreno/syncdb/api` ApiRequestArgs / ApiClient (ui cannot import syncdb).
// The assignment below fails to compile if TerrenoRequestClient stops being a structural
// subset of the syncdb client.
interface SyncdbApiRequestArgs {
  url: string;
  method?: string;
  body?: BodyInit | Record<string, unknown> | readonly unknown[] | null;
  params?: Record<string, unknown>;
  headers?: Record<string, string>;
  credentials?: RequestCredentials;
  signal?: AbortSignal;
  timeoutMs?: number;
  parseAs?: "json" | "text" | "blob";
  unwrap?: boolean;
}

interface SyncdbApiClientShape {
  readonly baseUrl: string | undefined;
  request: <T = unknown>(args: SyncdbApiRequestArgs) => Promise<T>;
  invalidateTags: (tags: readonly string[]) => void;
  reset: () => void;
}

const deferred = <T>(): {
  promise: Promise<T>;
  reject: (error: unknown) => void;
  resolve: (value: T) => void;
} => {
  let resolve: (value: T) => void = () => {};
  let reject: (error: unknown) => void = () => {};
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return {promise, reject, resolve};
};

const useCountQuery = (
  client: TerrenoRequestClient,
  providesTag?: string
): ReturnType<typeof useClientQuery<number>> => {
  const fetcher = useCallback(() => client.request<number>({url: "/count"}), [client]);
  return useClientQuery({client, fetcher, providesTag});
};

describe("TerrenoRequestClient", () => {
  it("accepts a syncdb ApiClient structurally", async () => {
    const syncdbClient: SyncdbApiClientShape = {
      baseUrl: "http://api.test",
      invalidateTags: () => {},
      request: async <T>(args: SyncdbApiRequestArgs): Promise<T> => args.url as T,
      reset: () => {},
    };
    const client: TerrenoRequestClient = syncdbClient;
    expect(await client.request<string>({url: "/consents/pending"})).toBe("/consents/pending");
  });
});

describe("useClientQuery", () => {
  it("loads on mount and exposes data", async () => {
    const {client} = createFakeRequestClient({"GET /count": () => 3});
    const {result} = renderHook(() => useCountQuery(client));
    expect(result.current.isLoading).toBe(true);
    await waitFor(() => expect(result.current.data).toBe(3));
    expect(result.current.isLoading).toBe(false);
    expect(result.current.isFetching).toBe(false);
    expect(result.current.error).toBeUndefined();
  });

  it("surfaces request errors and recovers on refetch", async () => {
    let shouldFail = true;
    const {client} = createFakeRequestClient({
      "GET /count": () => {
        if (shouldFail) {
          throw fakeHttpError(500);
        }
        return 7;
      },
    });
    const {result} = renderHook(() => useCountQuery(client));
    await waitFor(() => expect((result.current.error as {status?: number})?.status).toBe(500));
    expect(result.current.isLoading).toBe(false);

    shouldFail = false;
    await act(async () => {
      await result.current.refetch();
    });
    expect(result.current.data).toBe(7);
    expect(result.current.error).toBeUndefined();
  });

  it("joins an in-flight request on refetch", async () => {
    const pending = deferred<number>();
    const {client, calls} = createFakeRequestClient({"GET /count": () => pending.promise});
    const {result} = renderHook(() => useCountQuery(client));
    let refetchPromise: Promise<void> = Promise.resolve();
    act(() => {
      refetchPromise = result.current.refetch();
    });
    expect(calls).toHaveLength(1);
    await act(async () => {
      pending.resolve(5);
      await refetchPromise;
    });
    expect(result.current.data).toBe(5);
  });

  it("keeps data while refetching so isLoading stays false", async () => {
    let value = 1;
    const next = deferred<number>();
    const {client} = createFakeRequestClient({
      "GET /count": () => (value === 1 ? value : next.promise),
    });
    const {result} = renderHook(() => useCountQuery(client));
    await waitFor(() => expect(result.current.data).toBe(1));
    value = 2;
    let refetchPromise: Promise<void> = Promise.resolve();
    act(() => {
      refetchPromise = result.current.refetch();
    });
    expect(result.current.isFetching).toBe(true);
    expect(result.current.isLoading).toBe(false);
    await act(async () => {
      next.resolve(2);
      await refetchPromise;
    });
    expect(result.current.data).toBe(2);
  });

  it("refetches with a fresh request when its tag is invalidated", async () => {
    let value = 1;
    const {client, calls} = createFakeRequestClient({"GET /count": () => value});
    const {result} = renderHook(() => useCountQuery(client, "Counts"));
    await waitFor(() => expect(result.current.data).toBe(1));

    value = 2;
    await act(async () => {
      invalidateClientTags({client, tags: ["Counts"]});
    });
    await waitFor(() => expect(result.current.data).toBe(2));
    expect(calls).toHaveLength(2);
  });

  it("ignores invalidations for other tags and other clients", async () => {
    const first = createFakeRequestClient({"GET /count": () => 1});
    const second = createFakeRequestClient({"GET /count": () => 1});
    const {result} = renderHook(() => useCountQuery(first.client, "Counts"));
    await waitFor(() => expect(result.current.data).toBe(1));

    await act(async () => {
      invalidateClientTags({client: first.client, tags: ["Other"]});
      invalidateClientTags({client: second.client, tags: ["Counts"]});
    });
    expect(first.calls).toHaveLength(1);
  });

  it("stops listening for invalidations after unmount", async () => {
    const {client, calls} = createFakeRequestClient({"GET /count": () => 1});
    const {result, unmount} = renderHook(() => useCountQuery(client, "Counts"));
    await waitFor(() => expect(result.current.data).toBe(1));
    unmount();
    invalidateClientTags({client, tags: ["Counts"]});
    expect(calls).toHaveLength(1);
  });

  it("drops a stale response when a newer request was started", async () => {
    const firstResponse = deferred<number>();
    let callCount = 0;
    const {client} = createFakeRequestClient({
      "GET /count": () => {
        callCount += 1;
        return callCount === 1 ? firstResponse.promise : 2;
      },
    });
    const {result} = renderHook(() => useCountQuery(client, "Counts"));
    await act(async () => {
      invalidateClientTags({client, tags: ["Counts"]});
    });
    await waitFor(() => expect(result.current.data).toBe(2));
    await act(async () => {
      firstResponse.resolve(1);
      await firstResponse.promise;
    });
    expect(result.current.data).toBe(2);
  });

  it("drops a stale error when a newer request was started", async () => {
    const firstResponse = deferred<number>();
    let callCount = 0;
    const {client} = createFakeRequestClient({
      "GET /count": () => {
        callCount += 1;
        return callCount === 1 ? firstResponse.promise : 2;
      },
    });
    const {result} = renderHook(() => useCountQuery(client, "Counts"));
    await act(async () => {
      invalidateClientTags({client, tags: ["Counts"]});
    });
    await waitFor(() => expect(result.current.data).toBe(2));
    await act(async () => {
      firstResponse.reject(fakeHttpError(500));
      await firstResponse.promise.catch(() => {});
    });
    expect(result.current.error).toBeUndefined();
  });
});

describe("useClientMutation", () => {
  it("tracks loading and resolves when the request succeeds", async () => {
    const pending = deferred<void>();
    const run = mock((_value: string) => pending.promise);
    const {result} = renderHook(() => useClientMutation({run}));
    let mutatePromise: Promise<void> = Promise.resolve();
    act(() => {
      mutatePromise = result.current.mutate("a");
    });
    expect(result.current.isLoading).toBe(true);
    await act(async () => {
      pending.resolve();
      await mutatePromise;
    });
    expect(result.current.isLoading).toBe(false);
    expect(run).toHaveBeenCalledWith("a");
  });

  it("stores and rethrows the request error", async () => {
    const failure = fakeHttpError(400);
    const {result} = renderHook(() =>
      useClientMutation({
        run: async (): Promise<void> => {
          throw failure;
        },
      })
    );
    let caught: unknown;
    await act(async () => {
      await result.current.mutate(undefined).catch((error: unknown) => {
        caught = error;
      });
    });
    expect(caught).toBe(failure);
    expect(result.current.error).toBe(failure);
    expect(result.current.isLoading).toBe(false);
  });

  it("keeps a stable mutate identity and calls the latest run", async () => {
    const firstRun = mock(async (): Promise<void> => {});
    const secondRun = mock(async (): Promise<void> => {});
    const {result, rerender} = renderHook(
      ({run}: {run: () => Promise<void>}) => useClientMutation({run}),
      {initialProps: {run: firstRun}}
    );
    const firstMutate = result.current.mutate;
    rerender({run: secondRun});
    expect(result.current.mutate).toBe(firstMutate);
    await act(async () => {
      await result.current.mutate(undefined);
    });
    expect(firstRun).not.toHaveBeenCalled();
    expect(secondRun).toHaveBeenCalled();
  });
});

describe("unwrapDataEnvelope", () => {
  it("unwraps {data} envelopes", () => {
    expect(unwrapDataEnvelope<number[]>({data: [1]})).toEqual([1]);
  });

  it("returns bare payloads unchanged", () => {
    expect(unwrapDataEnvelope<number[]>([1])).toEqual([1]);
    expect(unwrapDataEnvelope<{current: null}>({current: null})).toEqual({current: null});
    expect(unwrapDataEnvelope(undefined)).toBeUndefined();
  });
});
