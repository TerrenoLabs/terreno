import {afterEach, beforeEach, describe, expect, it, mock} from "bun:test";
import {act, fireEvent, waitFor} from "@testing-library/react-native";
import React from "react";
import {renderWithTheme} from "../../../ui/src/test-utils";

mock.module("expo-router", () => ({
  router: {push: mock(() => {})},
}));

import {AdminProvider} from "../AdminProvider";
import {OrgDirectoryScreen} from "./OrgDirectoryScreen";
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
let responder: (call: FetchCall) => StubResponse = () => ({body: {data: []}});
const originalFetch = globalThis.fetch;

/** Routes the real `useOrganizationsApi` fetch client through an in-memory responder. */
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
    const {body, pending, status = 200} = responder(call);
    if (pending) {
      await new Promise<void>((resolve) => {
        pendingResolvers.push(resolve);
      });
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

const ACME = {_id: "org-1", disabled: false, name: "Acme", slug: "acme"};

const respondWithList = (list: unknown): void => {
  responder = (call) => {
    if (call.method === "GET") {
      return {body: list};
    }
    return {body: {data: {}}};
  };
};

describe("OrgDirectoryScreen", () => {
  beforeEach(() => {
    calls.length = 0;
    respondWithList({data: []});
    installFetch();
  });

  afterEach(() => {
    for (const resolve of pendingResolvers.splice(0)) {
      resolve();
    }
    globalThis.fetch = originalFetch;
  });

  it("is hidden and skips loading organizations for non-operators", async () => {
    const screen = renderOrg(
      <OrgDirectoryScreen isOperator={false} onEnterOrganization={mock(() => {})} />
    );
    await act(async () => {});

    expect(screen.queryByText("Organizations")).toBeNull();
    expect(calls).toHaveLength(0);
  });

  it("renders loading, error, and empty states", async () => {
    responder = () => ({pending: true});
    const loading = renderOrg(
      <OrgDirectoryScreen isOperator onEnterOrganization={mock(() => {})} />
    );
    expect(loading.getByTestId("org-directory-loading")).toBeTruthy();
    loading.unmount();

    responder = () => ({body: {title: "boom"}, status: 500});
    const failed = renderOrg(
      <OrgDirectoryScreen isOperator onEnterOrganization={mock(() => {})} />
    );
    expect(await failed.findByText("Could not load organizations.")).toBeTruthy();
    failed.unmount();

    respondWithList({data: []});
    const empty = renderOrg(<OrgDirectoryScreen isOperator onEnterOrganization={mock(() => {})} />);
    expect(await empty.findByText("No organizations yet.")).toBeTruthy();
    expect(calls.at(-1)).toMatchObject({method: "GET", url: "/orgs"});
  });

  it("creates an organization and renders directory rows", async () => {
    respondWithList({data: [ACME]});
    const screen = renderOrg(
      <OrgDirectoryScreen isOperator onEnterOrganization={mock(() => {})} />
    );

    expect(await screen.findByText("Acme")).toBeTruthy();
    await act(async () => {
      fireEvent.press(screen.getByTestId("org-directory-create"));
    });
    await act(async () => {
      fireEvent.changeText(screen.getByTestId("org-directory-name"), "New Org");
    });
    await act(async () => {
      fireEvent.press(screen.getByText("Create"));
    });
    await waitFor(() => {
      expect(calls.find((call) => call.method === "POST")).toMatchObject({
        body: {name: "New Org"},
        url: "/orgs",
      });
    });
  });

  it("renders directory rows from an unwrapped list response", async () => {
    respondWithList([ACME]);
    const screen = renderOrg(
      <OrgDirectoryScreen isOperator onEnterOrganization={mock(() => {})} />
    );

    expect(await screen.findByText("Acme")).toBeTruthy();
    expect(screen.getByTestId("org-directory-table")).toBeTruthy();
  });

  it("opens, disables, and re-enables an organization from its row", async () => {
    const onEnterOrganization = mock(() => {});
    respondWithList({data: [ACME]});
    const screen = renderOrg(
      <OrgDirectoryScreen isOperator onEnterOrganization={onEnterOrganization} />
    );

    fireEvent(await screen.findByLabelText("Open"), "click");
    expect(onEnterOrganization).toHaveBeenCalledWith(ACME);
    await act(async () => {
      fireEvent(screen.getByLabelText("Disable"), "click");
    });
    await waitFor(() => {
      expect(calls.find((call) => call.method === "PATCH")).toMatchObject({
        body: {disabled: true},
        headers: {"x-organization-id": "org-1"},
        url: "/orgs/org-1",
      });
    });

    screen.unmount();
    calls.length = 0;
    respondWithList({data: [{...ACME, disabled: true}]});
    const disabledScreen = renderOrg(
      <OrgDirectoryScreen isOperator onEnterOrganization={onEnterOrganization} />
    );
    const reEnable = await disabledScreen.findByLabelText("Re-enable");
    await act(async () => {
      fireEvent(reEnable, "click");
    });
    await waitFor(() => {
      expect(calls.find((call) => call.method === "PATCH")).toMatchObject({
        body: {disabled: false},
        url: "/orgs/org-1",
      });
    });
  });

  it("shows an error when disabling an organization fails", async () => {
    responder = (call) =>
      call.method === "GET" ? {body: {data: [ACME]}} : {body: {title: "nope"}, status: 500};
    const screen = renderOrg(
      <OrgDirectoryScreen isOperator onEnterOrganization={mock(() => {})} />
    );

    const disable = await screen.findByLabelText("Disable");
    await act(async () => {
      fireEvent(disable, "click");
    });
    expect(await screen.findByText("Could not disable organization.")).toBeTruthy();
  });

  it("selects the opened organization in OrgContextProvider without a host callback", async () => {
    respondWithList({data: [ACME]});
    const selectedIds: string[] = [];
    const SelectedOrganizationProbe: React.FC = () => {
      const {organizationId} = useOrgContext();
      if (organizationId) {
        selectedIds.push(organizationId);
      }
      return null;
    };
    const screen = renderOrg(
      <OrgContextProvider>
        <SelectedOrganizationProbe />
        <OrgDirectoryScreen isOperator onEnterOrganization={mock(() => {})} />
      </OrgContextProvider>
    );

    fireEvent(await screen.findByLabelText("Open"), "click");
    expect(selectedIds.at(-1)).toBe("org-1");
  });
});
