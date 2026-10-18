import {afterEach, beforeEach, describe, expect, it, mock} from "bun:test";
import {act, fireEvent} from "@testing-library/react-native";
import {assert} from "chai";
import React from "react";
import {renderWithTheme} from "../../../ui/src/test-utils";

const routerPush = mock(() => {});

mock.module("expo-router", () => ({router: {push: routerPush}}));

import {AdminProvider} from "../AdminProvider";
import {OrgSwitcher} from "./OrgSwitcher";
import {OrgContextProvider} from "./useOrgContext";

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

const setMine = (response: StubResponse): void => {
  routes.set("GET /orgs/mine", response);
};

describe("OrgSwitcher", () => {
  beforeEach(() => {
    calls.length = 0;
    routes.clear();
    setMine({body: {data: []}});
    routerPush.mockClear();
    installFetch();
  });

  afterEach(() => {
    for (const resolve of pendingResolvers.splice(0)) {
      resolve();
    }
    globalThis.fetch = originalFetch;
  });

  it("shows a spinner while /orgs/mine is loading", () => {
    setMine({pending: true});
    const screen = renderOrg(
      <OrgContextProvider onOrganizationChange={mock(() => {})}>
        <OrgSwitcher />
      </OrgContextProvider>
    );

    expect(screen.queryByTestId("org-switcher")).toBeNull();
    expect(screen.queryByText("Organizations unavailable")).toBeNull();
  });

  it("renders the organization name for a single-org admin", async () => {
    setMine({body: {data: [{_id: "org-1", name: "Only Org"}]}});
    const changed = mock(() => {});
    const screen = renderOrg(
      <OrgContextProvider onOrganizationChange={changed}>
        <OrgSwitcher />
      </OrgContextProvider>
    );

    expect(await screen.findByText("Only Org")).toBeTruthy();
    expect(calls[0]).toMatchObject({method: "GET", url: "/orgs/mine"});
    assert.equal(screen.getByText("Organization").props.style.color, "#FFFFFF");
    await act(async () => {});
    expect(changed).toHaveBeenCalledWith({_id: "org-1", name: "Only Org"});
    fireEvent(screen.getByTestId("org-switcher-single-open"), "click");
    expect(routerPush).toHaveBeenCalledWith("/admin/orgs/org-1");
  });

  it("renders organizations from an unwrapped list response", async () => {
    setMine({body: [{_id: "org-1", name: "Only Org"}]});
    const changed = mock(() => {});
    const screen = renderOrg(
      <OrgContextProvider onOrganizationChange={changed}>
        <OrgSwitcher />
      </OrgContextProvider>
    );

    expect(await screen.findByText("Only Org")).toBeTruthy();
    await act(async () => {});
    expect(changed).toHaveBeenCalledWith({_id: "org-1", name: "Only Org"});
  });

  it("renders nothing when /orgs/mine returns 403", async () => {
    setMine({body: {title: "Forbidden"}, status: 403});
    const screen = renderOrg(
      <OrgContextProvider onOrganizationChange={mock(() => {})}>
        <OrgSwitcher />
      </OrgContextProvider>
    );
    await act(async () => {});
    await act(async () => {});

    expect(screen.queryByText("Organizations unavailable")).toBeNull();
    expect(screen.queryByTestId("org-switcher")).toBeNull();
    expect(screen.queryByTestId("org-switcher-single")).toBeNull();
  });

  it("shows unavailable text for non-403 /orgs/mine errors", async () => {
    setMine({body: {title: "boom"}, status: 500});
    const screen = renderOrg(
      <OrgContextProvider onOrganizationChange={mock(() => {})}>
        <OrgSwitcher />
      </OrgContextProvider>
    );

    expect(await screen.findByText("Organizations unavailable")).toBeTruthy();
  });

  it("auto-selects the first organization alphabetically when none is selected", async () => {
    setMine({
      body: {
        data: [
          {_id: "org-z", name: "Zulu Org"},
          {_id: "org-a", name: "Alpha Org"},
        ],
      },
    });
    const changed = mock(() => {});
    const screen = renderOrg(
      <OrgContextProvider onOrganizationChange={changed}>
        <OrgSwitcher />
      </OrgContextProvider>
    );

    await screen.findByTestId("web_dropdown_option_org-a");
    await act(async () => {});
    expect(changed).toHaveBeenCalledWith({_id: "org-a", name: "Alpha Org"});
  });

  it("selects an organization and navigates to its URL", async () => {
    setMine({
      body: {
        data: [
          {_id: "org-1", name: "First"},
          {_id: "org-2", name: "Second"},
        ],
      },
    });
    const changed = mock(() => {});
    const screen = renderOrg(
      <OrgContextProvider onOrganizationChange={changed}>
        <OrgSwitcher routeBase="/admin" />
      </OrgContextProvider>
    );

    const option = await screen.findByTestId("web_dropdown_option_org-2");
    assert.equal(screen.getByText("Organization").props.style.color, "#FFFFFF");
    await act(async () => {
      fireEvent(option, "press");
    });
    expect(changed).toHaveBeenCalledWith({_id: "org-2", name: "Second"});
    expect(routerPush).toHaveBeenCalledWith("/admin/orgs/org-2");
  });
});
