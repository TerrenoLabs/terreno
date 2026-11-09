import {afterEach, beforeEach, describe, expect, it, mock} from "bun:test";
import {Unifier} from "@terreno/ui";
import {act, fireEvent, waitFor} from "@testing-library/react-native";
import React from "react";
import {renderWithTheme} from "../../../ui/src/test-utils";
import {AdminProvider} from "../AdminProvider";
import {MemberSecurityPanel, type MemberSecurityPanelProps} from "./MemberSecurityPanel";
import {
  type MemberSecuritySummary,
  memberSecurityPath,
  resolveSecurityActionRequest,
  securityActionParams,
} from "./useMemberSecurityApi";

const SECURITY_URL = "http://api.test/orgs/org-1/members/user-1/security";

interface RecordedCall {
  method: string;
  url: string;
}

interface StubResponse {
  body: unknown;
  status?: number;
}

const baseSummary = (): MemberSecuritySummary => ({
  actions: [
    {destructive: true, id: "reset-two-factor", label: "Reset two-factor"},
    {destructive: true, id: "remove-passkey", label: "Remove passkey"},
    {destructive: true, id: "unlink-provider", label: "Unlink provider"},
    {destructive: true, id: "revoke-sessions", label: "Sign out everywhere"},
    {destructive: false, id: "send-password-reset", label: "Send password reset"},
    {destructive: true, id: "suspend-membership", label: "Suspend membership"},
    // A future server action this frontend has never heard of.
    {destructive: true, id: "lock-account", label: "Lock account"},
  ],
  betterAuthLinked: true,
  disabled: false,
  emailVerified: true,
  lastSignIn: {at: "2026-10-22T18:04:11.000Z", method: "github"},
  legacyPassword: false,
  passkeys: {
    count: 1,
    items: [{createdAt: "2026-10-02T09:30:00.000Z", id: "pk_1", name: "Work laptop"}],
  },
  password: true,
  providers: [{linkedAt: "2026-10-01T12:00:00.000Z", providerId: "github"}],
  sessions: {active: 2},
  twoFactor: {backupCodesRemaining: 8, enabled: true},
  userId: "user-1",
});

const jsonResponse = ({body, status = 200}: StubResponse): Response =>
  new Response(JSON.stringify(body), {headers: {"Content-Type": "application/json"}, status});

describe("MemberSecurityPanel", () => {
  const originalFetch = globalThis.fetch;
  let calls: RecordedCall[];
  let summary: MemberSecuritySummary;
  let summaryResponse: StubResponse | undefined;
  let actionResponse: StubResponse;

  beforeEach(() => {
    calls = [];
    summary = baseSummary();
    summaryResponse = undefined;
    actionResponse = {body: {data: {action: "x", changed: true}}};
    globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      const method = init?.method ?? "GET";
      calls.push({method, url});
      if (method === "GET") {
        return jsonResponse(summaryResponse ?? {body: {data: summary}});
      }
      return jsonResponse(actionResponse);
    }) as typeof fetch;
  });

  afterEach(() => {
    globalThis.fetch = originalFetch;
  });

  const renderPanel = (props: Partial<MemberSecurityPanelProps> = {}) =>
    renderWithTheme(
      <AdminProvider
        apiBase="/admin"
        apiOrigin="http://api.test"
        getAuthHeaders={async () => ({authorization: "Bearer test"})}
        routeBase="/admin"
      >
        <MemberSecurityPanel memberLabel="Ada" orgId="org-1" userId="user-1" {...props} />
      </AdminProvider>
    );

  const renderLoaded = async (props: Partial<MemberSecurityPanelProps> = {}) => {
    const screen = renderPanel(props);
    await waitFor(() => {
      expect(screen.getByTestId("member-security-panel-two-factor-status")).toBeTruthy();
    });
    return screen;
  };

  const actionCalls = (): RecordedCall[] => calls.filter((call) => call.method !== "GET");
  const summaryCalls = (): RecordedCall[] => calls.filter((call) => call.method === "GET");

  it("renders the summary and every action the server lists, including unknown ones", async () => {
    const screen = await renderLoaded();

    expect(summaryCalls()[0]?.url).toBe(SECURITY_URL);
    expect(screen.getByText("Security: Ada")).toBeTruthy();
    expect(screen.getByText("On, 8 backup codes left")).toBeTruthy();
    expect(screen.getByText("2 active")).toBeTruthy();
    expect(screen.getByText("Password: set")).toBeTruthy();
    expect(screen.getByText("GitHub")).toBeTruthy();
    expect(screen.getByText("Email verified")).toBeTruthy();
    expect(screen.getByTestId("member-security-panel-action-reset-two-factor")).toBeTruthy();
    expect(screen.getByTestId("member-security-panel-action-revoke-sessions")).toBeTruthy();
    expect(screen.getByTestId("member-security-panel-action-remove-passkey-pk_1")).toBeTruthy();
    expect(screen.getByTestId("member-security-panel-action-unlink-provider-github")).toBeTruthy();
    expect(screen.getByTestId("member-security-panel-action-send-password-reset")).toBeTruthy();
    expect(screen.getByTestId("member-security-panel-action-suspend-membership")).toBeTruthy();
    expect(screen.getByTestId("member-security-panel-action-lock-account")).toBeTruthy();
    expect(screen.getByText("Lock account")).toBeTruthy();
  });

  it("hides actions the server leaves out and shows empty and disabled states", async () => {
    summary = {
      ...baseSummary(),
      actions: [],
      disabled: true,
      emailVerified: false,
      lastSignIn: {at: null, method: null},
      passkeys: {count: 0, items: []},
      password: false,
      providers: [],
      sessions: {active: 0},
      twoFactor: {backupCodesRemaining: null, enabled: false},
    };
    const screen = await renderLoaded();

    expect(screen.getByText("Off")).toBeTruthy();
    expect(screen.getByText("Disabled")).toBeTruthy();
    expect(screen.getByText("Email not verified")).toBeTruthy();
    expect(screen.getByText("No linked providers")).toBeTruthy();
    expect(screen.getByText("No passkeys")).toBeTruthy();
    expect(screen.getByText("No sign-in recorded")).toBeTruthy();
    expect(screen.queryByTestId("member-security-panel-action-reset-two-factor")).toBeNull();
    expect(screen.queryByText("Actions")).toBeNull();
  });

  it("confirms a destructive action, calls its route, shows the result, and refetches", async () => {
    actionResponse = {body: {data: {action: "reset-two-factor", changed: true}}};
    const onActionComplete = mock(() => {});
    const screen = await renderLoaded({onActionComplete});

    await act(async () => {
      fireEvent(screen.getByTestId("member-security-panel-action-reset-two-factor"), "click");
    });
    expect(actionCalls()).toHaveLength(0);
    expect(screen.getByText("Reset two-factor?")).toBeTruthy();

    summary = {
      ...baseSummary(),
      actions: [],
      twoFactor: {backupCodesRemaining: null, enabled: false},
    };
    await act(async () => {
      fireEvent.press(screen.getByTestId("member-security-panel-confirm.primary"));
    });

    await waitFor(() => {
      expect(screen.getByText("Two-factor reset")).toBeTruthy();
      expect(screen.getByText("Off")).toBeTruthy();
    });
    expect(actionCalls()).toEqual([{method: "POST", url: `${SECURITY_URL}/reset-two-factor`}]);
    expect(summaryCalls()).toHaveLength(2);
    expect(onActionComplete).toHaveBeenCalledWith({action: "reset-two-factor", changed: true});
  });

  it("cancelling the confirm modal runs nothing", async () => {
    const screen = await renderLoaded();

    await act(async () => {
      fireEvent(screen.getByTestId("member-security-panel-action-revoke-sessions"), "click");
    });
    await act(async () => {
      fireEvent.press(screen.getByTestId("member-security-panel-confirm.secondary"));
    });

    expect(actionCalls()).toHaveLength(0);
    expect(screen.queryByText("Sign out everywhere?")).toBeNull();
  });

  it("unlinks a provider with DELETE and warns that its sessions are not ended", async () => {
    actionResponse = {
      body: {
        data: {
          accountCount: 1,
          action: "unlink-provider",
          changed: true,
          passwordResetSent: false,
          providerId: "github",
        },
      },
    };
    const screen = await renderLoaded();

    await act(async () => {
      fireEvent(screen.getByTestId("member-security-panel-action-unlink-provider-github"), "click");
    });
    expect(screen.getByText(/Sessions they started with GitHub are not ended/)).toBeTruthy();
    await act(async () => {
      fireEvent.press(screen.getByTestId("member-security-panel-confirm.primary"));
    });

    await waitFor(() => {
      expect(
        screen.getByText(/GitHub unlinked\. Sessions started with it are still active/)
      ).toBeTruthy();
    });
    expect(actionCalls()).toEqual([{method: "DELETE", url: `${SECURITY_URL}/accounts/github`}]);
  });

  it("removes one passkey with DELETE and reports the reset email", async () => {
    actionResponse = {
      body: {
        data: {action: "remove-passkey", changed: true, passkeyId: "pk_1", passwordResetSent: true},
      },
    };
    const screen = await renderLoaded();

    await act(async () => {
      fireEvent(screen.getByTestId("member-security-panel-action-remove-passkey-pk_1"), "click");
    });
    expect(screen.getByText(/Remove the passkey "Work laptop"/)).toBeTruthy();
    await act(async () => {
      fireEvent.press(screen.getByTestId("member-security-panel-confirm.primary"));
    });

    await waitFor(() => {
      expect(screen.getByText(/Passkey removed\. A password reset email was sent/)).toBeTruthy();
    });
    expect(actionCalls()).toEqual([{method: "DELETE", url: `${SECURITY_URL}/passkeys/pk_1`}]);
  });

  it("runs a non-destructive action without confirming", async () => {
    actionResponse = {body: {data: {action: "send-password-reset", changed: true, sent: true}}};
    const screen = await renderLoaded();

    await act(async () => {
      fireEvent(screen.getByTestId("member-security-panel-action-send-password-reset"), "click");
    });

    await waitFor(() => {
      expect(screen.getByText("Password reset email sent")).toBeTruthy();
    });
    expect(actionCalls()).toEqual([{method: "POST", url: `${SECURITY_URL}/send-password-reset`}]);
  });

  it("confirms an unknown action with generic copy and posts to its id", async () => {
    actionResponse = {body: {data: {action: "lock-account", changed: true}}};
    const screen = await renderLoaded();

    await act(async () => {
      fireEvent(screen.getByTestId("member-security-panel-action-lock-account"), "click");
    });
    expect(screen.getByText(/Run "Lock account" on this account\?/)).toBeTruthy();
    await act(async () => {
      fireEvent.press(screen.getByTestId("member-security-panel-confirm.primary"));
    });

    await waitFor(() => {
      expect(screen.getByText("Lock account: done")).toBeTruthy();
    });
    expect(actionCalls()).toEqual([{method: "POST", url: `${SECURITY_URL}/lock-account`}]);
  });

  it("uses the method and path the server sends for an action", async () => {
    summary = {
      ...baseSummary(),
      actions: [
        {
          destructive: false,
          id: "rotate-keys",
          label: "Rotate keys",
          method: "patch",
          path: "/keys",
        },
      ],
    };
    actionResponse = {body: {data: {action: "rotate-keys", changed: false}}};
    const screen = await renderLoaded();

    await act(async () => {
      fireEvent(screen.getByTestId("member-security-panel-action-rotate-keys"), "click");
    });

    await waitFor(() => {
      expect(screen.getByText("Rotate keys: nothing to change")).toBeTruthy();
    });
    expect(actionCalls()).toEqual([{method: "PATCH", url: `${SECURITY_URL}/keys`}]);
  });

  it("offers an unknown action only when the summary can fill its path params", async () => {
    summary = {
      ...baseSummary(),
      actions: [
        // No summary item carries a deviceId, so there is nothing to fill it with.
        {
          destructive: true,
          id: "revoke-device",
          label: "Revoke device",
          method: "DELETE",
          path: "/devices/:deviceId",
        },
        // A passkey id comes from each passkey row.
        {
          destructive: false,
          id: "rename-passkey",
          label: "Rename passkey",
          method: "POST",
          path: "/passkeys/:passkeyId/rename",
        },
      ],
    };
    actionResponse = {body: {data: {action: "rename-passkey", changed: true}}};
    const screen = await renderLoaded();

    expect(screen.queryByText("Revoke device")).toBeNull();
    expect(screen.queryByTestId("member-security-panel-action-revoke-device")).toBeNull();
    const rename = screen.getByTestId("member-security-panel-action-rename-passkey-pk_1");
    expect(screen.getByLabelText("Rename passkey: Work laptop")).toBeTruthy();
    await act(async () => {
      fireEvent(rename, "click");
    });

    await waitFor(() => {
      expect(screen.getByText("Rename passkey: done")).toBeTruthy();
    });
    expect(actionCalls()).toEqual([{method: "POST", url: `${SECURITY_URL}/passkeys/pk_1/rename`}]);
  });

  it("names per-item buttons after their item for screen readers", async () => {
    const screen = await renderLoaded();

    expect(screen.getByLabelText("Remove passkey Work laptop")).toBeTruthy();
    expect(screen.getByLabelText("Unlink GitHub")).toBeTruthy();
    expect(screen.getByTestId("member-security-panel-heading")).toBeTruthy();
  });

  it("keeps the summary and the result when a refetch fails", async () => {
    actionResponse = {body: {data: {action: "send-password-reset", changed: true}}};
    const screen = await renderLoaded();
    summaryResponse = {body: {title: "Member not found"}, status: 404};

    await act(async () => {
      fireEvent(screen.getByTestId("member-security-panel-action-send-password-reset"), "click");
    });

    await waitFor(() => {
      expect(screen.getByTestId("member-security-panel-refresh-error")).toBeTruthy();
    });
    expect(screen.getByText("Member not found")).toBeTruthy();
    expect(screen.getByTestId("member-security-panel-refresh-error").props.role).toBe("alert");
    expect(screen.getByTestId("member-security-panel-result").props.role).toBe("status");
    expect(screen.getByText("Password reset email sent")).toBeTruthy();
    expect(screen.getByTestId("member-security-panel-two-factor-status")).toBeTruthy();
    expect(screen.queryByTestId("member-security-panel-error")).toBeNull();
  });

  it("shows the server's error title inline as an alert", async () => {
    actionResponse = {body: {title: "Cannot remove the last sign-in method"}, status: 409};
    const screen = await renderLoaded();

    await act(async () => {
      fireEvent(screen.getByTestId("member-security-panel-action-unlink-provider-github"), "click");
    });
    await act(async () => {
      fireEvent.press(screen.getByTestId("member-security-panel-confirm.primary"));
    });

    await waitFor(() => {
      expect(screen.getByText("Cannot remove the last sign-in method")).toBeTruthy();
    });
    expect(screen.getByTestId("member-security-panel-action-error").props.role).toBe("alert");
    expect(summaryCalls()).toHaveLength(1);
  });

  it("shows a returned link once with a copy button and a single-use warning", async () => {
    summary = {
      ...baseSummary(),
      actions: [{destructive: false, id: "issue-sign-in-link", label: "Issue sign-in link"}],
    };
    actionResponse = {
      body: {
        data: {
          action: "issue-sign-in-link",
          changed: true,
          expiresAt: "2026-10-23T18:00:00.000Z",
          url: "https://app.test/reset-password?token=abc",
        },
      },
    };
    const screen = await renderLoaded({orgId: undefined});

    await act(async () => {
      fireEvent(screen.getByTestId("member-security-panel-action-issue-sign-in-link"), "click");
    });

    await waitFor(() => {
      expect(screen.getByText("https://app.test/reset-password?token=abc")).toBeTruthy();
    });
    expect(screen.getByText("Sign-in link issued")).toBeTruthy();
    expect(screen.getByText(/This link works once and expires/)).toBeTruthy();
    expect(actionCalls()).toEqual([
      {method: "POST", url: "http://api.test/users/user-1/security/issue-sign-in-link"},
    ]);
    const originalCopy = Unifier.utils.copyToClipboard;
    const copy = mock((_text: string) => {});
    Unifier.utils.copyToClipboard = copy;
    try {
      await act(async () => {
        fireEvent(screen.getByTestId("member-security-panel-link-copy"), "click");
      });
    } finally {
      Unifier.utils.copyToClipboard = originalCopy;
    }
    expect(copy).toHaveBeenCalledWith("https://app.test/reset-password?token=abc");
    expect(screen.getByText("Copied")).toBeTruthy();
    expect(screen.getByText("Link copied to the clipboard")).toBeTruthy();
    expect(screen.getByTestId("member-security-panel-link-copied").props.role).toBe("status");
  });

  it("suspending a membership reports it and stops reading the now out-of-reach member", async () => {
    actionResponse = {
      body: {
        data: {
          action: "suspend-membership",
          changed: true,
          membershipId: "m-1",
          status: "suspended",
        },
      },
    };
    const onActionComplete = mock(() => {});
    const screen = await renderLoaded({onActionComplete});

    await act(async () => {
      fireEvent(screen.getByTestId("member-security-panel-action-suspend-membership"), "click");
    });
    await act(async () => {
      fireEvent.press(screen.getByTestId("member-security-panel-confirm.primary"));
    });

    await waitFor(() => {
      expect(screen.getByText(/Membership suspended/)).toBeTruthy();
    });
    expect(summaryCalls()).toHaveLength(1);
    expect(screen.queryByTestId("member-security-panel-two-factor-status")).toBeNull();
    expect(onActionComplete).toHaveBeenCalledTimes(1);
  });

  it("disables and enables an account on the platform routes", async () => {
    summary = {
      ...baseSummary(),
      actions: [
        {destructive: true, id: "disable", label: "Disable account"},
        {destructive: false, id: "enable", label: "Enable account"},
      ],
    };
    actionResponse = {body: {data: {action: "disable", changed: true, revokedCount: 2}}};
    const screen = await renderLoaded({orgId: undefined});

    await act(async () => {
      fireEvent(screen.getByTestId("member-security-panel-action-disable"), "click");
    });
    expect(screen.getByText(/The account is disabled and signed out on every device/)).toBeTruthy();
    await act(async () => {
      fireEvent.press(screen.getByTestId("member-security-panel-confirm.primary"));
    });
    await waitFor(() => {
      expect(screen.getByText("Account disabled")).toBeTruthy();
    });

    actionResponse = {body: {data: {action: "enable", changed: true}}};
    await act(async () => {
      fireEvent(screen.getByTestId("member-security-panel-action-enable"), "click");
    });
    await waitFor(() => {
      expect(screen.getByText("Account enabled")).toBeTruthy();
    });
    expect(actionCalls()).toEqual([
      {method: "POST", url: "http://api.test/users/user-1/security/disable"},
      {method: "POST", url: "http://api.test/users/user-1/security/enable"},
    ]);
  });

  it("reports how many sessions were revoked", async () => {
    actionResponse = {body: {data: {action: "revoke-sessions", changed: true, revokedCount: 1}}};
    const screen = await renderLoaded();

    await act(async () => {
      fireEvent(screen.getByTestId("member-security-panel-action-revoke-sessions"), "click");
    });
    await act(async () => {
      fireEvent.press(screen.getByTestId("member-security-panel-confirm.primary"));
    });

    await waitFor(() => {
      expect(screen.getByText("Signed out of 1 session")).toBeTruthy();
    });
  });

  it("shows the load error title", async () => {
    summaryResponse = {
      body: {title: "Only org-admins of this organization can manage member security"},
      status: 403,
    };
    const screen = renderPanel();

    await waitFor(() => {
      expect(
        screen.getByText("Only org-admins of this organization can manage member security")
      ).toBeTruthy();
    });
    expect(screen.getByTestId("member-security-panel-error").props.role).toBe("alert");
  });

  it("shows a spinner while loading and closes from the header", async () => {
    const onClose = mock(() => {});
    const screen = renderPanel({onClose});

    expect(screen.getByTestId("member-security-panel-loading")).toBeTruthy();
    await waitFor(() => {
      expect(screen.getByTestId("member-security-panel-two-factor-status")).toBeTruthy();
    });
    await act(async () => {
      fireEvent(screen.getByTestId("member-security-panel-close"), "click");
    });
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it("falls back to the same-origin client outside an AdminProvider", async () => {
    const originalFetch = globalThis.fetch;
    const requested: string[] = [];
    globalThis.fetch = (async (input: RequestInfo | URL) => {
      requested.push(String(input));
      return new Response(JSON.stringify({title: "Nope"}), {
        headers: {"Content-Type": "application/json"},
        status: 403,
      });
    }) as typeof fetch;
    try {
      renderWithTheme(<MemberSecurityPanel orgId="org-1" userId="user-1" />);

      await waitFor(() => {
        expect(requested).toContain("/orgs/org-1/members/user-1/security");
      });
    } finally {
      globalThis.fetch = originalFetch;
    }
  });
});

describe("useMemberSecurityApi helpers", () => {
  it("builds org and platform security paths", () => {
    expect(memberSecurityPath({orgId: "o 1", userId: "u/1"})).toBe(
      "/orgs/o%201/members/u%2F1/security"
    );
    expect(memberSecurityPath({userId: "u1"})).toBe("/users/u1/security");
    expect(memberSecurityPath({baseURL: "/api/users", userId: "u1"})).toBe(
      "/api/users/u1/security"
    );
    expect(memberSecurityPath({baseURL: "/teams", orgId: "o1", userId: "u1"})).toBe(
      "/teams/o1/members/u1/security"
    );
  });

  it("fills path params and refuses to send a request with one missing", () => {
    const action = {destructive: true, id: "remove-passkey", label: "Remove passkey"};

    expect(securityActionParams(action)).toEqual(["passkeyId"]);
    expect(resolveSecurityActionRequest({action, params: {passkeyId: "pk 1"}})).toEqual({
      method: "DELETE",
      path: "/passkeys/pk%201",
    });
    expect(() => resolveSecurityActionRequest({action})).toThrow("remove-passkey needs passkeyId");
  });

  it("leaves unknown actions that need a param out of the action list", async () => {
    expect(
      securityActionParams({destructive: false, id: "x", label: "X", path: "/things/:thingId"})
    ).toEqual(["thingId"]);
  });
});
