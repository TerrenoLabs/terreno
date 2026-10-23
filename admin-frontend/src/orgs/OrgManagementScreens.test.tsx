import {beforeEach, describe, expect, it, mock} from "bun:test";
import {act, fireEvent, waitFor} from "@testing-library/react-native";
import {assert} from "chai";
import React from "react";
import {renderWithTheme} from "../../../ui/src/test-utils";

const readState: {
  data?: unknown;
  error?: unknown;
  isFetching: boolean;
  isLoading: boolean;
} = {isFetching: false, isLoading: false};
const refetchMembers = mock(() => {});
const membersState: {
  data?: unknown;
  error?: unknown;
  isLoading: boolean;
  refetch?: () => void;
} = {isLoading: false, refetch: refetchMembers};
const updateOrganization = mock(() => ({unwrap: async () => ({})}));
const attachMember = mock(() => ({unwrap: async () => ({})}));
const updateMember = mock(() => ({unwrap: async () => ({})}));
const removeMember = mock(() => ({unwrap: async () => ({})}));
const routerPush = mock(() => {});

mock.module("expo-router", () => ({router: {push: routerPush}}));

import {AdminProvider} from "../AdminProvider";
import type {AdminApi} from "../types";
import {OrgMembersScreen} from "./OrgMembersScreen";
import {OrgSettingsScreen} from "./OrgSettingsScreen";

/**
 * Stands in for the host RTK Query API so the real `useOrganizationsApi` runs.
 * Mocking that module instead would leak process-wide and make the suite order-dependent.
 */
const createOrganizationsApi = (): AdminApi => {
  const api = {
    enhanceEndpoints: () => api,
    injectEndpoints: () => ({
      useOrgCreateMutation: () => [mock(() => ({unwrap: async () => ({})})), {isLoading: false}],
      useOrgDeleteMutation: () => [mock(() => ({})), {isLoading: false}],
      useOrgListQuery: () => ({isLoading: false}),
      useOrgMemberAttachMutation: () => [attachMember, {isLoading: false}],
      useOrgMemberRemoveMutation: () => [removeMember, {isLoading: false}],
      useOrgMembersQuery: () => membersState,
      useOrgMemberUpdateMutation: () => [updateMember, {isLoading: false}],
      useOrgMineQuery: () => ({isLoading: false}),
      useOrgReadQuery: () => readState,
      useOrgUpdateMutation: () => [updateOrganization, {isLoading: false}],
    }),
  };
  return api as unknown as AdminApi;
};

const api = createOrganizationsApi();

describe("organization management screens", () => {
  beforeEach(() => {
    readState.data = {data: {_id: "org-1", name: "Acme", settings: {region: "us"}}};
    readState.error = undefined;
    readState.isFetching = false;
    readState.isLoading = false;
    membersState.data = {
      data: [
        {
          _id: "membership-1",
          roleName: "org-admin",
          status: "active",
          userId: {_id: "user-1", email: "admin@example.com", name: "Admin"},
        },
      ],
    };
    membersState.error = undefined;
    membersState.isLoading = false;
    updateOrganization.mockClear();
    refetchMembers.mockClear();
    attachMember.mockClear();
    updateMember.mockClear();
    removeMember.mockClear();
    routerPush.mockClear();
    attachMember.mockImplementation(() => ({unwrap: async () => ({})}));
    updateMember.mockImplementation(() => ({unwrap: async () => ({})}));
    removeMember.mockImplementation(() => ({unwrap: async () => ({})}));
  });

  it("shows a spinner while organization settings are loading", () => {
    readState.isLoading = true;
    const screen = renderWithTheme(
      <OrgSettingsScreen api={api} organizationId="org-1" routeBase="/admin" />
    );

    assert.isNull(screen.queryByTestId("org-settings-save"));
    assert.isNull(screen.queryByText("Could not load organization settings."));
  });

  it("shows a spinner while RTK still serves a previous organization id", () => {
    readState.isLoading = false;
    readState.isFetching = false;
    readState.data = {data: {_id: "org-old", name: "Old Org", settings: {}}};
    const screen = renderWithTheme(
      <OrgSettingsScreen api={api} organizationId="org-1" routeBase="/admin" />
    );

    assert.isNull(screen.queryByTestId("org-settings-save"));
    assert.isNull(screen.queryByText("Could not load organization settings."));
  });

  it("shows the backend load error title when settings fail to load", () => {
    readState.isLoading = false;
    readState.data = undefined;
    readState.error = {data: {title: "Organization not found"}};
    const screen = renderWithTheme(
      <OrgSettingsScreen api={api} organizationId="org-1" routeBase="/admin" />
    );

    assert.isNotNull(screen.getByText("Organization not found"));
  });

  it("shows the fallback load error when the organization is missing", () => {
    readState.error = undefined;
    readState.data = undefined;
    const screen = renderWithTheme(
      <OrgSettingsScreen api={api} organizationId="org-1" routeBase="/admin" />
    );

    assert.isNotNull(screen.getByText("Could not load organization settings."));
  });

  it("navigates to members from Manage members", () => {
    const screen = renderWithTheme(
      <OrgSettingsScreen api={api} organizationId="org-1" routeBase="/admin" />
    );

    fireEvent(screen.getByText("Manage members"), "click");
    assert.equal(routerPush.mock.calls.length, 1);
    assert.equal(routerPush.mock.calls[0]?.[0], "/admin/orgs/org-1/members");
  });

  it("rejects invalid settings JSON before saving", async () => {
    const screen = renderWithTheme(
      <OrgSettingsScreen api={api} organizationId="org-1" routeBase="/admin" />
    );

    await act(async () => {
      fireEvent.changeText(screen.getByTestId("org-settings-json"), "[1,2,3]");
    });
    await act(async () => {
      fireEvent(screen.getByTestId("org-settings-save"), "click");
    });
    assert.isNotNull(screen.getByText("Settings must be a JSON object."));
    assert.equal(updateOrganization.mock.calls.length, 0);

    await act(async () => {
      fireEvent.changeText(screen.getByTestId("org-settings-json"), "{bad-json");
    });
    await act(async () => {
      fireEvent(screen.getByTestId("org-settings-save"), "click");
    });
    assert.isNotNull(screen.getByText("Settings must be valid JSON."));
    assert.equal(updateOrganization.mock.calls.length, 0);
  });

  it("shows the backend save error title when settings fail to persist", async () => {
    updateOrganization.mockImplementation(() => ({
      unwrap: async () => Promise.reject({data: {title: "Slug already taken"}}),
    }));
    const screen = renderWithTheme(
      <OrgSettingsScreen api={api} organizationId="org-1" routeBase="/admin" />
    );

    await act(async () => {
      fireEvent(screen.getByTestId("org-settings-save"), "click");
    });
    await waitFor(() => {
      assert.isNotNull(screen.getByTestId("org-settings-error"));
      assert.equal(screen.getByTestId("org-settings-error").props.children, "Slug already taken");
    });
  });

  it("saves organization settings and shows the billing placeholder", async () => {
    const screen = renderWithTheme(
      <OrgSettingsScreen api={api} organizationId="org-1" routeBase="/admin" />
    );
    expect(screen.getByText("Billing is not available yet.")).toBeTruthy();
    await act(async () => {
      fireEvent.changeText(screen.getByTestId("org-settings-name"), "Acme Updated");
      fireEvent.changeText(screen.getByTestId("org-settings-json"), '{"region":"eu"}');
    });
    await act(async () => {
      fireEvent(screen.getByTestId("org-settings-save"), "click");
    });
    expect(updateOrganization).toHaveBeenCalledWith({
      body: {name: "Acme Updated", settings: {region: "eu"}},
      id: "org-1",
    });
  });

  it("shows disabled Invite and attaches an existing user", async () => {
    const screen = renderWithTheme(<OrgMembersScreen api={api} organizationId="org-1" />);
    expect(screen.getByLabelText("Invite").props.accessibilityState.disabled).toBe(true);
    expect(screen.getByText("admin@example.com")).toBeTruthy();
    await act(async () => {
      fireEvent(screen.getByTestId("org-members-add"), "click");
    });
    await act(async () => {
      fireEvent.changeText(screen.getByTestId("org-members-email"), "New@Example.com");
    });
    await act(async () => {
      fireEvent.press(screen.getByText("Add member"));
    });
    expect(attachMember).toHaveBeenCalledWith({
      body: {email: "new@example.com", roleName: "member"},
      id: "org-1",
    });
  });

  it("renders members from RTK-unwrapped list data", () => {
    membersState.data = [
      {
        _id: "membership-1",
        roleName: "org-admin",
        status: "active",
        userId: {_id: "user-1", email: "admin@example.com", name: "Admin"},
      },
    ];
    const screen = renderWithTheme(<OrgMembersScreen api={api} organizationId="org-1" />);

    expect(screen.getByText("admin@example.com")).toBeTruthy();
    expect(screen.getByTestId("org-members-table")).toBeTruthy();
  });

  it("shows the backend last-admin error", async () => {
    updateMember.mockImplementation(() => ({
      unwrap: async () => Promise.reject({data: {title: "Cannot remove the last org-admin"}}),
    }));
    const screen = renderWithTheme(<OrgMembersScreen api={api} organizationId="org-1" />);

    await act(async () => {
      fireEvent(screen.getByLabelText("Make member"), "click");
    });
    await waitFor(() => {
      expect(screen.getByText("Cannot remove the last org-admin")).toBeTruthy();
    });
  });

  it("shows attach errors inside the open modal", async () => {
    attachMember.mockImplementation(() => ({
      unwrap: async () => Promise.reject({data: {title: "User not found"}}),
    }));
    const screen = renderWithTheme(<OrgMembersScreen api={api} organizationId="org-1" />);
    await act(async () => {
      fireEvent(screen.getByTestId("org-members-add"), "click");
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

  it("opens the security panel for an active member and closes it", async () => {
    const screen = renderWithTheme(<OrgMembersScreen api={api} organizationId="org-1" />);

    await act(async () => {
      fireEvent(screen.getByLabelText("Security for Admin"), "click");
    });
    expect(screen.getByTestId("org-members-security-panel")).toBeTruthy();
    expect(screen.getByText("Security: Admin")).toBeTruthy();

    await act(async () => {
      fireEvent(screen.getByTestId("org-members-security-panel-close"), "click");
    });
    expect(screen.queryByTestId("org-members-security-panel")).toBeNull();
  });

  it("reloads members after a security action", async () => {
    const originalFetch = globalThis.fetch;
    const summary = {
      actions: [{destructive: false, id: "send-password-reset", label: "Send password reset"}],
      betterAuthLinked: true,
      disabled: false,
      emailVerified: true,
      lastSignIn: {at: null, method: "email"},
      legacyPassword: false,
      passkeys: {count: 0, items: []},
      password: true,
      providers: [],
      sessions: {active: 1},
      twoFactor: {backupCodesRemaining: null, enabled: false},
      userId: "user-1",
    };
    const requested: string[] = [];
    globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
      requested.push(`${init?.method ?? "GET"} ${String(input)}`);
      const body =
        init?.method === "POST"
          ? {data: {action: "send-password-reset", changed: true}}
          : {data: summary};
      return new Response(JSON.stringify(body), {headers: {"Content-Type": "application/json"}});
    }) as typeof fetch;
    try {
      const screen = renderWithTheme(
        <AdminProvider api={api} apiBase="/admin" credentials="same-origin" routeBase="/admin">
          <OrgMembersScreen api={api} organizationId="org-1" />
        </AdminProvider>
      );
      await act(async () => {
        fireEvent(screen.getByTestId("org-members-security-user-1"), "click");
      });
      await waitFor(() => {
        expect(
          screen.getByTestId("org-members-security-panel-action-send-password-reset")
        ).toBeTruthy();
      });
      await act(async () => {
        fireEvent(
          screen.getByTestId("org-members-security-panel-action-send-password-reset"),
          "click"
        );
      });
      await waitFor(() => {
        expect(screen.getByText("Password reset email sent")).toBeTruthy();
      });
      expect(requested).toContain("POST /orgs/org-1/members/user-1/security/send-password-reset");
      expect(refetchMembers).toHaveBeenCalledTimes(1);
    } finally {
      globalThis.fetch = originalFetch;
    }
  });

  it("reactivates a suspended member instead of offering security", async () => {
    membersState.data = {
      data: [
        {
          _id: "membership-2",
          roleName: "member",
          status: "suspended",
          userId: {_id: "user-2", email: "member@example.com"},
        },
      ],
    };
    const screen = renderWithTheme(<OrgMembersScreen api={api} organizationId="org-1" />);

    expect(screen.queryByTestId("org-members-security-user-2")).toBeNull();
    await act(async () => {
      fireEvent(screen.getByTestId("org-members-reactivate-user-2"), "click");
    });
    expect(updateMember).toHaveBeenCalledWith({
      body: {status: "active"},
      id: "org-1",
      memberId: "membership-2",
    });
  });

  it("shows the reactivate error title", async () => {
    membersState.data = {
      data: [{_id: "membership-2", roleName: "member", status: "suspended", userId: "user-2"}],
    };
    updateMember.mockImplementation(() => ({
      unwrap: async () => Promise.reject({data: {title: "Membership not found"}}),
    }));
    const screen = renderWithTheme(<OrgMembersScreen api={api} organizationId="org-1" />);

    await act(async () => {
      fireEvent(screen.getByTestId("org-members-reactivate-user-2"), "click");
    });
    await waitFor(() => {
      expect(screen.getByText("Membership not found")).toBeTruthy();
    });
  });

  it("removes a member from the row action", async () => {
    const screen = renderWithTheme(<OrgMembersScreen api={api} organizationId="org-1" />);
    await act(async () => {
      fireEvent(screen.getByLabelText("Remove"), "click");
    });
    expect(removeMember).toHaveBeenCalledWith({
      body: {},
      id: "org-1",
      memberId: "membership-1",
    });
  });
});
