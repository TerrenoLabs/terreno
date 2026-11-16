/**
 * Isolated tests for useMcpOAuthConsent. The network is stubbed at the fetch boundary of a real
 * request client mounted through ApiClientProvider; the hook itself is not mocked.
 */
import {describe, expect, it} from "bun:test";
import {act, renderHook, waitFor} from "@testing-library/react-native";
import React from "react";

import {createApiClient, type FetchLike} from "../api/client";
import {type UseMcpOAuthConsentResult, useMcpOAuthConsent} from "../auth/useMcpOAuthConsent";
import {ApiClientProvider} from "../react/apiHooks";

const REQUEST_ID = "req-1";
const REQUEST_PATH = `/oauth/authorize/${REQUEST_ID}`;

const CONSENT = {
  clientId: "client-1",
  clientName: "Claude",
  expiresAt: "2026-11-16T12:00:00.000Z",
  // `as const` keeps `access` a literal so the fixture type-checks against McpOAuthConsentGrant.
  grants: [
    {access: "read" as const, description: "Read your data", label: "Read", scope: "mcp:read"},
    {access: "write" as const, description: null, label: "Write", scope: "mcp:write"},
  ],
  redirectHost: "claude.ai",
  redirectUri: "https://claude.ai/callback",
  requestId: REQUEST_ID,
  resource: "https://api.test/mcp",
  scope: "mcp:read mcp:write",
};

interface Recorded {
  body: unknown;
  method: string;
  path: string;
}

interface StubOptions {
  /** HTTP status for GET (default 200). */
  getStatus?: number;
  /** HTTP status for approve (default 200). */
  approveStatus?: number;
  /** Delay approve until released, to observe `submitting`. */
  holdApprove?: Promise<void>;
}

const json = (status: number, body: unknown): Response =>
  new Response(JSON.stringify(body), {
    headers: {"Content-Type": "application/json"},
    status,
  });

const stubServer = (
  options: StubOptions = {}
): {calls: Recorded[]; wrapper: React.FC<{children: React.ReactNode}>} => {
  const calls: Recorded[] = [];
  const fetchImpl: FetchLike = async (input, init) => {
    const method = init?.method ?? "GET";
    const path = new URL(input).pathname;
    calls.push({body: init?.body ? JSON.parse(String(init.body)) : undefined, method, path});
    if (method === "GET") {
      const status = options.getStatus ?? 200;
      return status === 200 ? json(200, {data: CONSENT}) : json(status, {title: "failed"});
    }
    if (path.endsWith("/approve")) {
      await options.holdApprove;
      const status = options.approveStatus ?? 200;
      return status === 200
        ? json(200, {data: {redirectUrl: "https://claude.ai/callback?code=abc"}})
        : json(status, {title: "failed"});
    }
    return json(200, {data: {redirectUrl: "https://claude.ai/callback?error=access_denied"}});
  };
  const client = createApiClient({baseUrl: "http://api.test", fetchImpl});
  const wrapper: React.FC<{children: React.ReactNode}> = ({children}) =>
    React.createElement(ApiClientProvider, {children, client});
  return {calls, wrapper};
};

const mount = (
  requestId: string | undefined,
  options: StubOptions = {}
): {
  calls: Recorded[];
  redirects: string[];
  // Typed with the hook's result instead of `any` so the file passes Biome noExplicitAny.
  hook: ReturnType<typeof renderHook<UseMcpOAuthConsentResult, unknown>>;
} => {
  const {calls, wrapper} = stubServer(options);
  const redirects: string[] = [];
  const hook = renderHook(
    () => useMcpOAuthConsent({onRedirect: (url) => redirects.push(url), requestId}),
    {wrapper}
  );
  return {calls, hook, redirects};
};

const mountReady = async (options: StubOptions = {}): Promise<ReturnType<typeof mount>> => {
  const mounted = mount(REQUEST_ID, options);
  await waitFor(() => {
    expect(mounted.hook.result.current.state).toBe("ready");
  });
  return mounted;
};

describe("useMcpOAuthConsent", () => {
  it("reports missingRequest without any fetch when requestId is undefined", async () => {
    const {calls, hook} = mount(undefined);
    expect(hook.result.current.state).toBe("error");
    expect(hook.result.current.errorKind).toBe("missingRequest");
    await new Promise((resolve) => setTimeout(resolve, 20));
    expect(calls).toEqual([]);
  });

  it("starts loading, then is ready with every grant selected in order", async () => {
    const {calls, hook} = mount(REQUEST_ID);
    expect(hook.result.current.state).toBe("loading");
    await waitFor(() => {
      expect(hook.result.current.state).toBe("ready");
    });
    expect(calls[0]).toMatchObject({method: "GET", path: REQUEST_PATH});
    expect(hook.result.current.selectedScopes).toEqual(["mcp:read", "mcp:write"]);
    expect(hook.result.current.request?.clientName).toBe("Claude");
    expect(hook.result.current.request?.redirectHost).toBe("claude.ai");
    expect(hook.result.current.request?.grants).toEqual(CONSENT.grants);
    expect(hook.result.current.errorKind).toBeUndefined();
  });

  it("toggling mcp:write off then approve posts {scope: 'mcp:read'} and redirects", async () => {
    const {calls, hook, redirects} = await mountReady();
    act(() => hook.result.current.toggleScope("mcp:write"));
    expect(hook.result.current.selectedScopes).toEqual(["mcp:read"]);
    await act(async () => {
      await hook.result.current.approve();
    });
    const post = calls.find((call) => call.method === "POST");
    expect(post).toMatchObject({
      body: {scope: "mcp:read"},
      path: `${REQUEST_PATH}/approve`,
    });
    expect(redirects).toEqual(["https://claude.ai/callback?code=abc"]);
  });

  it("toggling a scope off and on again restores it", async () => {
    const {hook} = await mountReady();
    act(() => hook.result.current.toggleScope("mcp:write"));
    act(() => hook.result.current.toggleScope("mcp:write"));
    expect([...hook.result.current.selectedScopes].sort()).toEqual(["mcp:read", "mcp:write"]);
  });

  it("approve with every scope toggled off sends nothing and stays ready", async () => {
    const {calls, hook, redirects} = await mountReady();
    act(() => hook.result.current.toggleScope("mcp:read"));
    act(() => hook.result.current.toggleScope("mcp:write"));
    expect(hook.result.current.selectedScopes).toEqual([]);
    await act(async () => {
      await hook.result.current.approve();
    });
    expect(calls.filter((call) => call.method === "POST")).toEqual([]);
    expect(hook.result.current.state).toBe("ready");
    expect(redirects).toEqual([]);
  });

  it("is in submitting while approve is in flight", async () => {
    let release: () => void = () => {};
    const holdApprove = new Promise<void>((resolve) => {
      release = resolve;
    });
    const {hook, redirects} = await mountReady({holdApprove});
    let pending: Promise<void> = Promise.resolve();
    act(() => {
      pending = hook.result.current.approve();
    });
    await waitFor(() => {
      expect(hook.result.current.state).toBe("submitting");
    });
    expect(redirects).toEqual([]);
    release();
    await act(async () => {
      await pending;
    });
    expect(redirects).toEqual(["https://claude.ai/callback?code=abc"]);
  });

  it("deny posts to deny and redirects with the returned URL", async () => {
    const {calls, hook, redirects} = await mountReady();
    await act(async () => {
      await hook.result.current.deny();
    });
    expect(calls.find((call) => call.method === "POST")).toMatchObject({
      path: `${REQUEST_PATH}/deny`,
    });
    expect(redirects).toEqual(["https://claude.ai/callback?error=access_denied"]);
  });

  for (const [status, kind] of [
    [404, "notFound"],
    [409, "decided"],
    [400, "expired"],
    [401, "signedOut"],
    [500, "unknown"],
  ] as const) {
    it(`maps GET ${status} to errorKind ${kind}`, async () => {
      const {hook, redirects} = mount(REQUEST_ID, {getStatus: status});
      await waitFor(() => {
        expect(hook.result.current.state).toBe("error");
      });
      expect(hook.result.current.errorKind).toBe(kind);
      expect(redirects).toEqual([]);
    });
  }

  it("approve answering 409 sets errorKind decided and does not redirect", async () => {
    const {hook, redirects} = await mountReady({approveStatus: 409});
    await act(async () => {
      await hook.result.current.approve();
    });
    expect(hook.result.current.state).toBe("error");
    expect(hook.result.current.errorKind).toBe("decided");
    expect(redirects).toEqual([]);
  });
});
