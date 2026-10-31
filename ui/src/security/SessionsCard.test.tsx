import {afterAll, beforeAll, describe, expect, it, jest, mock, spyOn} from "bun:test";
import {act, fireEvent, waitFor} from "@testing-library/react-native";
import {DateTime, Settings} from "luxon";
import {ActivityIndicator} from "react-native";

import {renderWithTheme} from "../test-utils";
import {SessionsCard} from "./SessionsCard";
import type {AccountSession} from "./securityTypes";

const NOW = new Date("2026-03-10T12:00:00.000Z");

const CHROME_MAC =
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/129.0.0.0 Safari/537.36";
const SAFARI_IPHONE =
  "Mozilla/5.0 (iPhone; CPU iPhone OS 17_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.5 Mobile/15E148 Safari/604.1";
const FIREFOX_WINDOWS =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64; rv:131.0) Gecko/20100101 Firefox/131.0";

const CURRENT: AccountSession = {
  createdAt: "2026-03-01T12:00:00.000Z",
  id: "s-current",
  ipAddress: "203.0.113.4",
  token: "tok-current",
  updatedAt: "2026-03-09T12:00:00.000Z",
  userAgent: CHROME_MAC,
};
const PHONE: AccountSession = {
  createdAt: new Date("2026-03-02T12:00:00.000Z"),
  id: "s-phone",
  ipAddress: "198.51.100.7",
  location: "Denver, US",
  token: "tok-phone",
  updatedAt: new Date("2026-03-10T11:55:00.000Z"),
  userAgent: SAFARI_IPHONE,
};
const WINDOWS: AccountSession = {
  createdAt: "2026-03-07T12:00:00.000Z",
  id: "s-windows",
  token: "tok-windows",
  updatedAt: "2026-03-08T12:00:00.000Z",
  userAgent: FIREFOX_WINDOWS,
};

const press = async (element: Parameters<typeof fireEvent.press>[0]): Promise<void> => {
  await act(async () => {
    fireEvent.press(element);
  });
};

const isDisabled = (element: {props: Record<string, unknown>}): boolean => {
  const state = element.props.accessibilityState as {disabled?: boolean} | undefined;
  return Boolean(state?.disabled);
};

describe("SessionsCard", () => {
  // Pin Luxon's locale so relative times can be asserted as literal English strings.
  const previousLocale = Settings.defaultLocale;
  beforeAll(() => {
    Settings.defaultLocale = "en-US";
  });
  afterAll(() => {
    Settings.defaultLocale = previousLocale;
  });

  it("shows each session's device, browser, location, sign-in and refresh times", () => {
    const {getByTestId} = renderWithTheme(
      <SessionsCard currentSessionId="s-current" now={NOW} sessions={[CURRENT, PHONE, WINDOWS]} />
    );
    expect(getByTestId("sessions-card-name-s-phone").props.children).toBe("Safari on iOS");
    expect(getByTestId("sessions-card-details-s-phone").props.children).toBe(
      "Denver, US · 198.51.100.7"
    );
    expect(getByTestId("sessions-card-signed-in-s-phone").props.children).toBe(
      "Signed in 8 days ago"
    );
    expect(getByTestId("sessions-card-activity-s-phone").props.children).toBe(
      "Last refreshed 5 minutes ago"
    );
    expect(getByTestId("sessions-card-name-s-windows").props.children).toBe("Firefox on Windows");
    expect(getByTestId("sessions-card-signed-in-s-windows").props.children).toBe(
      "Signed in 3 days ago"
    );
    expect(getByTestId("sessions-card-activity-s-windows").props.children).toBe(
      "Last refreshed 2 days ago"
    );
  });

  it("omits details and times when they are unknown", () => {
    const {getByTestId, queryByTestId} = renderWithTheme(
      <SessionsCard now={NOW} sessions={[{id: "s-bare"}]} />
    );
    expect(getByTestId("sessions-card-name-s-bare").props.children).toBe("Unknown device");
    expect(queryByTestId("sessions-card-details-s-bare")).toBeNull();
    expect(queryByTestId("sessions-card-signed-in-s-bare")).toBeNull();
    expect(queryByTestId("sessions-card-activity-s-bare")).toBeNull();
  });

  it("lists the current session first, marked This device, active now, and not revocable", () => {
    const onRevoke = mock((_session: AccountSession) => Promise.resolve());
    const {getByTestId, queryByTestId, toJSON} = renderWithTheme(
      <SessionsCard
        currentSessionId="s-current"
        now={NOW}
        onRevoke={onRevoke}
        sessions={[WINDOWS, PHONE, CURRENT]}
      />
    );
    expect(getByTestId("sessions-card-current-s-current")).toBeTruthy();
    expect(queryByTestId("sessions-card-current-s-phone")).toBeNull();
    expect(queryByTestId("sessions-card-revoke-s-current")).toBeNull();
    expect(getByTestId("sessions-card-revoke-s-phone")).toBeTruthy();
    expect(getByTestId("sessions-card-revoke-s-windows")).toBeTruthy();
    expect(getByTestId("sessions-card-activity-s-current").props.children).toBe("Active now");
    expect(getByTestId("sessions-card-signed-in-s-current").props.children).toBe(
      "Signed in 9 days ago"
    );

    // Others were passed oldest-first; the card lists the most recently refreshed first.
    const order = JSON.stringify(toJSON()).match(/sessions-card-row-s-[a-z]+/g);
    expect(order).toEqual([
      "sessions-card-row-s-current",
      "sessions-card-row-s-phone",
      "sessions-card-row-s-windows",
    ]);
  });

  it("identifies the current session by token", () => {
    const {getByTestId, queryByTestId} = renderWithTheme(
      <SessionsCard
        currentSessionToken="tok-phone"
        now={NOW}
        onRevoke={mock(() => Promise.resolve())}
        sessions={[CURRENT, PHONE]}
      />
    );
    expect(getByTestId("sessions-card-current-s-phone")).toBeTruthy();
    expect(queryByTestId("sessions-card-revoke-s-phone")).toBeNull();
    expect(getByTestId("sessions-card-revoke-s-current")).toBeTruthy();
  });

  it("recomputes relative times every minute when now is not passed", () => {
    jest.useFakeTimers();
    const clearIntervalSpy = spyOn(globalThis, "clearInterval");
    try {
      // bunSetup pins Date.now before each test; drive it from here instead.
      let currentMillis = NOW.getTime();
      globalThis.Date.now = mock(() => currentMillis);
      const view = renderWithTheme(<SessionsCard sessions={[PHONE]} />);
      expect(view.getByTestId("sessions-card-activity-s-phone").props.children).toBe(
        "Last refreshed 5 minutes ago"
      );

      currentMillis = DateTime.fromJSDate(NOW).plus({minutes: 10}).toMillis();
      act(() => {
        jest.advanceTimersByTime(59_999);
      });
      expect(view.getByTestId("sessions-card-activity-s-phone").props.children).toBe(
        "Last refreshed 5 minutes ago"
      );
      act(() => {
        jest.advanceTimersByTime(1);
      });
      expect(view.getByTestId("sessions-card-activity-s-phone").props.children).toBe(
        "Last refreshed 15 minutes ago"
      );

      const callsBeforeUnmount = clearIntervalSpy.mock.calls.length;
      view.unmount();
      expect(clearIntervalSpy.mock.calls.length).toBeGreaterThan(callsBeforeUnmount);
    } finally {
      clearIntervalSpy.mockRestore();
      jest.useRealTimers();
    }
  });

  it("does not tick when now is passed", () => {
    const setIntervalSpy = spyOn(globalThis, "setInterval");
    try {
      renderWithTheme(<SessionsCard now={NOW} sessions={[PHONE]} />);
      expect(setIntervalSpy.mock.calls.some(([, delay]) => delay === 60_000)).toBe(false);
    } finally {
      setIntervalSpy.mockRestore();
    }
  });

  it("revokes another session and names the button after it", async () => {
    const onRevoke = mock((_session: AccountSession) => Promise.resolve());
    const {getByTestId} = renderWithTheme(
      <SessionsCard
        currentSessionId="s-current"
        now={NOW}
        onRevoke={onRevoke}
        sessions={[CURRENT, PHONE]}
      />
    );
    const revoke = getByTestId("sessions-card-revoke-s-phone");
    expect(revoke.props.accessibilityLabel).toBe("Sign out Safari on iOS, signed in 8 days ago");
    await press(revoke);
    await waitFor(() => {
      expect(onRevoke).toHaveBeenCalledWith(PHONE);
    });
  });

  it("shows a spinner on the revoking row and disables the others until it settles", async () => {
    let resolveRevoke: () => void = () => {};
    const onRevoke = mock(
      (_session: AccountSession) =>
        new Promise<void>((resolve) => {
          resolveRevoke = resolve;
        })
    );
    const {getByTestId} = renderWithTheme(
      <SessionsCard
        currentSessionId="s-current"
        now={NOW}
        onRevoke={onRevoke}
        onRevokeOthers={mock(() => Promise.resolve())}
        sessions={[CURRENT, PHONE, WINDOWS]}
      />
    );
    await press(getByTestId("sessions-card-revoke-s-phone"));
    const revoking = getByTestId("sessions-card-revoke-s-phone");
    expect(revoking.findAllByType(ActivityIndicator).length).toBe(1);
    const other = getByTestId("sessions-card-revoke-s-windows");
    expect(isDisabled(other)).toBe(true);
    expect(other.findAllByType(ActivityIndicator).length).toBe(0);
    expect(isDisabled(getByTestId("sessions-card-revoke-others"))).toBe(true);

    await act(async () => {
      resolveRevoke();
    });
    await waitFor(() => {
      expect(isDisabled(getByTestId("sessions-card-revoke-s-windows"))).toBe(false);
    });
  });

  it("confirms Sign out everywhere else before calling onRevokeOthers", async () => {
    const onRevokeOthers = mock(() => Promise.resolve());
    const {getByTestId, queryByTestId} = renderWithTheme(
      <SessionsCard
        currentSessionId="s-current"
        now={NOW}
        onRevokeOthers={onRevokeOthers}
        sessions={[CURRENT, PHONE, WINDOWS]}
      />
    );
    await press(getByTestId("sessions-card-revoke-others"));
    expect(onRevokeOthers).not.toHaveBeenCalled();
    expect(getByTestId("sessions-card-confirm")).toBeTruthy();

    await press(getByTestId("sessions-card-confirm-submit"));
    await waitFor(() => {
      expect(onRevokeOthers).toHaveBeenCalledTimes(1);
    });
    expect(queryByTestId("sessions-card-confirm")).toBeNull();
  });

  it("does not sign out other sessions when the confirm is cancelled", async () => {
    const onRevokeOthers = mock(() => Promise.resolve());
    const {getByTestId, queryByTestId} = renderWithTheme(
      <SessionsCard
        currentSessionId="s-current"
        now={NOW}
        onRevokeOthers={onRevokeOthers}
        sessions={[CURRENT, PHONE]}
      />
    );
    await press(getByTestId("sessions-card-revoke-others"));
    await press(getByTestId("sessions-card-confirm-cancel"));
    expect(queryByTestId("sessions-card-confirm")).toBeNull();
    expect(onRevokeOthers).not.toHaveBeenCalled();
  });

  it("disables Sign out everywhere else when there are no other sessions", () => {
    const {getByTestId} = renderWithTheme(
      <SessionsCard
        currentSessionId="s-current"
        now={NOW}
        onRevokeOthers={mock(() => Promise.resolve())}
        sessions={[CURRENT]}
      />
    );
    expect(isDisabled(getByTestId("sessions-card-revoke-others"))).toBe(true);
    expect(getByTestId("sessions-card-no-others")).toBeTruthy();
  });

  it("shows a rejected callback's message as an alert", async () => {
    const warn = spyOn(console, "warn").mockImplementation(() => {});
    const onRevoke = mock((_session: AccountSession) =>
      Promise.reject(new Error("Session not found"))
    );
    const {getByTestId, getByText} = renderWithTheme(
      <SessionsCard
        currentSessionId="s-current"
        now={NOW}
        onRevoke={onRevoke}
        sessions={[CURRENT, PHONE]}
      />
    );
    await press(getByTestId("sessions-card-revoke-s-phone"));
    await waitFor(() => {
      expect(getByTestId("sessions-card-error")).toBeTruthy();
    });
    expect(getByTestId("sessions-card-error").props.role).toBe("alert");
    expect(getByText("Session not found")).toBeTruthy();
    warn.mockRestore();
  });

  it("falls back to a generic message when onRevokeOthers rejects without one", async () => {
    const warn = spyOn(console, "warn").mockImplementation(() => {});
    const {getByTestId, getByText} = renderWithTheme(
      <SessionsCard
        currentSessionId="s-current"
        now={NOW}
        onRevokeOthers={mock(() => Promise.reject(undefined))}
        sessions={[CURRENT, PHONE]}
      />
    );
    await press(getByTestId("sessions-card-revoke-others"));
    await press(getByTestId("sessions-card-confirm-submit"));
    await waitFor(() => {
      expect(getByText("Couldn't sign out your other sessions. Try again.")).toBeTruthy();
    });
    warn.mockRestore();
  });

  it("shows the error prop as an alert and disables buttons with disabled", () => {
    const {getByTestId, getByText} = renderWithTheme(
      <SessionsCard
        currentSessionId="s-current"
        disabled
        error="Sessions couldn't load."
        now={NOW}
        onRevoke={mock(() => Promise.resolve())}
        onRevokeOthers={mock(() => Promise.resolve())}
        sessions={[CURRENT, PHONE]}
      />
    );
    expect(getByTestId("sessions-card-error").props.role).toBe("alert");
    expect(getByText("Sessions couldn't load.")).toBeTruthy();
    expect(isDisabled(getByTestId("sessions-card-revoke-s-phone"))).toBe(true);
    expect(isDisabled(getByTestId("sessions-card-revoke-others"))).toBe(true);
  });

  it("shows an empty state with no sessions", () => {
    const {getByTestId} = renderWithTheme(<SessionsCard now={NOW} sessions={[]} />);
    expect(getByTestId("sessions-card-empty")).toBeTruthy();
  });
});
