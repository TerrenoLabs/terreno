import {afterAll, beforeAll, beforeEach, describe, expect, it, mock} from "bun:test";
import {act, fireEvent, waitFor} from "@testing-library/react-native";
import {useLocalSearchParams} from "expo-router";
import React from "react";
import {Provider} from "react-redux";
import {renderWithTheme} from "../../../ui/src/test-utils";

type MockableUseLocalSearchParams = typeof useLocalSearchParams & {
  mockImplementation?: (impl: typeof useLocalSearchParams) => void;
};

interface EndpointDefinition {
  keepUnusedDataFor?: number;
  query: (requestId: string) => {method: string; url: string};
}

interface QueryState {
  data?: Record<string, unknown>;
  error?: unknown;
  isLoading: boolean;
}

const consentApiUrl = new URL("../../store/mcpOAuthConsentApi.ts", import.meta.url);
const sdkPath = new URL("./sdk.ts", consentApiUrl).pathname;
const consentApiPath = consentApiUrl.pathname;

const PENDING_REQUEST = {
  clientId: "client-1",
  clientName: "Claude",
  expiresAt: "2026-11-02T12:00:00.000Z",
  redirectHost: "claude.ai",
  redirectUri: "https://claude.ai/api/mcp/auth_callback",
  requestId: "req-1",
  scope: "mcp:read mcp:write",
};

// A fake store is enough: the screen only reads the Better Auth user.
// getState must return the same object every call, or useSelector re-renders forever.
const fakeStore = (email?: string): Parameters<typeof Provider>[0]["store"] => {
  const state = {betterAuth: {user: email ? {email} : null}};
  return {
    dispatch: (action: unknown) => action,
    getState: () => state,
    subscribe: () => () => undefined,
  } as unknown as Parameters<typeof Provider>[0]["store"];
};

describe("mcpOAuthConsentApi", () => {
  const captured: {endpoints?: Record<string, EndpointDefinition>} = {};

  beforeAll(async () => {
    // Same export names as the sdk mock in adminSpaUiCoverage.test.tsx: bun keeps the first
    // mock's names for a module, so both mocks must declare every export.
    mock.module(sdkPath, () => ({
      openapi: {
        injectEndpoints: ({
          endpoints,
        }: {
          endpoints: (build: unknown) => Record<string, EndpointDefinition>;
        }) => {
          const build = {
            mutation: (definition: EndpointDefinition) => definition,
            query: (definition: EndpointDefinition) => definition,
          };
          captured.endpoints = endpoints(build);
          return {
            useApproveMcpOAuthRequestMutation: () => undefined,
            useDenyMcpOAuthRequestMutation: () => undefined,
            useGetMcpOAuthRequestQuery: () => undefined,
          };
        },
      },
      terrenoApi: {reducerPath: "terreno-admin-spa-test-api"},
      useGetAdminSpaProfileQuery: () => ({data: undefined}),
    }));
    await import(consentApiPath);
  });

  it("reads, approves, and denies by encoded request id over the session API", () => {
    const endpoints = captured.endpoints ?? {};
    expect(endpoints.getMcpOAuthRequest.query("a/b")).toEqual({
      method: "GET",
      url: "/oauth/authorize/a%2Fb",
    });
    expect(endpoints.getMcpOAuthRequest.keepUnusedDataFor).toBe(0);
    expect(endpoints.approveMcpOAuthRequest.query("req-1")).toEqual({
      method: "POST",
      url: "/oauth/authorize/req-1/approve",
    });
    expect(endpoints.denyMcpOAuthRequest.query("req-1")).toEqual({
      method: "POST",
      url: "/oauth/authorize/req-1/deny",
    });
  });
});

describe("OAuthConsentScreen", () => {
  const searchParams: {request?: string | string[]} = {};
  const queryState: QueryState = {isLoading: false};
  const decisions: {approve: ReturnType<typeof mock>; deny: ReturnType<typeof mock>} = {
    approve: mock(),
    deny: mock(),
  };
  const assign = mock((_url: string) => undefined);
  const globals = globalThis as {window?: unknown};
  const originalWindow = globals.window;
  let OAuthConsentScreen: React.FC;

  const renderScreen = (email?: string): ReturnType<typeof renderWithTheme> =>
    renderWithTheme(
      <Provider store={fakeStore(email)}>
        <OAuthConsentScreen />
      </Provider>
    );

  beforeAll(async () => {
    // The real @terreno/rtk pulls in Expo native modules; the screen only needs this selector.
    mock.module("@terreno/rtk", () => ({
      selectBetterAuthUser: (state: {betterAuth: {user: unknown}}) => state.betterAuth.user,
    }));
    mock.module(consentApiPath, () => ({
      useApproveMcpOAuthRequestMutation: () => [decisions.approve],
      useDenyMcpOAuthRequestMutation: () => [decisions.deny],
      useGetMcpOAuthRequestQuery: () => queryState,
    }));
    // The screen leaves for the client's redirect with window.location.assign.
    globals.window = {...(originalWindow as object | undefined), location: {assign}};
    (useLocalSearchParams as MockableUseLocalSearchParams).mockImplementation?.(
      () => searchParams as ReturnType<typeof useLocalSearchParams>
    );
    ({default: OAuthConsentScreen} = await import("../../app/oauth/consent"));
  });

  afterAll(() => {
    globals.window = originalWindow;
    (useLocalSearchParams as MockableUseLocalSearchParams).mockImplementation?.(() => ({}));
  });

  beforeEach(() => {
    searchParams.request = "req-1";
    queryState.data = PENDING_REQUEST;
    queryState.error = undefined;
    queryState.isLoading = false;
    assign.mockClear();
    decisions.approve = mock(() => ({
      unwrap: async () => ({redirectUrl: "https://claude.ai/cb?code=abc"}),
    }));
    decisions.deny = mock(() => ({
      unwrap: async () => ({redirectUrl: "https://claude.ai/cb?error=access_denied"}),
    }));
  });

  it("asks for a request id when the link has none", () => {
    searchParams.request = undefined;
    const {getByTestId} = renderScreen();
    expect(getByTestId("admin-spa-oauth-consent-missing-request")).toBeTruthy();
  });

  it("shows a spinner while the request loads", () => {
    queryState.isLoading = true;
    queryState.data = undefined;
    const {getByTestId} = renderScreen();
    expect(getByTestId("admin-spa-oauth-consent-loading")).toBeTruthy();
  });

  it("maps load errors to their screen state", () => {
    queryState.data = undefined;
    queryState.error = {status: 409};
    const {getByTestId} = renderScreen();
    expect(getByTestId("admin-spa-oauth-consent-decided")).toBeTruthy();
  });

  it("shows the client, redirect host, scopes, and signed-in email", () => {
    const {getAllByTestId, getByTestId} = renderScreen("user@example.com");
    expect(getByTestId("admin-spa-oauth-consent-client-name")).toBeTruthy();
    expect(getAllByTestId("admin-spa-oauth-consent-redirect-host").length).toBeGreaterThan(0);
    expect(getAllByTestId("admin-spa-oauth-consent-scope-mcp:read").length).toBeGreaterThan(0);
    expect(getAllByTestId("admin-spa-oauth-consent-scope-mcp:write").length).toBeGreaterThan(0);
    expect(getByTestId("admin-spa-oauth-consent-user-email")).toBeTruthy();
  });

  it("falls back to default copy for an unnamed client with no scope", () => {
    queryState.data = {...PENDING_REQUEST, clientName: null, scope: null};
    const {getByText} = renderScreen();
    expect(getByText("An unnamed MCP client")).toBeTruthy();
    expect(getByText("The server's default MCP access")).toBeTruthy();
  });

  it("sends the browser to the client's redirect after approve", async () => {
    const {getByTestId} = renderScreen();
    await act(async () => {
      fireEvent.press(getByTestId("admin-spa-oauth-consent-approve-button"));
    });
    await waitFor(() => expect(assign).toHaveBeenCalledWith("https://claude.ai/cb?code=abc"));
    expect(decisions.approve).toHaveBeenCalledWith("req-1");
  });

  it("sends the browser to the client's redirect after deny", async () => {
    const {getByTestId} = renderScreen();
    await act(async () => {
      fireEvent.press(getByTestId("admin-spa-oauth-consent-deny-button"));
    });
    await waitFor(() =>
      expect(assign).toHaveBeenCalledWith("https://claude.ai/cb?error=access_denied")
    );
    expect(decisions.deny).toHaveBeenCalledWith("req-1");
  });

  it("shows the decision error when approve fails", async () => {
    decisions.approve = mock(() => ({
      unwrap: async () => {
        throw {status: 401};
      },
    }));
    const {getByTestId, findByTestId} = renderScreen();
    await act(async () => {
      fireEvent.press(getByTestId("admin-spa-oauth-consent-approve-button"));
    });
    expect(await findByTestId("admin-spa-oauth-consent-signed-out")).toBeTruthy();
    expect(assign).not.toHaveBeenCalled();
  });
});
