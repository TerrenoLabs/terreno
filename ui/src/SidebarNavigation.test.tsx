import {afterAll, beforeEach, describe, expect, it, mock} from "bun:test";
import {fireEvent} from "@testing-library/react-native";
import React, {type ReactNode} from "react";
import {View} from "react-native";

import type {SidebarNavigationItem} from "./Common";
import {renderWithTheme} from "./test-utils";

interface MockChildrenProps {
  children?: ReactNode;
}

interface NavigatorContext {
  state: {index: number; routes: {key: string; name: string}[]};
  navigation: {navigate: (route: string) => void};
  descriptors: Record<string, {options: Record<string, unknown>}>;
}

const navigate = mock((_route: string) => {});

let navigatorContext: NavigatorContext = {
  descriptors: {},
  navigation: {navigate},
  state: {index: 0, routes: [{key: "home-key", name: "index"}]},
};

// bunSetup.ts mocks expo-router without Navigator.useContext, which
// SidebarNavigatorContent depends on. Restored in afterAll to avoid leaking
// into other test files.
mock.module("expo-router", () => ({
  Link: ({children, ...props}: MockChildrenProps) => React.createElement("Link", props, children),
  Navigator: Object.assign(
    ({children, ...props}: MockChildrenProps) => React.createElement("Navigator", props, children),
    {useContext: () => navigatorContext}
  ),
  router: {
    back: mock(() => {}),
    canGoBack: mock(() => true),
    navigate: mock(() => {}),
    push: mock(() => {}),
    replace: mock(() => {}),
  },
  Slot: ({children, ...props}: MockChildrenProps) => React.createElement("Slot", props, children),
  Stack: ({children, ...props}: MockChildrenProps) => React.createElement("Stack", props, children),
  Tabs: ({children, ...props}: MockChildrenProps) => React.createElement("Tabs", props, children),
  useLocalSearchParams: mock(() => ({})),
  useRouter: mock(() => ({
    back: mock(() => {}),
    canGoBack: mock(() => true),
    navigate: mock(() => {}),
    push: mock(() => {}),
    replace: mock(() => {}),
  })),
  useSegments: mock(() => []),
}));

import {SidebarNavigation, SidebarNavigationPanel} from "./SidebarNavigation";

afterAll(() => {
  mock.module("expo-router", () => ({
    Link: ({children, ...props}: MockChildrenProps) => React.createElement("Link", props, children),
    Navigator: ({children, ...props}: MockChildrenProps) =>
      React.createElement("Navigator", props, children),
    router: {
      back: mock(() => {}),
      canGoBack: mock(() => true),
      navigate: mock(() => {}),
      push: mock(() => {}),
      replace: mock(() => {}),
    },
    Slot: ({children, ...props}: MockChildrenProps) => React.createElement("Slot", props, children),
    Stack: ({children, ...props}: MockChildrenProps) =>
      React.createElement("Stack", props, children),
    Tabs: ({children, ...props}: MockChildrenProps) => React.createElement("Tabs", props, children),
    useLocalSearchParams: mock(() => ({})),
    useRouter: mock(() => ({
      back: mock(() => {}),
      canGoBack: mock(() => true),
      navigate: mock(() => {}),
      push: mock(() => {}),
      replace: mock(() => {}),
    })),
    useSegments: mock(() => []),
  }));
});

const topItems: SidebarNavigationItem[] = [
  {iconName: "house", label: "Home", route: "index"},
  {badge: 5, iconName: "bell", label: "Alerts", route: "alerts"},
  {badge: true, badgeStatus: "info", iconName: "envelope", label: "Inbox", route: "inbox"},
];

const bottomItems: SidebarNavigationItem[] = [
  {iconName: "gear", label: "Settings", route: "settings"},
];

describe("SidebarNavigationPanel", () => {
  it("renders every top and bottom item", () => {
    const onNavigate = mock((_route: string) => {});
    const {getByLabelText} = renderWithTheme(
      <SidebarNavigationPanel
        activeRoute="index"
        bottomItems={bottomItems}
        onNavigate={onNavigate}
        topItems={topItems}
      >
        {null}
      </SidebarNavigationPanel>
    );

    for (const item of [...topItems, ...bottomItems]) {
      expect(getByLabelText(item.label)).toBeTruthy();
    }
  });

  it("renders children next to the rail", () => {
    const {getByTestId} = renderWithTheme(
      <SidebarNavigationPanel
        activeRoute="index"
        bottomItems={bottomItems}
        onNavigate={mock((_route: string) => {})}
        topItems={topItems}
      >
        <View testID="panel-child" />
      </SidebarNavigationPanel>
    );

    expect(getByTestId("panel-child")).toBeTruthy();
  });

  it("calls onNavigate with the pressed item route", () => {
    const onNavigate = mock((_route: string) => {});
    const {getByLabelText} = renderWithTheme(
      <SidebarNavigationPanel
        activeRoute="index"
        bottomItems={bottomItems}
        onNavigate={onNavigate}
        topItems={topItems}
      >
        {null}
      </SidebarNavigationPanel>
    );

    fireEvent.press(getByLabelText("Settings"));
    expect(onNavigate).toHaveBeenCalledWith("settings");
  });

  it("hides labels while collapsed and shows them once hovered", () => {
    const {UNSAFE_getAllByType, queryByText, getByText} = renderWithTheme(
      <SidebarNavigationPanel
        activeRoute="index"
        bottomItems={bottomItems}
        onNavigate={mock((_route: string) => {})}
        topItems={topItems}
      >
        {null}
      </SidebarNavigationPanel>
    );

    expect(queryByText("Home")).toBeNull();

    const rail = UNSAFE_getAllByType(View).find(
      (node) => node.props.onMouseEnter !== undefined && node.props.onMouseLeave !== undefined
    );
    if (!rail) {
      throw new Error("expected the sidebar rail to expose hover handlers");
    }

    fireEvent(rail, "mouseEnter");
    expect(getByText("Home")).toBeTruthy();
    expect(getByText("Settings")).toBeTruthy();

    fireEvent(rail, "mouseLeave");
    expect(queryByText("Home")).toBeNull();
  });

  it("bolds the active label and leaves inactive labels unbolded", () => {
    const {UNSAFE_getAllByType, getByText} = renderWithTheme(
      <SidebarNavigationPanel
        activeRoute="alerts"
        bottomItems={bottomItems}
        onNavigate={mock((_route: string) => {})}
        topItems={topItems}
      >
        {null}
      </SidebarNavigationPanel>
    );

    const rail = UNSAFE_getAllByType(View).find((node) => node.props.onMouseEnter !== undefined);
    if (!rail) {
      throw new Error("expected the sidebar rail to expose hover handlers");
    }
    fireEvent(rail, "mouseEnter");

    const fontFamilyOf = (label: string): unknown =>
      Object.assign(
        {},
        ...(Array.isArray(getByText(label).props.style)
          ? getByText(label).props.style.flat(Number.POSITIVE_INFINITY)
          : [getByText(label).props.style])
      ).fontFamily;

    expect(fontFamilyOf("Alerts")).not.toBe(fontFamilyOf("Home"));
    expect(String(fontFamilyOf("Alerts"))).toContain("bold");
  });

  it("applies hover styling to individual items", () => {
    const {getByLabelText} = renderWithTheme(
      <SidebarNavigationPanel
        activeRoute="index"
        bottomItems={bottomItems}
        onNavigate={mock((_route: string) => {})}
        topItems={topItems}
      >
        {null}
      </SidebarNavigationPanel>
    );

    const item = getByLabelText("Alerts");
    const flatten = (style: unknown): Record<string, unknown> =>
      Object.assign({}, ...(Array.isArray(style) ? style : [style]));

    const initialBackground = flatten(item.props.style).backgroundColor;
    fireEvent(item, "hoverIn");
    expect(flatten(getByLabelText("Alerts").props.style).backgroundColor).not.toBe(
      initialBackground
    );

    fireEvent(item, "hoverOut");
    expect(flatten(getByLabelText("Alerts").props.style).backgroundColor).toBe(initialBackground);
  });

  it("applies custom panel and item styles", () => {
    const {getByLabelText, UNSAFE_getAllByType} = renderWithTheme(
      <SidebarNavigationPanel
        activeRoute="index"
        bottomItems={bottomItems}
        itemStyle={{opacity: 0.5}}
        onNavigate={mock((_route: string) => {})}
        panelStyle={{borderRightWidth: 4}}
        topItems={topItems}
      >
        {null}
      </SidebarNavigationPanel>
    );

    const rail = UNSAFE_getAllByType(View).find((node) => node.props.onMouseEnter !== undefined);
    expect(rail?.props.style).toContainEqual({borderRightWidth: 4});
    expect(getByLabelText("Home").props.style).toContainEqual({opacity: 0.5});
  });
});

describe("SidebarNavigation", () => {
  beforeEach(() => {
    navigate.mockClear();
    navigatorContext = {
      descriptors: {},
      navigation: {navigate},
      state: {index: 0, routes: [{key: "home-key", name: "index"}]},
    };
  });

  it("exposes Screen for per-screen options", () => {
    expect(SidebarNavigation.Screen).toBeDefined();
  });

  it("renders the sidebar for the active navigator route", () => {
    const {getByLabelText} = renderWithTheme(
      <SidebarNavigation bottomItems={bottomItems} topItems={topItems} />
    );

    expect(getByLabelText("Home")).toBeTruthy();
    expect(getByLabelText("Settings")).toBeTruthy();
  });

  it("navigates through the navigator and forwards the route to onNavigate", () => {
    const onNavigate = mock((_route: string) => {});
    const {getByLabelText} = renderWithTheme(
      <SidebarNavigation bottomItems={bottomItems} onNavigate={onNavigate} topItems={topItems} />
    );

    fireEvent.press(getByLabelText("Alerts"));
    expect(navigate).toHaveBeenCalledWith("alerts");
    expect(onNavigate).toHaveBeenCalledWith("alerts");
  });

  it("navigates without an onNavigate callback", () => {
    const {getByLabelText} = renderWithTheme(
      <SidebarNavigation bottomItems={bottomItems} topItems={topItems} />
    );

    fireEvent.press(getByLabelText("Inbox"));
    expect(navigate).toHaveBeenCalledWith("inbox");
  });

  it("renders the header with the screen title and header slots", () => {
    navigatorContext = {
      descriptors: {
        "home-key": {
          options: {
            headerLeft: () => <View testID="header-left" />,
            headerRight: () => <View testID="header-right" />,
            title: "Dashboard",
          },
        },
      },
      navigation: {navigate},
      state: {index: 0, routes: [{key: "home-key", name: "index"}]},
    };

    const {getByTestId, getByText} = renderWithTheme(
      <SidebarNavigation bottomItems={bottomItems} topItems={topItems} />
    );

    expect(getByText("Dashboard")).toBeTruthy();
    expect(getByTestId("header-left")).toBeTruthy();
    expect(getByTestId("header-right")).toBeTruthy();
  });

  it("omits the header when the active screen has no title or header slots", () => {
    const {queryByText} = renderWithTheme(
      <SidebarNavigation bottomItems={bottomItems} topItems={topItems} />
    );

    expect(queryByText("Dashboard")).toBeNull();
  });

  it("renders Screen children passed to the navigator", () => {
    const {getByTestId} = renderWithTheme(
      <SidebarNavigation bottomItems={bottomItems} topItems={topItems}>
        <View testID="screen-child" />
      </SidebarNavigation>
    );

    expect(getByTestId("screen-child")).toBeTruthy();
  });

  it("handles an empty navigator route list", () => {
    navigatorContext = {
      descriptors: {},
      navigation: {navigate},
      state: {index: 0, routes: []},
    };

    const {getByLabelText} = renderWithTheme(
      <SidebarNavigation bottomItems={bottomItems} topItems={topItems} />
    );

    expect(getByLabelText("Home")).toBeTruthy();
  });
});
