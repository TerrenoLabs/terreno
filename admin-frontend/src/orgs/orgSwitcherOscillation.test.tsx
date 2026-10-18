import {afterEach, beforeEach, describe, expect, it, mock} from "bun:test";
import {act, fireEvent} from "@testing-library/react-native";
import React from "react";
import {Text} from "react-native";
import {renderWithTheme} from "../../../ui/src/test-utils";

const routerPush = mock(() => {});

mock.module("expo-router", () => ({router: {push: routerPush}}));

import {AdminProvider} from "../AdminProvider";
import {OrgSettingsScreen} from "./OrgSettingsScreen";
import {OrgSwitcher} from "./OrgSwitcher";
import {OrgContextProvider, useOrgContext} from "./useOrgContext";

interface FetchCall {
  body?: unknown;
  headers: Record<string, string>;
  method: string;
  url: string;
}

interface StubResponse {
  body?: unknown;
  pending?: boolean;
  status?: number;
}

const calls: FetchCall[] = [];
const pendingResolvers: Array<() => void> = [];
/** Responses keyed by `"METHOD url"`; unmatched requests answer `{data: {}}`. */
const routes = new Map<string, StubResponse>();
const originalFetch = globalThis.fetch;

/** Routes the real `useOrganizationsApi` fetch client through `routes`. */
const installFetch = (): void => {
  globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit): Promise<Response> => {
    const headers: Record<string, string> = {};
    new Headers(init?.headers).forEach((value, key) => {
      headers[key] = value;
    });
    const call: FetchCall = {
      body: typeof init?.body === "string" ? JSON.parse(init.body) : undefined,
      headers,
      method: init?.method ?? "GET",
      url: String(input),
    };
    calls.push(call);
    const {
      body,
      pending,
      status = 200,
    } = routes.get(`${call.method} ${call.url}`) ?? {
      body: {data: {}},
    };
    if (pending) {
      await new Promise<void>((resolve) => {
        pendingResolvers.push(resolve);
      });
    }
    if (status === 204) {
      return new Response(null, {status});
    }
    return new Response(JSON.stringify(body ?? {}), {
      headers: {"Content-Type": "application/json"},
      status,
    });
  }) as typeof fetch;
};

const renderOrg = (ui: React.ReactElement): ReturnType<typeof renderWithTheme> =>
  renderWithTheme(
    <AdminProvider apiBase="/admin" credentials="same-origin" routeBase="/admin">
      {ui}
    </AdminProvider>
  );

const ContextProbe: React.FC = () => {
  const {organization} = useOrgContext();
  return <Text testID="org-context-probe">{organization?.name ?? "none"}</Text>;
};

const ALPHA = {_id: "org-alpha", name: "Alpha Workspace"};
const BETA = {_id: "org-beta", name: "Beta Workspace"};

describe("org switcher oscillation", () => {
  beforeEach(() => {
    calls.length = 0;
    routes.clear();
    routes.set("GET /orgs/mine", {body: {data: [ALPHA, BETA]}});
    routes.set("GET /orgs/org-alpha", {body: {data: ALPHA}});
    routes.set("GET /orgs/org-beta", {body: {data: ALPHA}});
    routerPush.mockClear();
    installFetch();
  });

  afterEach(() => {
    for (const resolve of pendingResolvers.splice(0)) {
      resolve();
    }
    globalThis.fetch = originalFetch;
  });

  it("keeps switcher selection when OrgSettingsScreen still serves the previous route org", async () => {
    const screen = renderOrg(
      <OrgContextProvider initialOrganization={ALPHA}>
        <OrgSwitcher routeBase="/admin" />
        <OrgSettingsScreen organizationId="org-alpha" routeBase="/admin" />
        <ContextProbe />
      </OrgContextProvider>
    );

    const option = await screen.findByTestId("web_dropdown_option_org-beta");
    await act(async () => {
      fireEvent(option, "press");
    });

    expect(routerPush).toHaveBeenCalledWith("/admin/orgs/org-beta");
    expect(screen.getByTestId("org-context-probe").props.children).toBe("Beta Workspace");
  });

  it("ignores stale read data for a different route organization id", async () => {
    const screen = renderOrg(
      <OrgContextProvider initialOrganization={BETA}>
        <OrgSwitcher routeBase="/admin" />
        <OrgSettingsScreen organizationId="org-beta" routeBase="/admin" />
        <ContextProbe />
      </OrgContextProvider>
    );
    await screen.findByTestId("web_dropdown_option_org-beta");
    await act(async () => {});

    expect(screen.queryByTestId("org-settings-save")).toBeNull();
    expect(screen.getByTestId("org-context-probe").props.children).toBe("Beta Workspace");
  });

  it("renders beta settings after the route-scoped read query catches up", async () => {
    routes.set("GET /orgs/org-beta", {body: {data: BETA}});
    const screen = renderOrg(
      <OrgContextProvider initialOrganization={BETA}>
        <OrgSwitcher routeBase="/admin" />
        <OrgSettingsScreen organizationId="org-beta" routeBase="/admin" />
        <ContextProbe />
      </OrgContextProvider>
    );

    expect(await screen.findByTestId("org-settings-save")).toBeTruthy();
    expect(screen.getByTestId("org-context-probe").props.children).toBe("Beta Workspace");
  });
});
