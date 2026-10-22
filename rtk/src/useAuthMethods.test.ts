import {afterEach, describe, expect, it, spyOn} from "bun:test";
import {renderHook, waitFor} from "@testing-library/react-native";

import {type AuthMethodsClient, type BetterAuthMethods, useAuthMethods} from "./useAuthMethods";

const METHODS: BetterAuthMethods = {
  accountLinking: {mode: "verified-email"},
  emailPassword: true,
  multiSession: false,
  passkey: false,
  providers: ["github", "mock-oidc"],
  signUp: true,
  twoFactor: false,
};

interface FakeClient extends AuthMethodsClient {
  calls: Array<{options?: {method?: string}; path: string}>;
}

const fakeClient = (respond: () => Promise<{data: unknown; error: unknown}>): FakeClient => {
  const calls: FakeClient["calls"] = [];
  return {
    $fetch: (path, options) => {
      calls.push({options, path});
      return respond();
    },
    calls,
  };
};

describe("useAuthMethods", () => {
  afterEach(() => {
    // Restores console.warn after a test spies on it.
    (console.warn as unknown as {mockRestore?: () => void}).mockRestore?.();
  });

  it("loads the server's sign-in methods through the client's $fetch", async () => {
    const client = fakeClient(async () => ({data: METHODS, error: null}));
    const {result} = renderHook(() => useAuthMethods(client));

    expect(result.current.isLoading).toBe(true);
    expect(result.current.methods).toBeUndefined();

    await waitFor(() => expect(result.current.isLoading).toBe(false));
    expect(result.current.methods).toEqual(METHODS);
    expect(result.current.error).toBeUndefined();
    expect(client.calls).toEqual([{options: {method: "GET"}, path: "/terreno/methods"}]);
  });

  it("reports the error message when the server answers with an error", async () => {
    const client = fakeClient(async () => ({
      data: null,
      error: {message: "Not found", status: 404, statusText: "Not Found"},
    }));
    const {result} = renderHook(() => useAuthMethods(client));

    await waitFor(() => expect(result.current.isLoading).toBe(false));
    expect(result.current.methods).toBeUndefined();
    expect(result.current.error).toBe("Not found");
  });

  it("falls back to the status text when the error has no message", async () => {
    const client = fakeClient(async () => ({
      data: null,
      error: {status: 500, statusText: "Internal Server Error"},
    }));
    const {result} = renderHook(() => useAuthMethods(client));

    await waitFor(() => expect(result.current.isLoading).toBe(false));
    expect(result.current.error).toBe("Internal Server Error");
  });

  it("reports a generic error for an error without a message or status text", async () => {
    const client = fakeClient(async () => ({data: null, error: {}}));
    const {result} = renderHook(() => useAuthMethods(client));

    await waitFor(() => expect(result.current.isLoading).toBe(false));
    expect(result.current.error).toBe("Could not load sign-in methods");
  });

  it("reports a thrown network error", async () => {
    const client = fakeClient(async () => {
      throw new Error("Network request failed");
    });
    const {result} = renderHook(() => useAuthMethods(client));

    await waitFor(() => expect(result.current.isLoading).toBe(false));
    expect(result.current.methods).toBeUndefined();
    expect(result.current.error).toBe("Network request failed");
  });

  it("reports a generic error when something other than an Error is thrown", async () => {
    const client = fakeClient(async () => {
      throw "offline";
    });
    const {result} = renderHook(() => useAuthMethods(client));

    await waitFor(() => expect(result.current.isLoading).toBe(false));
    expect(result.current.error).toBe("Could not load sign-in methods");
  });

  it("ignores a response that arrives after unmount", async () => {
    const warn = spyOn(console, "warn").mockImplementation(() => {});
    let resolve: (value: {data: unknown; error: unknown}) => void = () => {};
    const client = fakeClient(
      () =>
        new Promise((done) => {
          resolve = done;
        })
    );
    const {unmount} = renderHook(() => useAuthMethods(client));
    unmount();
    resolve({data: null, error: {message: "Too late"}});
    await new Promise((done) => setTimeout(done, 0));
    expect(warn).not.toHaveBeenCalled();
  });

  it("refetches when the client changes", async () => {
    const first = fakeClient(async () => ({data: METHODS, error: null}));
    const secondMethods = {...METHODS, providers: ["google"]};
    const second = fakeClient(async () => ({data: secondMethods, error: null}));
    const {result, rerender} = renderHook(
      ({client}: {client: AuthMethodsClient}) => useAuthMethods(client),
      {initialProps: {client: first as AuthMethodsClient}}
    );
    await waitFor(() => expect(result.current.methods).toEqual(METHODS));

    rerender({client: second});
    await waitFor(() => expect(result.current.methods).toEqual(secondMethods));
    expect(first.calls).toHaveLength(1);
    expect(second.calls).toHaveLength(1);
  });

  it("fetches once per client across re-renders", async () => {
    const client = fakeClient(async () => ({data: METHODS, error: null}));
    const {result, rerender} = renderHook(() => useAuthMethods(client));
    await waitFor(() => expect(result.current.isLoading).toBe(false));
    rerender({});
    expect(client.calls).toHaveLength(1);
  });
});
