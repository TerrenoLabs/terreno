import {afterEach, describe, expect, it, mock} from "bun:test";
import {act, fireEvent} from "@testing-library/react-native";
import {type ScaledSize, ScrollView, StyleSheet, Text, useWindowDimensions} from "react-native";

import {renderWithTheme} from "../test-utils";
import {AccountSecurityScreen} from "./AccountSecurityScreen";
import type {AccountSecurityScreenProps} from "./securityTypes";

const NOW = new Date("2026-03-10T12:00:00.000Z");

const ALL_CARDS: AccountSecurityScreenProps = {
  linkedAccounts: {
    accounts: [{id: "acc-google", linkedAt: "2026-03-01T12:00:00.000Z", providerId: "google"}],
    providers: [{id: "google"}, {id: "github"}],
  },
  passkeys: {passkeys: []},
  password: {hasPassword: false, onSubmit: async (): Promise<void> => {}},
  sessions: {
    currentSessionId: "s-current",
    now: NOW,
    sessions: [{createdAt: "2026-03-01T12:00:00.000Z", id: "s-current"}],
  },
  twoFactor: {
    enabled: false,
    onStartEnroll: async (): Promise<{backupCodes: string[]; totpURI: string}> => ({
      backupCodes: [],
      totpURI: "",
    }),
    onVerify: async (): Promise<void> => {},
  },
};

const CARD_TEST_IDS = [
  "linked-accounts-card",
  "password-card",
  "passkeys-card",
  "two-factor-settings-card",
  "sessions-card",
];

/** The testIDs of every card on screen, in render order. */
const getRenderedCardOrder = (root: unknown): string[] => {
  const found: string[] = [];
  const visit = (node: unknown): void => {
    if (!node || typeof node !== "object") {
      return;
    }
    if (Array.isArray(node)) {
      node.forEach(visit);
      return;
    }
    const element = node as {children?: unknown; props?: {testID?: string}};
    const testID = element.props?.testID;
    if (testID && CARD_TEST_IDS.includes(testID) && !found.includes(testID)) {
      found.push(testID);
    }
    visit(element.children);
  };
  visit(root);
  return found;
};

type MockableUseWindowDimensions = (() => ScaledSize) & {
  mockImplementation: (impl: () => ScaledSize) => void;
};

/** bunSetup mocks useWindowDimensions at 375px wide; this changes the width for one test. */
const setWindowWidth = (width: number): void => {
  (useWindowDimensions as MockableUseWindowDimensions).mockImplementation(() => ({
    fontScale: 1,
    height: 1000,
    scale: 2,
    width,
  }));
};

/** The flattened style of the element with this testID. */
const getStyle = (element: {props: {style?: unknown}}): Record<string, unknown> => {
  return (StyleSheet.flatten(element.props.style as never) ?? {}) as Record<string, unknown>;
};

/** The side padding a flattened style applies, whichever padding key Box used; 0 when none. */
const getSidePadding = (style: Record<string, unknown>): unknown => {
  return style.paddingLeft ?? style.paddingHorizontal ?? style.padding ?? 0;
};

describe("AccountSecurityScreen", () => {
  afterEach(() => {
    setWindowWidth(375);
  });

  it("renders every card whose props are given, in order", () => {
    const {getByTestId, toJSON} = renderWithTheme(<AccountSecurityScreen {...ALL_CARDS} />);
    expect(getByTestId("account-security-screen")).toBeTruthy();
    expect(getByTestId("account-security-screen-title").props.children).toBe("Security");
    expect(getRenderedCardOrder(toJSON())).toEqual(CARD_TEST_IDS);
  });

  it("hides the passkey card when passkeys is undefined", () => {
    const {queryByTestId, getByTestId} = renderWithTheme(
      <AccountSecurityScreen {...ALL_CARDS} passkeys={undefined} />
    );
    expect(queryByTestId("passkeys-card")).toBeNull();
    expect(getByTestId("linked-accounts-card")).toBeTruthy();
    expect(getByTestId("sessions-card")).toBeTruthy();
  });

  it.each([
    ["linkedAccounts", "linked-accounts-card"],
    ["password", "password-card"],
    ["twoFactor", "two-factor-settings-card"],
    ["sessions", "sessions-card"],
  ] as const)("hides its card when %s is undefined", (prop, cardTestID) => {
    const {queryByTestId, toJSON} = renderWithTheme(
      <AccountSecurityScreen {...ALL_CARDS} {...{[prop]: undefined}} />
    );
    expect(queryByTestId(cardTestID)).toBeNull();
    expect(getRenderedCardOrder(toJSON())).toEqual(
      CARD_TEST_IDS.filter((testID) => testID !== cardTestID)
    );
  });

  it("groups linked accounts and password under sign-in methods only when either is given", () => {
    const withBoth = renderWithTheme(<AccountSecurityScreen {...ALL_CARDS} />);
    expect(withBoth.getByTestId("account-security-screen-sign-in-methods")).toBeTruthy();

    const withNeither = renderWithTheme(
      <AccountSecurityScreen passkeys={ALL_CARDS.passkeys} sessions={ALL_CARDS.sessions} />
    );
    expect(withNeither.queryByTestId("account-security-screen-sign-in-methods")).toBeNull();
  });

  it("shows an empty message when no card is enabled", () => {
    const {getByTestId} = renderWithTheme(<AccountSecurityScreen />);
    expect(getByTestId("account-security-screen-empty")).toBeTruthy();
  });

  it("shows a custom title, description, header, and trailing children", () => {
    const {getByTestId, getByText} = renderWithTheme(
      <AccountSecurityScreen
        {...ALL_CARDS}
        description="Manage how you sign in."
        header={<Text testID="custom-header">Ada Lovelace</Text>}
        title="Account security"
      >
        <Text testID="custom-card">Recovery email</Text>
      </AccountSecurityScreen>
    );
    expect(getByTestId("account-security-screen-title").props.children).toBe("Account security");
    expect(getByText("Manage how you sign in.")).toBeTruthy();
    expect(getByTestId("custom-header")).toBeTruthy();
    expect(getByTestId("custom-card")).toBeTruthy();
  });

  it("shows a loading state instead of the cards while loading", () => {
    const {getByTestId, queryByTestId} = renderWithTheme(
      <AccountSecurityScreen {...ALL_CARDS} isLoading />
    );
    const loading = getByTestId("account-security-screen-loading");
    expect(loading.props.accessibilityLabel ?? loading.props["aria-label"]).toBe(
      "Loading security settings"
    );
    for (const cardTestID of CARD_TEST_IDS) {
      expect(queryByTestId(cardTestID)).toBeNull();
    }
    expect(getByTestId("account-security-screen-title")).toBeTruthy();
  });

  it("shows a page error with a retry button instead of the cards", async () => {
    const onRetry = mock(() => {});
    const {getByTestId, queryByTestId} = renderWithTheme(
      <AccountSecurityScreen
        {...ALL_CARDS}
        error="Couldn't load your security settings."
        onRetry={onRetry}
      />
    );
    const error = getByTestId("account-security-screen-error");
    expect(error.props.role).toBe("alert");
    expect(getByTestId("account-security-screen-error-message").props.children).toBe(
      "Couldn't load your security settings."
    );
    for (const cardTestID of CARD_TEST_IDS) {
      expect(queryByTestId(cardTestID)).toBeNull();
    }
    await act(async () => {
      fireEvent.press(getByTestId("account-security-screen-retry"));
    });
    expect(onRetry).toHaveBeenCalledTimes(1);
  });

  it("omits the retry button when onRetry is not given", () => {
    const {getByTestId, queryByTestId} = renderWithTheme(
      <AccountSecurityScreen error="Something went wrong." />
    );
    expect(getByTestId("account-security-screen-error")).toBeTruthy();
    expect(queryByTestId("account-security-screen-retry")).toBeNull();
  });

  it("prefers the loading state over an error while a retry is in flight", () => {
    const {getByTestId, queryByTestId} = renderWithTheme(
      <AccountSecurityScreen error="Something went wrong." isLoading />
    );
    expect(getByTestId("account-security-screen-loading")).toBeTruthy();
    expect(queryByTestId("account-security-screen-error")).toBeNull();
  });

  it("renders without a Page wrapper when withPage is false", () => {
    const {getByTestId} = renderWithTheme(
      <AccountSecurityScreen {...ALL_CARDS} testID="settings-security" withPage={false} />
    );
    expect(getByTestId("settings-security")).toBeTruthy();
    expect(getByTestId("settings-security-title")).toBeTruthy();
    expect(getByTestId("passkeys-card")).toBeTruthy();
  });

  it("exposes the title as a level 1 heading and card titles as level 2", () => {
    const {getByTestId} = renderWithTheme(<AccountSecurityScreen {...ALL_CARDS} />);
    const title = getByTestId("account-security-screen-title");
    expect(title.props.role).toBe("heading");
    expect(title.props["aria-level"]).toBe(1);
    for (const cardTestID of CARD_TEST_IDS) {
      const cardTitle = getByTestId(`${cardTestID}-title`);
      expect(cardTitle.props.role).toBe("heading");
      expect(cardTitle.props["aria-level"]).toBe(2);
    }
  });

  it("scrolls inside its own Page by default", () => {
    const {UNSAFE_queryAllByType} = renderWithTheme(<AccountSecurityScreen {...ALL_CARDS} />);
    expect(UNSAFE_queryAllByType(ScrollView)).toHaveLength(1);
  });

  it("adds no scroll view with withPage false, leaving scrolling to the parent", () => {
    const {UNSAFE_queryAllByType} = renderWithTheme(
      <AccountSecurityScreen {...ALL_CARDS} withPage={false} />
    );
    expect(UNSAFE_queryAllByType(ScrollView)).toHaveLength(0);
  });

  it("drops side padding and insets its text on narrow windows, where cards run edge to edge", () => {
    setWindowWidth(768);
    const {getByTestId} = renderWithTheme(<AccountSecurityScreen {...ALL_CARDS} />);
    expect(getSidePadding(getStyle(getByTestId("account-security-screen")))).toBe(0);
    expect(getSidePadding(getStyle(getByTestId("account-security-screen-heading")))).toBe(16);
  });

  it("pads its sides on wide windows and does not inset its text", () => {
    setWindowWidth(1024);
    const {getByTestId} = renderWithTheme(<AccountSecurityScreen {...ALL_CARDS} />);
    expect(getSidePadding(getStyle(getByTestId("account-security-screen")))).toBe(16);
    expect(getSidePadding(getStyle(getByTestId("account-security-screen-heading")))).toBe(0);
  });

  it("leaves side padding to the parent on wide windows with withPage false", () => {
    setWindowWidth(1024);
    const {getByTestId} = renderWithTheme(
      <AccountSecurityScreen {...ALL_CARDS} withPage={false} />
    );
    expect(getSidePadding(getStyle(getByTestId("account-security-screen")))).toBe(0);
  });
});
