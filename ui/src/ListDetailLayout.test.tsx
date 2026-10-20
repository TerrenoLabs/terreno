import {afterAll, afterEach, beforeEach, describe, expect, it, type Mock} from "bun:test";
import {act, fireEvent} from "@testing-library/react-native";
import {useEffect} from "react";
import {Text, useWindowDimensions} from "react-native";

import {ListDetailIndex, ListDetailLayout, useListDetail} from "./ListDetailLayout";
import {renderWithTheme} from "./test-utils";

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
});

const fireLayout = (element: Parameters<typeof fireEvent>[0], width: number): void => {
  act(() => {
    fireEvent(element, "layout", {nativeEvent: {layout: {height: 800, width, x: 0, y: 0}}});
  });
};

const SplitProbe = (): React.ReactElement => {
  const {isSplit} = useListDetail();
  return <Text testID="split-probe">{isSplit ? "split" : "stacked"}</Text>;
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
