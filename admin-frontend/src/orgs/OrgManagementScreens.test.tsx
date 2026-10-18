import {afterEach, beforeEach, describe, expect, it, mock} from "bun:test";
import {act, fireEvent, waitFor} from "@testing-library/react-native";
import {assert} from "chai";
import React from "react";
import {renderWithTheme} from "../../../ui/src/test-utils";

const routerPush = mock(() => {});

mock.module("expo-router", () => ({router: {push: routerPush}}));

import {AdminProvider} from "../AdminProvider";
import {OrgMembersScreen} from "./OrgMembersScreen";
import {OrgSettingsScreen} from "./OrgSettingsScreen";

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

const findCall = (method: string, url: string): FetchCall | undefined =>
  calls.find((call) => call.method === method && call.url === url);

const MEMBERSHIP = {
  _id: "membership-1",
  roleName: "org-admin",
  status: "active",
  userId: {_id: "user-1", email: "admin@example.com", name: "Admin"},
};

describe("organization management screens", () => {
  beforeEach(() => {
    calls.length = 0;
    routes.clear();
    routes.set("GET /orgs/org-1", {
      body: {data: {_id: "org-1", name: "Acme", settings: {region: "us"}}},
    });
    routes.set("GET /orgs/org-1/members", {body: {data: [MEMBERSHIP]}});
    routerPush.mockClear();
    installFetch();
  });

  afterEach(() => {
    for (const resolve of pendingResolvers.splice(0)) {
      resolve();
    }
    globalThis.fetch = originalFetch;
  });

  it("shows a spinner while organization settings are loading", () => {
    routes.set("GET /orgs/org-1", {pending: true});
    const screen = renderOrg(<OrgSettingsScreen organizationId="org-1" routeBase="/admin" />);

    assert.isNull(screen.queryByTestId("org-settings-save"));
    assert.isNull(screen.queryByText("Could not load organization settings."));
  });

  it("shows a spinner while the read still serves a previous organization id", async () => {
    routes.set("GET /orgs/org-1", {body: {data: {_id: "org-old", name: "Old Org", settings: {}}}});
    const screen = renderOrg(<OrgSettingsScreen organizationId="org-1" routeBase="/admin" />);
    await waitFor(() => {
      assert.isDefined(findCall("GET", "/orgs/org-1"));
    });
    await act(async () => {});

    assert.isNull(screen.queryByTestId("org-settings-save"));
    assert.isNull(screen.queryByText("Could not load organization settings."));
  });

  it("reads the organization with its X-Organization-Id header", async () => {
    const screen = renderOrg(<OrgSettingsScreen organizationId="org-1" routeBase="/admin" />);

    expect(await screen.findByTestId("org-settings-save")).toBeTruthy();
    expect(findCall("GET", "/orgs/org-1")?.headers["x-organization-id"]).toBe("org-1");
  });

  it("shows the backend load error title when settings fail to load", async () => {
    routes.set("GET /orgs/org-1", {body: {title: "Organization not found"}, status: 404});
    const screen = renderOrg(<OrgSettingsScreen organizationId="org-1" routeBase="/admin" />);

    assert.isNotNull(await screen.findByText("Organization not found"));
  });

  it("shows the fallback load error when the organization is missing", async () => {
    routes.set("GET /orgs/org-1", {status: 204});
    const screen = renderOrg(<OrgSettingsScreen organizationId="org-1" routeBase="/admin" />);

    assert.isNotNull(await screen.findByText("Could not load organization settings."));
  });

  it("navigates to members from Manage members", async () => {
    const screen = renderOrg(<OrgSettingsScreen organizationId="org-1" routeBase="/admin" />);

    fireEvent(await screen.findByText("Manage members"), "click");
    assert.equal(routerPush.mock.calls.length, 1);
    assert.equal(routerPush.mock.calls[0]?.[0], "/admin/orgs/org-1/members");
  });

  it("rejects invalid settings JSON before saving", async () => {
    const screen = renderOrg(<OrgSettingsScreen organizationId="org-1" routeBase="/admin" />);
    const jsonField = await screen.findByTestId("org-settings-json");

    await act(async () => {
      fireEvent.changeText(jsonField, "[1,2,3]");
    });
    await act(async () => {
      fireEvent(screen.getByTestId("org-settings-save"), "click");
    });
    assert.isNotNull(screen.getByText("Settings must be a JSON object."));
    assert.isUndefined(findCall("PATCH", "/orgs/org-1"));

    await act(async () => {
      fireEvent.changeText(screen.getByTestId("org-settings-json"), "{bad-json");
    });
    await act(async () => {
      fireEvent(screen.getByTestId("org-settings-save"), "click");
    });
    assert.isNotNull(screen.getByText("Settings must be valid JSON."));
    assert.isUndefined(findCall("PATCH", "/orgs/org-1"));
  });

  it("shows the backend save error title when settings fail to persist", async () => {
    routes.set("PATCH /orgs/org-1", {body: {title: "Slug already taken"}, status: 409});
    const screen = renderOrg(<OrgSettingsScreen organizationId="org-1" routeBase="/admin" />);
    const save = await screen.findByTestId("org-settings-save");

    await act(async () => {
      fireEvent(save, "click");
    });
    await waitFor(() => {
      assert.equal(screen.getByTestId("org-settings-error").props.children, "Slug already taken");
    });
  });

  it("saves organization settings and shows the billing placeholder", async () => {
    const screen = renderOrg(<OrgSettingsScreen organizationId="org-1" routeBase="/admin" />);
    expect(await screen.findByText("Billing is not available yet.")).toBeTruthy();
    await act(async () => {
      fireEvent.changeText(screen.getByTestId("org-settings-name"), "Acme Updated");
      fireEvent.changeText(screen.getByTestId("org-settings-json"), '{"region":"eu"}');
    });
    await act(async () => {
      fireEvent(screen.getByTestId("org-settings-save"), "click");
    });
    await waitFor(() => {
      expect(findCall("PATCH", "/orgs/org-1")).toMatchObject({
        body: {name: "Acme Updated", settings: {region: "eu"}},
        headers: {"x-organization-id": "org-1"},
      });
    });
  });

  it("shows disabled Invite and attaches an existing user", async () => {
    const screen = renderOrg(<OrgMembersScreen organizationId="org-1" />);
    expect(await screen.findByText("admin@example.com")).toBeTruthy();
    expect(screen.getByLabelText("Invite").props.accessibilityState.disabled).toBe(true);
    // Invite is a disabled placeholder; its handler is a no-op until invitations ship.
    screen.UNSAFE_getByProps({text: "Invite"}).props.onClick();
    expect(findCall("GET", "/orgs/org-1/members")?.headers["x-organization-id"]).toBe("org-1");
    await act(async () => {
      fireEvent(screen.getByTestId("org-members-add"), "click");
    });
    await act(async () => {
      fireEvent.changeText(screen.getByTestId("org-members-email"), "New@Example.com");
    });
    await act(async () => {
      fireEvent.press(screen.getByText("Add member"));
    });
    await waitFor(() => {
      expect(findCall("POST", "/orgs/org-1/members")).toMatchObject({
        body: {email: "new@example.com", roleName: "member"},
        headers: {"x-organization-id": "org-1"},
      });
    });
  });

  it("renders members from an unwrapped list response", async () => {
    routes.set("GET /orgs/org-1/members", {body: [MEMBERSHIP]});
    const screen = renderOrg(<OrgMembersScreen organizationId="org-1" />);

    expect(await screen.findByText("admin@example.com")).toBeTruthy();
    expect(screen.getByTestId("org-members-table")).toBeTruthy();
  });

  it("changes a member role", async () => {
    const screen = renderOrg(<OrgMembersScreen organizationId="org-1" />);
    const makeMember = await screen.findByLabelText("Make member");

    await act(async () => {
      fireEvent(makeMember, "click");
    });
    await waitFor(() => {
      expect(findCall("PATCH", "/orgs/org-1/members/membership-1")).toMatchObject({
        body: {roleName: "member"},
        headers: {"x-organization-id": "org-1"},
      });
    });
  });

  it("shows the backend last-admin error", async () => {
    routes.set("PATCH /orgs/org-1/members/membership-1", {
      body: {title: "Cannot remove the last org-admin"},
      status: 409,
    });
    const screen = renderOrg(<OrgMembersScreen organizationId="org-1" />);
    const makeMember = await screen.findByLabelText("Make member");

    await act(async () => {
      fireEvent(makeMember, "click");
    });
    expect(await screen.findByText("Cannot remove the last org-admin")).toBeTruthy();
  });

  it("shows attach errors inside the open modal", async () => {
    routes.set("POST /orgs/org-1/members", {body: {title: "User not found"}, status: 404});
    const screen = renderOrg(<OrgMembersScreen organizationId="org-1" />);
    const add = await screen.findByTestId("org-members-add");
    await act(async () => {
      fireEvent(add, "click");
    });
    await act(async () => {
      fireEvent.changeText(screen.getByTestId("org-members-email"), "missing@example.com");
    });
    await act(async () => {
      fireEvent.press(screen.getByText("Add member"));
    });
    await waitFor(() => {
      expect(screen.getByTestId("org-members-add-modal")).toBeTruthy();
      expect(screen.getByText("User not found")).toBeTruthy();
    });
  });

  it("removes a member from the row action", async () => {
    const screen = renderOrg(<OrgMembersScreen organizationId="org-1" />);
    const remove = await screen.findByLabelText("Remove");
    await act(async () => {
      fireEvent(remove, "click");
    });
    await waitFor(() => {
      const call = findCall("DELETE", "/orgs/org-1/members/membership-1");
      expect(call?.headers["x-organization-id"]).toBe("org-1");
      expect(call?.body).toBeUndefined();
    });
  });

  it("shows the remove error and members load error", async () => {
    routes.set("DELETE /orgs/org-1/members/membership-1", {
      body: {title: "Remove blocked"},
      status: 409,
    });
    const screen = renderOrg(<OrgMembersScreen organizationId="org-1" />);
    const remove = await screen.findByLabelText("Remove");
    await act(async () => {
      fireEvent(remove, "click");
    });
    expect(await screen.findByText("Remove blocked")).toBeTruthy();
    screen.unmount();

    routes.set("GET /orgs/org-1/members", {body: {title: "boom"}, status: 500});
    const failed = renderOrg(<OrgMembersScreen organizationId="org-1" />);
    expect(await failed.findByText("Could not load organization members.")).toBeTruthy();
  });

  it("requires an email before attaching and clears the modal on cancel", async () => {
    routes.set("GET /orgs/org-1/members", {
      body: {data: [{...MEMBERSHIP, roleName: "member", userId: "user-2"}]},
    });
    const screen = renderOrg(<OrgMembersScreen organizationId="org-1" />);
    expect(await screen.findByText("user-2")).toBeTruthy();
    await act(async () => {
      fireEvent(screen.getByTestId("org-members-add"), "click");
    });
    await act(async () => {
      fireEvent.press(screen.getByText("Add member"));
    });
    expect(screen.getByText("Email is required.")).toBeTruthy();
    await act(async () => {
      fireEvent.press(screen.getByText("Cancel"));
    });
    expect(screen.queryByText("Email is required.")).toBeNull();
    assert.isUndefined(findCall("POST", "/orgs/org-1/members"));
  });
});
