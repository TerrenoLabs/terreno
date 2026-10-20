import {afterAll, afterEach, beforeEach, describe, expect, it, type Mock, mock} from "bun:test";
import {act, fireEvent} from "@testing-library/react-native";
import * as expoRouterModule from "expo-router";
import {useEffect} from "react";
import {Text, useWindowDimensions} from "react-native";

import type {ListDetailState} from "./Common";
import {renderWithTheme} from "./test-utils";

// Other test files replace the global expo-router mock without every hook this layout reads,
// so this file installs its own route and router doubles and restores the original afterwards.
const originalExpoRouter = {...expoRouterModule};
const mockedPathname = mock((): string => "/");
const mockedSegments = mock((): string[] => []);
const mockedSearchParams = mock((): Record<string, string | string[] | undefined> => ({}));
const mockedRouter = {
  dismissTo: mock((_href: string): void => {}),
  push: mock((_href: string): void => {}),
  replace: mock((_href: string): void => {}),
};
mock.module("expo-router", () => ({
  ...originalExpoRouter,
  router: {...originalExpoRouter.router, ...mockedRouter},
  useGlobalSearchParams: mockedSearchParams,
  usePathname: mockedPathname,
  useSegments: mockedSegments,
}));

import {ListDetailIndex, ListDetailLayout, useListDetail} from "./ListDetailLayout";

const mockedWindowDimensions = useWindowDimensions as unknown as Mock<typeof useWindowDimensions>;

// Matches the bunSetup.ts default so other test files see an untouched mock.
const DEFAULT_WINDOW = {fontScale: 1, height: 812, scale: 2, width: 375};

const setWindowWidth = (width: number): void => {
  mockedWindowDimensions.mockImplementation(() => ({...DEFAULT_WINDOW, width}));
};

afterEach(() => {
  setWindowWidth(DEFAULT_WINDOW.width);
});

afterAll(() => {
  mockedWindowDimensions.mockImplementation(() => DEFAULT_WINDOW);
  mock.module("expo-router", () => originalExpoRouter);
});

const fireLayout = (element: Parameters<typeof fireEvent>[0], width: number): void => {
  act(() => {
    fireEvent(element, "layout", {nativeEvent: {layout: {height: 800, width, x: 0, y: 0}}});
  });
};

let latestState: ListDetailState | undefined;

const SplitProbe = (): React.ReactElement => {
  const state = useListDetail();
  latestState = state;
  return <Text testID="split-probe">{state.isSplit ? "split" : "stacked"}</Text>;
};

const currentState = (): ListDetailState => {
  if (!latestState) {
    throw new Error("SplitProbe has not rendered");
  }
  return latestState;
};

let stackChildMounts = 0;

// Rendered as a Stack child; a remounted Stack remounts it too.
const StackChild = (): React.ReactElement => {
  // Count mounts so the test can prove the Stack never remounts.
  useEffect(() => {
    stackChildMounts += 1;
  }, []);
  return <Text testID="stack-child">screen</Text>;
};

const renderLayout = (props: Partial<Parameters<typeof ListDetailLayout>[0]> = {}) => {
  return renderWithTheme(
    <ListDetailLayout
      detailHref={(id) => `/mail/${id}`}
      emptyDetail={<Text testID="mail-empty">Select a message</Text>}
      indexHref="/mail"
      list={<Text testID="mail-list">Inbox</Text>}
      {...props}
    >
      <StackChild />
      <SplitProbe />
      <ListDetailIndex />
    </ListDetailLayout>
  );
};

describe("ListDetailLayout", () => {
  beforeEach(() => {
    stackChildMounts = 0;
    setWindowWidth(375);
  });

  it("shows the list pane beside the Stack on a wide window", () => {
    setWindowWidth(1024);
    const {getByTestId} = renderLayout();

    const listPane = getByTestId("list-detail-list-pane");
    expect(listPane.props.style).toMatchObject({width: 360});
    expect(getByTestId("split-probe").props.children).toBe("split");
    // The Stack lives inside the detail pane, not the list pane.
    const isStack = (node: {type: unknown}): boolean => node.type === "Stack";
    expect(getByTestId("list-detail-detail-pane").findAll(isStack)).toHaveLength(1);
    expect(listPane.findAll(isStack)).toHaveLength(0);
    // The list pane comes before the detail pane.
    const paneIds = getByTestId("list-detail-layout")
      .findAll(
        (node) => typeof node.props.testID === "string" && node.props.testID.endsWith("-pane")
      )
      .map((node) => node.props.testID);
    expect(paneIds.indexOf("list-detail-list-pane")).toBeLessThan(
      paneIds.indexOf("list-detail-detail-pane")
    );
  });

  it("renders only the Stack on a phone-width window", () => {
    const {getByTestId, queryByTestId} = renderLayout();

    expect(queryByTestId("list-detail-list-pane")).toBeNull();
    expect(
      getByTestId("list-detail-detail-pane").findAll((node) => node.type === "Stack")
    ).toHaveLength(1);
    expect(getByTestId("split-probe").props.children).toBe("stacked");
  });

  it("uses the measured layout width over the window width", () => {
    setWindowWidth(1024);
    const {getByTestId, queryByTestId} = renderLayout();

    fireLayout(getByTestId("list-detail-layout"), 600);

    expect(queryByTestId("list-detail-list-pane")).toBeNull();
    expect(getByTestId("split-probe").props.children).toBe("stacked");
  });

  it("ignores zero-width layout events", () => {
    setWindowWidth(1024);
    const {getByTestId} = renderLayout();

    fireLayout(getByTestId("list-detail-layout"), 0);

    expect(getByTestId("list-detail-list-pane")).toBeTruthy();
  });

  it("splits at exactly the default 768 px", () => {
    const {getByTestId} = renderLayout();

    fireLayout(getByTestId("list-detail-layout"), 768);

    expect(getByTestId("list-detail-list-pane")).toBeTruthy();
  });

  it("stays stacked at 767 px", () => {
    const {getByTestId, queryByTestId} = renderLayout();

    fireLayout(getByTestId("list-detail-layout"), 767);

    expect(queryByTestId("list-detail-list-pane")).toBeNull();
  });

  it("respects a custom splitAtWidth and listWidth", () => {
    setWindowWidth(1024);
    const {getByTestId, queryByTestId} = renderLayout({listWidth: 280, splitAtWidth: 1200});

    expect(queryByTestId("list-detail-list-pane")).toBeNull();

    fireLayout(getByTestId("list-detail-layout"), 1300);

    expect(getByTestId("list-detail-list-pane").props.style).toMatchObject({width: 280});
  });

  it("never remounts the Stack when crossing the breakpoint", () => {
    setWindowWidth(1024);
    const {getByTestId, queryByTestId} = renderLayout();
    const root = getByTestId("list-detail-layout");

    fireLayout(root, 375);
    expect(queryByTestId("list-detail-list-pane")).toBeNull();
    fireLayout(root, 1024);
    expect(getByTestId("list-detail-list-pane")).toBeTruthy();

    expect(stackChildMounts).toBe(1);
  });

  it("passes screenOptions and children through to the Stack", () => {
    const screenOptions = {headerShown: false};
    const {getByTestId, UNSAFE_getByType} = renderLayout({screenOptions});

    expect(
      UNSAFE_getByType("Stack" as unknown as React.ComponentType).props.screenOptions
    ).toMatchObject({headerShown: false});
    expect(getByTestId("stack-child")).toBeTruthy();
  });

  it("draws the list pane divider from the theme", () => {
    setWindowWidth(1024);
    const {getByTestId} = renderLayout();

    const style = getByTestId("list-detail-list-pane").props.style;
    expect(style.borderRightWidth).toBe(1);
    // The default theme's border.default is the neutral300 primitive.
    expect(style.borderRightColor).toBe("#CDCDCD");
  });
});

describe("ListDetailIndex", () => {
  beforeEach(() => {
    setWindowWidth(375);
  });

  it("renders the list when stacked", () => {
    const {getByTestId, queryByTestId} = renderLayout();

    expect(getByTestId("mail-list")).toBeTruthy();
    expect(queryByTestId("list-detail-empty")).toBeNull();
  });

  it("renders the empty detail when split", () => {
    setWindowWidth(1024);
    const {getByTestId, getAllByTestId} = renderLayout();

    expect(getByTestId("list-detail-empty")).toBeTruthy();
    expect(getByTestId("mail-empty")).toBeTruthy();
    // The list renders once, in the list pane, not again in the index route.
    expect(getAllByTestId("mail-list")).toHaveLength(1);
  });

  it("renders an empty pane when split without emptyDetail", () => {
    setWindowWidth(1024);
    const {getByTestId} = renderLayout({emptyDetail: undefined});

    expect(getByTestId("list-detail-empty").props.children).toBeFalsy();
  });
});

describe("useListDetail", () => {
  it("throws outside a ListDetailLayout", () => {
    const originalError = console.error;
    console.error = (): void => {};
    try {
      expect(() => renderWithTheme(<SplitProbe />)).toThrow(
        "useListDetail must be used inside a ListDetailLayout"
      );
    } finally {
      console.error = originalError;
    }
  });
});

// Puts the router on a route: a pathname, its segments, and its params.
const setRoute = (
  pathname: string,
  segments: string[],
  params: Record<string, string | string[] | undefined> = {}
): void => {
  mockedPathname.mockImplementation(() => pathname);
  mockedSegments.mockImplementation(() => segments);
  mockedSearchParams.mockImplementation(() => params);
};

describe("useListDetail selection", () => {
  beforeEach(() => {
    latestState = undefined;
    setWindowWidth(375);
    setRoute("/mail", ["mail"]);
    mockedRouter.dismissTo.mockClear();
    mockedRouter.push.mockClear();
    mockedRouter.replace.mockClear();
  });

  afterAll(() => {
    // Restore the bunSetup.ts defaults for later test files.
    setRoute("/", []);
  });

  it("reads the selected id from the open detail route", () => {
    setRoute("/mail/3", ["mail", "[id]"], {id: "3"});
    renderLayout();

    expect(currentState().selectedId).toBe("3");
  });

  it("has no selection on the index route even when an id param exists", () => {
    setRoute("/mail", ["mail"], {id: "3"});
    renderLayout();

    expect(currentState().selectedId).toBeUndefined();
  });

  it("has no selection on a static sibling route at the detail's depth", () => {
    setRoute("/mail/compose", ["mail", "compose"], {id: "3"});
    renderLayout();

    expect(currentState().selectedId).toBeUndefined();
  });

  it("has no selection on a static sibling whose name matches its id param", () => {
    setRoute("/mail/compose", ["mail", "compose"], {id: "compose"});
    renderLayout();

    expect(currentState().selectedId).toBeUndefined();
  });

  it("has no selection when the id param is empty", () => {
    setRoute("/mail/", ["mail", "[id]"], {id: ""});
    renderLayout();

    expect(currentState().selectedId).toBeUndefined();
  });

  it("ignores an id from a parent dynamic segment", () => {
    setRoute("/orgs/9/mail", ["orgs", "[id]", "mail"], {id: "9"});
    renderLayout({indexHref: "/orgs/9/mail"});

    expect(currentState().selectedId).toBeUndefined();
  });

  it("ignores a detail route outside the group", () => {
    setRoute("/news/3", ["news", "[id]"], {id: "3"});
    renderLayout();

    expect(currentState().selectedId).toBeUndefined();
  });

  it("reads the selection inside a route group", () => {
    setRoute("/mail/3", ["(tabs)", "mail", "[id]"], {id: "3"});
    renderLayout();

    expect(currentState().selectedId).toBe("3");
  });

  it("keeps an id that contains a slash", () => {
    setRoute("/mail/a/b", ["mail", "[id]"], {id: "a/b"});
    renderLayout();

    expect(currentState().selectedId).toBe("a/b");
  });

  it("matches an id that the pathname encodes", () => {
    setRoute("/mail/a%20b", ["mail", "[id]"], {id: "a b"});
    renderLayout();

    expect(currentState().selectedId).toBe("a b");
  });

  it("ignores routes deeper than one segment below the index", () => {
    setRoute("/mail/3/attachments", ["mail", "[id]"], {id: "3"});
    renderLayout();

    expect(currentState().selectedId).toBeUndefined();
  });

  it("uses a custom detailRoute and paramName", () => {
    setRoute("/mail/7", ["mail", "[messageId]"], {id: "1", messageId: "7"});
    renderLayout({detailRoute: "[messageId]", paramName: "messageId"});

    expect(currentState().selectedId).toBe("7");
  });

  it("takes the first value of an array param", () => {
    setRoute("/mail/5", ["mail", "[id]"], {id: ["5", "6"]});
    renderLayout();

    expect(currentState().selectedId).toBe("5");
  });

  it("tolerates a trailing slash on indexHref", () => {
    setRoute("/mail/3", ["mail", "[id]"], {id: "3"});
    renderLayout({indexHref: "/mail/"});

    expect(currentState().selectedId).toBe("3");
  });

  it("pushes the detail route when stacked", () => {
    renderLayout();

    act(() => {
      currentState().select("4");
    });

    expect(mockedRouter.push).toHaveBeenCalledTimes(1);
    expect(mockedRouter.push).toHaveBeenCalledWith("/mail/4");
    expect(mockedRouter.replace).not.toHaveBeenCalled();
  });

  it("pushes the next detail when stacked with an item open", () => {
    setRoute("/mail/3", ["mail", "[id]"], {id: "3"});
    renderLayout();

    act(() => {
      currentState().select("4");
    });

    expect(mockedRouter.push).toHaveBeenCalledTimes(1);
    expect(mockedRouter.push).toHaveBeenCalledWith("/mail/4");
    expect(mockedRouter.replace).not.toHaveBeenCalled();
  });

  it("pushes the detail route when split with nothing open", () => {
    setWindowWidth(1024);
    renderLayout();

    act(() => {
      currentState().select("4");
    });

    expect(mockedRouter.push).toHaveBeenCalledWith("/mail/4");
    expect(mockedRouter.replace).not.toHaveBeenCalled();
  });

  it("replaces the open detail when split, keeping one detail on the stack", () => {
    setWindowWidth(1024);
    setRoute("/mail/3", ["mail", "[id]"], {id: "3"});
    renderLayout();

    act(() => {
      currentState().select("4");
    });

    expect(mockedRouter.replace).toHaveBeenCalledTimes(1);
    expect(mockedRouter.replace).toHaveBeenCalledWith("/mail/4");
    expect(mockedRouter.push).not.toHaveBeenCalled();
  });

  it("does nothing when split and the open item is selected again", () => {
    setWindowWidth(1024);
    setRoute("/mail/3", ["mail", "[id]"], {id: "3"});
    renderLayout();

    act(() => {
      currentState().select("3");
    });

    expect(mockedRouter.replace).not.toHaveBeenCalled();
    expect(mockedRouter.push).not.toHaveBeenCalled();
  });

  it("dismisses to the index to clear the open item", () => {
    setRoute("/mail/3", ["mail", "[id]"], {id: "3"});
    renderLayout();

    act(() => {
      currentState().clear();
    });

    expect(mockedRouter.dismissTo).toHaveBeenCalledTimes(1);
    expect(mockedRouter.dismissTo).toHaveBeenCalledWith("/mail");
  });

  it("does nothing on clear when no item is open", () => {
    renderLayout();

    act(() => {
      currentState().clear();
    });

    expect(mockedRouter.dismissTo).not.toHaveBeenCalled();
  });
});

describe("ListDetailLayout split screen options", () => {
  const stackOptions = (rendered: ReturnType<typeof renderLayout>): unknown => {
    return rendered.UNSAFE_getByType("Stack" as unknown as React.ComponentType).props.screenOptions;
  };

  beforeEach(() => {
    setWindowWidth(375);
  });

  it("hides the back button and the push animation when split", () => {
    setWindowWidth(1024);
    const options = stackOptions(renderLayout()) as Record<string, unknown>;

    expect(options.animation).toBe("none");
    expect(options.headerBackVisible).toBe(false);
    // The web header ignores headerBackVisible, so an empty headerLeft hides its back button.
    expect((options.headerLeft as () => unknown)()).toBeNull();
  });

  it("leaves screen options untouched when stacked", () => {
    expect(stackOptions(renderLayout())).toBeUndefined();
    expect(stackOptions(renderLayout({screenOptions: {title: "Inbox"}}))).toEqual({
      title: "Inbox",
    });
  });

  it("lets the caller's screen options win when split", () => {
    setWindowWidth(1024);
    const rendered = renderLayout({screenOptions: {animation: "fade", title: "Inbox"}});

    expect(stackOptions(rendered)).toMatchObject({
      animation: "fade",
      headerBackVisible: false,
      title: "Inbox",
    });
  });

  it("merges into function screen options when split", () => {
    setWindowWidth(1024);
    const rendered = renderLayout({screenOptions: () => ({animation: "fade", title: "Inbox"})});
    const options = stackOptions(rendered) as (props: unknown) => Record<string, unknown>;

    expect(options({})).toMatchObject({
      animation: "fade",
      headerBackVisible: false,
      title: "Inbox",
    });
  });

  it("keeps the caller's headerLeft when split", () => {
    setWindowWidth(1024);
    const headerLeft = (): string => "menu";
    const options = stackOptions(renderLayout({screenOptions: {headerLeft}})) as Record<
      string,
      unknown
    >;

    expect(options.headerLeft).toBe(headerLeft);
  });
});

describe("ListDetailLayout across the breakpoint", () => {
  beforeEach(() => {
    latestState = undefined;
    stackChildMounts = 0;
    setWindowWidth(1024);
    setRoute("/mail/3", ["mail", "[id]"], {id: "3"});
    mockedRouter.dismissTo.mockClear();
    mockedRouter.push.mockClear();
    mockedRouter.replace.mockClear();
  });

  afterAll(() => {
    setRoute("/", []);
  });

  it("keeps the open item through a resize to phone width and back", () => {
    const {getByTestId, queryByTestId} = renderLayout();
    const root = getByTestId("list-detail-layout");
    expect(currentState().selectedId).toBe("3");
    expect(currentState().isSplit).toBe(true);

    fireLayout(root, 375);
    expect(currentState().selectedId).toBe("3");
    expect(currentState().isSplit).toBe(false);
    expect(queryByTestId("list-detail-list-pane")).toBeNull();

    fireLayout(root, 1024);
    expect(currentState().selectedId).toBe("3");
    expect(currentState().isSplit).toBe(true);
    expect(getByTestId("list-detail-list-pane")).toBeTruthy();
  });

  it("keeps the detail route mounted at phone width with no list pane", () => {
    const {getByTestId, queryByTestId} = renderLayout();

    fireLayout(getByTestId("list-detail-layout"), 375);

    expect(queryByTestId("list-detail-list-pane")).toBeNull();
    expect(stackChildMounts).toBe(1);
    // The index screen under the detail now holds the list, so swipe-back reveals it.
    expect(getByTestId("mail-list")).toBeTruthy();
    expect(queryByTestId("list-detail-empty")).toBeNull();
  });

  it("makes no router call while resizing", () => {
    const {getByTestId} = renderLayout();
    const root = getByTestId("list-detail-layout");

    fireLayout(root, 375);
    fireLayout(root, 1024);
    fireLayout(root, 600);

    expect(mockedRouter.push).not.toHaveBeenCalled();
    expect(mockedRouter.replace).not.toHaveBeenCalled();
    expect(mockedRouter.dismissTo).not.toHaveBeenCalled();
  });

  it("follows a window resize before the first layout event", () => {
    const {queryByTestId, rerender} = renderLayout();
    expect(queryByTestId("list-detail-list-pane")).toBeTruthy();

    setWindowWidth(375);
    rerender(
      <ListDetailLayout
        detailHref={(id) => `/mail/${id}`}
        indexHref="/mail"
        list={<Text testID="mail-list">Inbox</Text>}
      >
        <SplitProbe />
      </ListDetailLayout>
    );

    expect(queryByTestId("list-detail-list-pane")).toBeNull();
    expect(currentState().selectedId).toBe("3");
  });
});
