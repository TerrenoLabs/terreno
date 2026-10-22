import {describe, expect, it} from "bun:test";
import {act, renderHook, waitFor} from "@testing-library/react-native";
import React from "react";

import {type ApiClient, type ApiError, createApiClient, type FetchLike} from "../api/client";
import {
  ApiClientProvider,
  useApiClient,
  useApiMutation,
  useApiQuery,
  useLazyApiQuery,
} from "./apiHooks";

interface Profile {
  _id: string;
  name: string;
}

/** In-memory `/auth/me` backend reached through the fetch boundary. */
const profileServer = (): {
  client: ApiClient;
  requests: string[];
  failNext: (status: number, title: string) => void;
} => {
  let profile: Profile = {_id: "u1", name: "Ada"};
  const requests: string[] = [];
  let failure: {status: number; title: string} | undefined;
  const fetchImpl: FetchLike = async (input, init) => {
    const method = init?.method ?? "GET";
    const path = new URL(input).pathname;
    requests.push(`${method} ${path}`);
    if (failure) {
      const {status, title} = failure;
      failure = undefined;
      return new Response(JSON.stringify({title}), {
        headers: {"Content-Type": "application/json"},
        status,
      });
    }
    if (method === "PATCH") {
      profile = {...profile, ...(JSON.parse(String(init?.body)) as Partial<Profile>)};
    }
    return new Response(JSON.stringify({data: profile}), {
      headers: {"Content-Type": "application/json"},
    });
  };
  return {
    client: createApiClient({baseUrl: "http://api.test", fetchImpl}),
    failNext: (status, title) => {
      failure = {status, title};
    },
    requests,
  };
};

const wrapperFor =
  (client: ApiClient): React.FC<{children: React.ReactNode}> =>
  ({children}) => <ApiClientProvider client={client}>{children}</ApiClientProvider>;

const ME = {url: "/auth/me"};

describe("useApiQuery", () => {
  it("loads data, shares one request between components, and reports loading flags", async () => {
    const server = profileServer();
    const wrapper = wrapperFor(server.client);

    const first = renderHook(() => useApiQuery<Profile>(ME, {providesTags: ["profile"]}), {
      wrapper,
    });
    const second = renderHook(() => useApiQuery<Profile>(ME), {wrapper});

    expect(first.result.current.isLoading).toBe(true);
    await waitFor(() => {
      expect(first.result.current.data).toEqual({_id: "u1", name: "Ada"});
    });
    expect(second.result.current.data).toEqual({_id: "u1", name: "Ada"});
    expect(first.result.current).toMatchObject({
      isError: false,
      isFetching: false,
      isLoading: false,
      isSuccess: true,
    });
    expect(server.requests).toEqual(["GET /auth/me"]);
  });

  it("does not request while skipped and starts when skip turns off", async () => {
    const server = profileServer();
    const {result, rerender} = renderHook(
      ({skip}: {skip: boolean}) => useApiQuery<Profile>(ME, {skip}),
      {initialProps: {skip: true}, wrapper: wrapperFor(server.client)}
    );

    expect(result.current.isUninitialized).toBe(true);
    expect(server.requests).toEqual([]);

    rerender({skip: false});
    await waitFor(() => {
      expect(result.current.data?.name).toBe("Ada");
    });
  });

  it("exposes errors and recovers through refetch", async () => {
    const server = profileServer();
    server.failNext(500, "Database unavailable");
    const {result} = renderHook(() => useApiQuery<Profile>(ME), {
      wrapper: wrapperFor(server.client),
    });

    await waitFor(() => {
      expect(result.current.isError).toBe(true);
    });
    expect((result.current.error as ApiError).data.title).toBe("Database unavailable");

    let refetched: {data?: Profile; isError: boolean} | undefined;
    await act(async () => {
      refetched = await result.current.refetch();
    });
    expect(refetched).toEqual({data: {_id: "u1", name: "Ada"}, isError: false});
    expect(result.current.isError).toBe(false);
  });

  it("applies transformResponse to the cached data", async () => {
    const server = profileServer();
    const {result} = renderHook(
      () => useApiQuery<Profile, string>(ME, {transformResponse: (profile) => profile.name}),
      {wrapper: wrapperFor(server.client)}
    );

    await waitFor(() => {
      expect(result.current.data).toBe("Ada");
    });
  });

  it("accepts an explicit client without a provider", async () => {
    const server = profileServer();
    const {result} = renderHook(() => useApiQuery<Profile>(ME, {client: server.client}));

    await waitFor(() => {
      expect(result.current.data?._id).toBe("u1");
    });
  });
});

describe("useApiMutation", () => {
  it("sends the request, resolves unwrap(), and refreshes queries with invalidated tags", async () => {
    const server = profileServer();
    const wrapper = wrapperFor(server.client);
    const query = renderHook(() => useApiQuery<Profile>(ME, {providesTags: ["profile"]}), {
      wrapper,
    });
    const mutation = renderHook(
      () =>
        useApiMutation<{name: string}, Profile>(
          (body) => ({body, method: "PATCH", url: "/auth/me"}),
          {invalidatesTags: ["profile"]}
        ),
      {wrapper}
    );
    await waitFor(() => {
      expect(query.result.current.data?.name).toBe("Ada");
    });

    let updated: Profile | undefined;
    await act(async () => {
      updated = await mutation.result.current[0]({name: "Grace"}).unwrap();
    });

    expect(updated).toEqual({_id: "u1", name: "Grace"});
    expect(mutation.result.current[1]).toMatchObject({
      data: {_id: "u1", name: "Grace"},
      isLoading: false,
      isSuccess: true,
    });
    await waitFor(() => {
      expect(query.result.current.data?.name).toBe("Grace");
    });
    expect(server.requests).toEqual(["GET /auth/me", "PATCH /auth/me", "GET /auth/me"]);
  });

  it("resolves the trigger to {error} and rejects unwrap() on failure", async () => {
    const server = profileServer();
    const {result} = renderHook(
      () =>
        useApiMutation<{name: string}, Profile>((body) => ({
          body,
          method: "PATCH",
          url: "/auth/me",
        })),
      {wrapper: wrapperFor(server.client)}
    );

    server.failNext(400, "Name too short");
    let outcome: {data?: Profile; error?: unknown} | undefined;
    await act(async () => {
      outcome = await result.current[0]({name: ""});
    });
    expect((outcome as {error: ApiError}).error.status).toBe(400);
    expect(result.current[1].isError).toBe(true);

    server.failNext(400, "Name too short");
    let rejected: unknown;
    await act(async () => {
      rejected = await result.current[0]({name: ""})
        .unwrap()
        .catch((error: unknown) => error);
    });
    expect((rejected as ApiError).data.title).toBe("Name too short");

    act(() => {
      result.current[1].reset();
    });
    expect(result.current[1]).toMatchObject({error: undefined, isError: false});
  });
});

describe("useLazyApiQuery", () => {
  it("fetches only when triggered and always refetches", async () => {
    const server = profileServer();
    const {result} = renderHook(() => useLazyApiQuery<Profile>(), {
      wrapper: wrapperFor(server.client),
    });

    expect(server.requests).toEqual([]);
    let first: Profile | undefined;
    await act(async () => {
      first = await result.current[0](ME).unwrap();
    });
    await act(async () => {
      await result.current[0](ME).unwrap();
    });

    expect(first?.name).toBe("Ada");
    expect(result.current[1].data?.name).toBe("Ada");
    expect(server.requests).toEqual(["GET /auth/me", "GET /auth/me"]);
  });
});

describe("useApiClient", () => {
  it("throws a clear error outside ApiClientProvider", () => {
    expect(() => renderHook(() => useApiClient())).toThrow(/ApiClientProvider/);
  });
});

describe("useApiQuery polling and refetch edges", () => {
  it("re-requests on pollingInterval while mounted and stops after unmount", async () => {
    const server = profileServer();
    const {result, unmount} = renderHook(() => useApiQuery<Profile>(ME, {pollingInterval: 10}), {
      wrapper: wrapperFor(server.client),
    });

    await waitFor(() => {
      expect(server.requests.length).toBeGreaterThanOrEqual(3);
    });
    expect(result.current.data?.name).toBe("Ada");
    unmount();
    const settled = server.requests.length;
    await new Promise((resolve) => setTimeout(resolve, 40));
    expect(server.requests.length).toBeLessThanOrEqual(settled + 1);
  });

  it("refetch is a no-op while skipped and reports errors without throwing", async () => {
    const server = profileServer();
    const skipped = renderHook(() => useApiQuery<Profile>(ME, {skip: true}), {
      wrapper: wrapperFor(server.client),
    });
    const live = renderHook(() => useApiQuery<Profile>(ME), {wrapper: wrapperFor(server.client)});
    await waitFor(() => {
      expect(live.result.current.isSuccess).toBe(true);
    });

    let skippedResult: unknown;
    let failedResult: {error?: unknown; isError: boolean} | undefined;
    await act(async () => {
      skippedResult = await skipped.result.current.refetch();
      server.failNext(503, "Maintenance");
      failedResult = await live.result.current.refetch();
    });

    expect(skippedResult).toEqual({isError: false});
    expect(failedResult?.isError).toBe(true);
    expect((failedResult as {error: ApiError}).error.data.title).toBe("Maintenance");
  });
});

describe("useApiMutation after unmount", () => {
  it("still resolves unwrap() when the component is gone", async () => {
    const server = profileServer();
    const {result, unmount} = renderHook(
      () =>
        useApiMutation<{name: string}, Profile>((body) => ({
          body,
          method: "PATCH",
          url: "/auth/me",
        })),
      {wrapper: wrapperFor(server.client)}
    );
    const trigger = result.current[0];
    unmount();

    const saved = await trigger({name: "Hopper"}).unwrap();

    expect(saved.name).toBe("Hopper");
  });
});

describe("useApiQuery re-fetch triggers", () => {
  it("fetches again when inline args change and after the client is reset", async () => {
    const server = profileServer();
    const {result, rerender} = renderHook(
      ({id}: {id: string}) => useApiQuery<Profile>({url: `/users/${id}`}),
      {initialProps: {id: "a"}, wrapper: wrapperFor(server.client)}
    );
    await waitFor(() => {
      expect(result.current.isSuccess).toBe(true);
    });

    rerender({id: "b"});
    await waitFor(() => {
      expect(server.requests).toEqual(["GET /users/a", "GET /users/b"]);
    });
    act(() => {
      server.client.reset();
    });
    await waitFor(() => {
      expect(server.requests).toEqual(["GET /users/a", "GET /users/b", "GET /users/b"]);
    });
    expect(result.current.data?.name).toBe("Ada");
  });

  it("retries a cached failure when a new component subscribes", async () => {
    const server = profileServer();
    const wrapper = wrapperFor(server.client);
    server.failNext(500, "Cold start");
    const first = renderHook(() => useApiQuery<Profile>(ME), {wrapper});
    await waitFor(() => {
      expect(first.result.current.isError).toBe(true);
    });

    const second = renderHook(() => useApiQuery<Profile>(ME), {wrapper});

    await waitFor(() => {
      expect(second.result.current.data?.name).toBe("Ada");
    });
    expect(first.result.current.isError).toBe(false);
    expect(server.requests).toEqual(["GET /auth/me", "GET /auth/me"]);
  });
});

describe("background request failures", () => {
  it("surfaces a failed poll as an error and recovers on the next poll", async () => {
    const server = profileServer();
    // Polls are fast, so record every rendered state instead of sampling the latest one.
    const errors: string[] = [];
    const {result, unmount} = renderHook(
      () => {
        const query = useApiQuery<Profile>(ME, {pollingInterval: 15});
        if (query.isError) {
          errors.push(`${(query.error as ApiError).data.title}:${query.data?.name}`);
        }
        return query;
      },
      {wrapper: wrapperFor(server.client)}
    );
    await waitFor(() => {
      expect(result.current.isSuccess).toBe(true);
    });

    server.failNext(503, "Polling blip");
    await waitFor(() => {
      expect(errors).toContain("Polling blip:Ada");
    });

    await waitFor(() => {
      expect(result.current.isSuccess).toBe(true);
    });
    unmount();
  });

  it("keeps the error when the retry for a new subscriber fails again", async () => {
    const server = profileServer();
    const wrapper = wrapperFor(server.client);
    server.failNext(500, "Cold start");
    const first = renderHook(() => useApiQuery<Profile>(ME), {wrapper});
    await waitFor(() => {
      expect(first.result.current.isError).toBe(true);
    });

    server.failNext(500, "Still cold");
    const second = renderHook(() => useApiQuery<Profile>(ME), {wrapper});

    await waitFor(() => {
      expect((second.result.current.error as ApiError | undefined)?.data.title).toBe("Still cold");
    });
    expect(second.result.current.isError).toBe(true);
    expect(server.requests).toEqual(["GET /auth/me", "GET /auth/me"]);
  });
});

describe("useApiMutation computed invalidation", () => {
  it("invalidates the tags a function derives from the result and argument", async () => {
    const server = profileServer();
    const wrapper = wrapperFor(server.client);
    const query = renderHook(() => useApiQuery<Profile>(ME, {providesTags: ["profile"]}), {
      wrapper,
    });
    await waitFor(() => {
      expect(query.result.current.isSuccess).toBe(true);
    });
    const seen: Array<{arg: {name: string}; result: Profile}> = [];
    const mutation = renderHook(
      () =>
        useApiMutation<{name: string}, Profile>(
          (body) => ({body, method: "PATCH", url: "/auth/me"}),
          {
            invalidatesTags: (result, arg) => {
              seen.push({arg, result});
              return arg.name === "Quiet" ? [] : ["profile"];
            },
          }
        ),
      {wrapper}
    );

    await act(async () => {
      await mutation.result.current[0]({name: "Quiet"}).unwrap();
    });
    expect(server.requests).toEqual(["GET /auth/me", "PATCH /auth/me"]);

    await act(async () => {
      await mutation.result.current[0]({name: "Grace"}).unwrap();
    });
    await waitFor(() => {
      expect(query.result.current.data?.name).toBe("Grace");
    });
    expect(server.requests).toEqual([
      "GET /auth/me",
      "PATCH /auth/me",
      "PATCH /auth/me",
      "GET /auth/me",
    ]);
    expect(seen.map(({arg, result}) => [arg.name, result.name])).toEqual([
      ["Quiet", "Quiet"],
      ["Grace", "Grace"],
    ]);
  });
});
