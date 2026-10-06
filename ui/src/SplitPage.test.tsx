import {afterAll, afterEach, beforeEach, describe, expect, it, mock, spyOn} from "bun:test";
import {act, fireEvent} from "@testing-library/react-native";
import {forwardRef, type ReactElement, type ReactNode, type Ref, useImperativeHandle} from "react";
import {type ScaledSize, ScrollView, StyleSheet, useWindowDimensions, View} from "react-native";
import type {ReactTestInstance} from "react-test-renderer";

import {getRounding} from "./Common";
import {SplitPage} from "./SplitPage";
import {renderWithTheme} from "./test-utils";

interface PagerScrollOptions {
  animated?: boolean;
  index: number;
}

const swiperScrollToIndex = mock((_options?: PagerScrollOptions) => {});

// Mock react-native-swiper-flatlist. The host tree stays a View with testID "swiper-flatlist"
// so existing snapshots keep matching. The ref exposes scrollToIndex for the opt-in pager tests.
mock.module("react-native-swiper-flatlist", () => ({
  SwiperFlatList: forwardRef(
    (
      {children, style}: {children?: ReactNode; style?: object},
      ref: Ref<{scrollToIndex: (options: PagerScrollOptions) => void}>
    ) => {
      useImperativeHandle(ref, () => ({scrollToIndex: swiperScrollToIndex}));
      return (
        <View style={style} testID="swiper-flatlist">
          {children}
        </View>
      );
    }
  ),
}));

type WindowDimensionsImpl = () => ScaledSize;
type MockableUseWindowDimensions = WindowDimensionsImpl & {
  mockImplementation?: (impl: WindowDimensionsImpl) => void;
};

const setWindowWidth = (width: number): (() => void) => {
  const useWindowDimensionsMock = useWindowDimensions as MockableUseWindowDimensions;
  if (typeof useWindowDimensionsMock.mockImplementation !== "function") {
    return (): void => {};
  }
  useWindowDimensionsMock.mockImplementation(
    (): ScaledSize => ({fontScale: 1, height: 812, scale: 2, width})
  );
  return (): void => {
    useWindowDimensionsMock.mockImplementation?.(
      (): ScaledSize => ({fontScale: 1, height: 812, scale: 2, width: 375})
    );
  };
};

const styleWidth = (style: unknown): unknown => StyleSheet.flatten(style)?.width;

const styleBorderRadius = (style: unknown): unknown => StyleSheet.flatten(style)?.borderRadius;

const flattenedStyle = (style: unknown): ReturnType<typeof StyleSheet.flatten> => {
  return StyleSheet.flatten(style) ?? {};
};

const setDesktop = () => {
  mock.module("./MediaQuery", () => ({
    isNarrowViewport: () => false,
    mediaQuery: () => "lg" as const,
    mediaQueryLargerThan: () => true,
    mediaQuerySmallerThan: () => false,
  }));
};

const setMobile = () => {
  mock.module("./MediaQuery", () => ({
    isNarrowViewport: () => true,
    mediaQuery: () => "xs" as const,
    mediaQueryLargerThan: () => false,
    mediaQuerySmallerThan: () => false,
  }));
};

// Restore MediaQuery to bunSetup defaults after all tests to prevent cross-file pollution.
// bunSetup mocks: isNarrowViewport → false, mediaQueryLargerThan → false, mediaQuerySmallerThan → false.
const restoreDefault = () => {
  mock.module("./MediaQuery", () => ({
    isNarrowViewport: mock(() => false),
    mediaQueryLargerThan: mock(() => false),
    mediaQuerySmallerThan: mock(() => false),
  }));
};

afterAll(() => {
  restoreDefault();
});

const findAncestor = (
  node: ReactTestInstance,
  predicate: (candidate: ReactTestInstance) => boolean
): ReactTestInstance | undefined => {
  let current = node.parent;
  while (current) {
    if (predicate(current)) {
      return current;
    }
    current = current.parent;
  }
  return undefined;
};

const getIconButtonByTestId = (root: ReactTestInstance, testID: string): ReactTestInstance => {
  const iconButton = root.findAll(
    (node: ReactTestInstance) =>
      node.props?.testID === testID && typeof node.props?.onClick === "function"
  )[0];
  if (!iconButton) {
    throw new Error(`Unable to find IconButton with testID: ${testID}`);
  }
  return iconButton;
};

const queryIconButtonByTestId = (
  root: ReactTestInstance,
  testID: string
): ReactTestInstance | undefined => {
  return root.findAll(
    (node: ReactTestInstance) =>
      node.props?.testID === testID && typeof node.props?.onClick === "function"
  )[0];
};

describe("SplitPage", () => {
  const defaultProps = {
    listViewData: [
      {id: "1", name: "Item 1"},
      {id: "2", name: "Item 2"},
    ],
    renderListViewItem: ({item}: {item: {id: string; name: string}}) => (
      <View testID={`item-${item.id}`} />
    ),
  };

  beforeEach(() => {
    setDesktop();
  });

  afterEach(() => {
    setDesktop();
  });

  it("renders correctly with renderContent", () => {
    const {toJSON} = renderWithTheme(
      <SplitPage
        {...defaultProps}
        renderContent={(selectedId) => <View testID={`content-${selectedId}`} />}
      />
    );
    expect(toJSON()).toMatchSnapshot();
  });

  it("renders correctly with children", () => {
    const {toJSON} = renderWithTheme(
      <SplitPage {...defaultProps}>
        <View testID="child-1" />
        <View testID="child-2" />
      </SplitPage>
    );
    expect(toJSON()).toMatchSnapshot();
  });

  it("component is defined", () => {
    expect(SplitPage).toBeDefined();
    expect(typeof SplitPage).toBe("function");
  });

  it("renders with loading state", () => {
    const {toJSON} = renderWithTheme(
      <SplitPage
        {...defaultProps}
        loading
        renderContent={(selectedId) => <View testID={`content-${selectedId}`} />}
      />
    );
    expect(toJSON()).toMatchSnapshot();
  });

  it("renders with custom color", () => {
    const {toJSON} = renderWithTheme(
      <SplitPage
        {...defaultProps}
        color="primary"
        renderContent={(selectedId) => <View testID={`content-${selectedId}`} />}
      />
    );
    expect(toJSON()).toMatchSnapshot();
  });

  it("renders with tabs when more than 2 children", () => {
    const {toJSON} = renderWithTheme(
      <SplitPage {...defaultProps} tabs={["Tab 1", "Tab 2", "Tab 3"]}>
        <View testID="child-1" />
        <View testID="child-2" />
        <View testID="child-3" />
      </SplitPage>
    );
    expect(toJSON()).toMatchSnapshot();
  });

  it("returns null when no children and no renderContent", () => {
    const {toJSON} = renderWithTheme(
      <SplitPage listViewData={[]} renderListViewItem={() => null} />
    );
    expect(toJSON()).toBeNull();
  });

  it("returns null when tabs count does not match children count", () => {
    const {toJSON} = renderWithTheme(
      <SplitPage {...defaultProps} tabs={["Tab 1"]}>
        <View testID="child-1" />
        <View testID="child-2" />
        <View testID="child-3" />
      </SplitPage>
    );
    expect(toJSON()).toBeNull();
  });

  it("renders with list view header", () => {
    const {toJSON} = renderWithTheme(
      <SplitPage
        {...defaultProps}
        renderContent={(selectedId) => <View testID={`content-${selectedId}`} />}
        renderListViewHeader={() => <View testID="list-header" />}
      />
    );
    expect(toJSON()).toMatchSnapshot();
  });

  it("renders with custom list view width and max width", () => {
    const {toJSON} = renderWithTheme(
      <SplitPage
        {...defaultProps}
        listViewMaxWidth={500}
        listViewWidth={400}
        renderContent={(selectedId) => <View testID={`content-${selectedId}`} />}
      />
    );
    expect(toJSON()).toMatchSnapshot();
  });

  it("renders with listViewExtraData", () => {
    const {toJSON} = renderWithTheme(
      <SplitPage
        {...defaultProps}
        listViewExtraData={{counter: 1}}
        renderContent={(selectedId) => <View testID={`content-${selectedId}`} />}
      />
    );
    expect(toJSON()).toMatchSnapshot();
  });

  it("renders with keyboard offset", () => {
    const {toJSON} = renderWithTheme(
      <SplitPage
        {...defaultProps}
        keyboardOffset={100}
        renderContent={(selectedId) => <View testID={`content-${selectedId}`} />}
      />
    );
    expect(toJSON()).toMatchSnapshot();
  });

  it("filters out null children", () => {
    const {toJSON} = renderWithTheme(
      <SplitPage {...defaultProps}>
        <View testID="child-1" />
        {null}
        <View testID="child-2" />
      </SplitPage>
    );
    expect(toJSON()).toMatchSnapshot();
  });

  it("renders with showItemList true to reset selection", () => {
    const onSelectionChange = mock(() => {});
    const {toJSON} = renderWithTheme(
      <SplitPage
        {...defaultProps}
        onSelectionChange={onSelectionChange}
        renderContent={(selectedId) => <View testID={`content-${selectedId}`} />}
        showItemList
      />
    );
    expect(toJSON()).toMatchSnapshot();
  });

  it("renders with bottomNavBarHeight", () => {
    const {toJSON} = renderWithTheme(
      <SplitPage {...defaultProps} bottomNavBarHeight={60}>
        <View testID="child-1" />
      </SplitPage>
    );
    expect(toJSON()).toMatchSnapshot();
  });

  describe("desktop viewport (mediaQueryLargerThan('sm') true)", () => {
    it("renders renderList/renderContent on desktop", () => {
      setDesktop();
      const {toJSON} = renderWithTheme(
        <SplitPage
          {...defaultProps}
          renderContent={(selectedId) => <View testID={`content-${selectedId}`} />}
        />
      );
      expect(toJSON()).toBeTruthy();
    });

    it("renders renderList/renderChildrenContent on desktop with 2 children", () => {
      setDesktop();
      const {toJSON} = renderWithTheme(
        <SplitPage {...defaultProps}>
          <View testID="child-1" />
          <View testID="child-2" />
        </SplitPage>
      );
      expect(toJSON()).toBeTruthy();
    });

    it("renders renderChildrenContent with >2 children and tabs on desktop", () => {
      setDesktop();
      const {toJSON} = renderWithTheme(
        <SplitPage {...defaultProps} tabs={["A", "B", "C"]}>
          <View testID="child-1" />
          <View testID="child-2" />
          <View testID="child-3" />
        </SplitPage>
      );
      expect(toJSON()).toBeTruthy();
    });

    it("renders with listViewWidth/listViewMaxWidth applied", () => {
      setDesktop();
      const {toJSON} = renderWithTheme(
        <SplitPage
          {...defaultProps}
          listViewMaxWidth={400}
          listViewWidth={350}
          renderContent={(id) => <View testID={`content-${id}`} />}
        />
      );
      expect(toJSON()).toBeTruthy();
    });
  });

  describe("mobile viewport (mediaQueryLargerThan('sm') false)", () => {
    it("renders mobile list view when no item is selected", () => {
      setMobile();
      const {toJSON} = renderWithTheme(
        <SplitPage
          {...defaultProps}
          renderContent={(selectedId) => <View testID={`content-${selectedId}`} />}
        />
      );
      expect(toJSON()).toBeTruthy();
    });

    it("renders mobile list content when item is selected via renderContent", async () => {
      setMobile();
      const {fireEvent} = await import("@testing-library/react-native");
      const {getAllByLabelText, queryByTestId} = renderWithTheme(
        <SplitPage
          {...defaultProps}
          renderContent={(selectedId) => <View testID={`content-${selectedId}`} />}
        />
      );
      const boxes = getAllByLabelText("Select");
      await act(async () => {
        fireEvent.press(boxes[0]);
      });
      expect(queryByTestId("content-0")).toBeTruthy();
    });

    it("renders mobile children content with swiper when item is selected", async () => {
      setMobile();
      const {fireEvent} = await import("@testing-library/react-native");
      const {getAllByLabelText, queryByTestId} = renderWithTheme(
        <SplitPage {...defaultProps}>
          <View testID="child-1" />
          <View testID="child-2" />
        </SplitPage>
      );
      const boxes = getAllByLabelText("Select");
      await act(async () => {
        fireEvent.press(boxes[0]);
      });
      expect(queryByTestId("swiper-flatlist")).toBeTruthy();
    });

    it("returns null for mobile children content when no item selected", () => {
      setMobile();
      const {queryByTestId} = renderWithTheme(
        <SplitPage {...defaultProps}>
          <View testID="child-1" />
          <View testID="child-2" />
        </SplitPage>
      );
      expect(queryByTestId("swiper-flatlist")).toBeNull();
    });

    it("hides mobile list when item selected", async () => {
      setMobile();
      const {fireEvent} = await import("@testing-library/react-native");
      const {getAllByLabelText, toJSON} = renderWithTheme(
        <SplitPage
          {...defaultProps}
          renderContent={(selectedId) => <View testID={`content-${selectedId}`} />}
        />
      );
      const boxes = getAllByLabelText("Select");
      await act(async () => {
        fireEvent.press(boxes[0]);
      });
      expect(toJSON()).toBeTruthy();
    });

    it("can deselect item via IconButton onClick on mobile", async () => {
      setMobile();
      const {fireEvent} = await import("@testing-library/react-native");
      const onSelectionChange = mock(async (_arg: unknown) => {});
      const {getAllByLabelText, UNSAFE_root} = renderWithTheme(
        <SplitPage
          {...defaultProps}
          onSelectionChange={onSelectionChange}
          renderContent={(selectedId) => <View testID={`content-${selectedId}`} />}
        />
      );
      const boxes = getAllByLabelText("Select");
      await act(async () => {
        fireEvent.press(boxes[0]);
      });
      const iconButtons = UNSAFE_root.findAll(
        (n: ReactTestInstance) => n.props?.onClick && n.props?.iconName === "xmark"
      );
      if (iconButtons.length > 0) {
        await act(async () => {
          iconButtons[0].props.onClick();
        });
        expect(onSelectionChange).toHaveBeenCalledWith(undefined);
      } else {
        const closeButtons = UNSAFE_root.findAll(
          (n: ReactTestInstance) => n.props?.accessibilityLabel === "close"
        );
        if (closeButtons.length > 0) {
          await act(async () => {
            if (closeButtons[0].props.onClick) {
              closeButtons[0].props.onClick();
            } else if (closeButtons[0].props.onPress) {
              closeButtons[0].props.onPress();
            }
          });
        }
        expect(onSelectionChange).toHaveBeenCalledWith(undefined);
      }
    });

    it("renders mobile list view header when provided", () => {
      setMobile();
      const {toJSON} = renderWithTheme(
        <SplitPage
          {...defaultProps}
          renderContent={(selectedId) => <View testID={`content-${selectedId}`} />}
          renderListViewHeader={() => <View testID="mobile-header" />}
        />
      );
      expect(toJSON()).toBeTruthy();
    });

    it("renders mobile with bottomNavBarHeight", async () => {
      setMobile();
      const {fireEvent} = await import("@testing-library/react-native");
      const {getAllByLabelText, toJSON} = renderWithTheme(
        <SplitPage {...defaultProps} bottomNavBarHeight={50}>
          <View testID="child-1" />
          <View testID="child-2" />
        </SplitPage>
      );
      const boxes = getAllByLabelText("Select");
      await act(async () => {
        fireEvent.press(boxes[0]);
      });
      expect(toJSON()).toBeTruthy();
    });
  });

  describe("desktop renderChildrenContent >2 children with tabs", () => {
    it("renders segmented control tabs and content on desktop with >2 children", () => {
      setDesktop();
      const {toJSON} = renderWithTheme(
        <SplitPage {...defaultProps} tabs={["Tab A", "Tab B", "Tab C"]}>
          <View testID="child-a" />
          <View testID="child-b" />
          <View testID="child-c" />
        </SplitPage>
      );
      expect(toJSON()).toBeTruthy();
    });

    it("renders renderContent path on desktop (renderSplitPage)", () => {
      setDesktop();
      const {toJSON} = renderWithTheme(
        <SplitPage
          {...defaultProps}
          renderContent={(id) => <View testID={`desktop-content-${id}`} />}
        />
      );
      expect(toJSON()).toBeTruthy();
    });

    it("renders <= 2 children content with scroll views on desktop", () => {
      setDesktop();
      const {toJSON} = renderWithTheme(
        <SplitPage {...defaultProps}>
          <View testID="child-1" />
        </SplitPage>
      );
      expect(toJSON()).toBeTruthy();
    });

    it("triggers segmented control onChange on desktop with >2 children", async () => {
      setDesktop();
      const {toJSON, UNSAFE_root} = renderWithTheme(
        <SplitPage {...defaultProps} tabs={["Tab A", "Tab B", "Tab C"]}>
          <View testID="child-a" />
          <View testID="child-b" />
          <View testID="child-c" />
        </SplitPage>
      );
      const segmented = UNSAFE_root.findAll(
        (n: ReactTestInstance) => n.props?.onChange && n.props?.items
      );
      if (segmented.length > 0) {
        await act(async () => {
          segmented[0].props.onChange(2);
        });
      }
      expect(toJSON()).toBeTruthy();
    });
  });

  describe("item selection callbacks", () => {
    it("onItemSelect runs onSelectionChange when item clicked via Box press", async () => {
      setMobile();
      const {fireEvent} = await import("@testing-library/react-native");
      const onSelectionChange = mock(async (_arg: unknown) => {});
      const {getAllByLabelText} = renderWithTheme(
        <SplitPage
          {...defaultProps}
          onSelectionChange={onSelectionChange}
          renderContent={(id) => <View testID={`content-${id}`} />}
        />
      );

      const boxes = getAllByLabelText("Select");
      expect(boxes.length).toBeGreaterThan(0);
      await act(async () => {
        fireEvent.press(boxes[0]);
      });
      expect(onSelectionChange).toHaveBeenCalled();
    });

    it("selecting an item shows mobile children content when no renderContent", async () => {
      setMobile();
      const {fireEvent} = await import("@testing-library/react-native");
      const {getAllByLabelText, queryByTestId} = renderWithTheme(
        <SplitPage {...defaultProps}>
          <View testID="child-1" />
          <View testID="child-2" />
        </SplitPage>
      );
      const boxes = getAllByLabelText("Select");
      await act(async () => {
        fireEvent.press(boxes[0]);
      });
      expect(queryByTestId("swiper-flatlist")).toBeTruthy();
    });

    it("uses default onSelectionChange without throwing", async () => {
      setMobile();
      const {fireEvent} = await import("@testing-library/react-native");
      const {getAllByLabelText, toJSON} = renderWithTheme(
        <SplitPage {...defaultProps} renderContent={(id) => <View testID={`content-${id}`} />} />
      );
      const boxes = getAllByLabelText("Select");
      await act(async () => {
        fireEvent.press(boxes[0]);
      });
      expect(toJSON()).toBeTruthy();
    });

    it("covers elementArray.map in renderMobileChildrenContent", async () => {
      setMobile();
      const {fireEvent} = await import("@testing-library/react-native");
      const {getAllByLabelText, queryByTestId} = renderWithTheme(
        <SplitPage {...defaultProps} bottomNavBarHeight={50}>
          <View testID="child-1" />
        </SplitPage>
      );
      const boxes = getAllByLabelText("Select");
      await act(async () => {
        fireEvent.press(boxes[0]);
      });
      expect(queryByTestId("swiper-flatlist")).toBeTruthy();
    });

    it("covers activeTabs.map in renderChildrenContent on desktop", () => {
      setDesktop();
      const {toJSON} = renderWithTheme(
        <SplitPage {...defaultProps} tabs={["Tab A", "Tab B", "Tab C"]}>
          <View testID="child-a" />
          <View testID="child-b" />
          <View testID="child-c" />
        </SplitPage>
      );
      expect(toJSON()).toBeTruthy();
    });

    it("selection deselect when showItemList becomes true", async () => {
      setMobile();
      const onSelectionChange = mock(async () => {});
      const {rerender} = renderWithTheme(
        <SplitPage
          {...defaultProps}
          onSelectionChange={onSelectionChange}
          renderContent={(id) => <View testID={`content-${id}`} />}
        />
      );

      await act(async () => {
        rerender(
          <SplitPage
            {...defaultProps}
            onSelectionChange={onSelectionChange}
            renderContent={(id) => <View testID={`content-${id}`} />}
            showItemList
          />
        );
      });

      // showItemList=true triggers onItemDeselect -> onSelectionChange(undefined)
      expect(onSelectionChange).toHaveBeenCalled();
    });

    it("renders SegmentedControl with >2 children and tabs on mobile", async () => {
      const {fireEvent} = await import("@testing-library/react-native");
      const {getAllByLabelText, root} = renderWithTheme(
        <SplitPage {...defaultProps} tabs={["Tab A", "Tab B", "Tab C"]}>
          <View testID="child-a" />
          <View testID="child-b" />
          <View testID="child-c" />
        </SplitPage>
      );
      // First select an item to show children content
      const boxes = getAllByLabelText("Select");
      await act(async () => {
        fireEvent.press(boxes[0]);
      });
      expect(root).toBeTruthy();
    });
  });

  describe("opt-in layouts", () => {
    const twoChildren = (
      <SplitPage {...defaultProps}>
        <View testID="child-1" />
        <View testID="child-2" />
      </SplitPage>
    );

    const selectFirst = async (
      getAllByLabelText: (label: string) => ReactTestInstance[]
    ): Promise<void> => {
      const boxes = getAllByLabelText("Select");
      await act(async () => {
        fireEvent.press(boxes[0]);
      });
    };

    const layoutWidth = (node: ReactTestInstance, width: number): void => {
      node.props.onLayout({
        nativeEvent: {layout: {height: 400, width, x: 0, y: 0}},
      });
    };

    it("shrinks at narrowBelowWidth and keeps the desktop layout above that width", async () => {
      setDesktop();
      const restoreNarrow = setWindowWidth(500);
      const shrunk = renderWithTheme(
        <SplitPage {...defaultProps} narrowBelowWidth={500}>
          <View testID="child-1" />
          <View testID="child-2" />
        </SplitPage>
      );
      expect(shrunk.queryByTestId("child-1")).toBeNull();
      expect(shrunk.queryByTestId("swiper-flatlist")).toBeNull();
      await selectFirst(shrunk.getAllByLabelText);
      expect(shrunk.getByTestId("swiper-flatlist")).toBeTruthy();
      restoreNarrow();

      setMobile();
      const restoreWide = setWindowWidth(501);
      const sideBySide = renderWithTheme(
        <SplitPage {...defaultProps} narrowBelowWidth={500}>
          <View testID="child-1" />
          <View testID="child-2" />
        </SplitPage>
      );
      expect(sideBySide.getByTestId("child-1")).toBeTruthy();
      expect(sideBySide.queryByTestId("swiper-flatlist")).toBeNull();
      restoreWide();
    });

    it("keeps the desktop flex row and the narrow dotted swiper without the new props", async () => {
      setDesktop();
      const desktop = renderWithTheme(twoChildren);
      expect(desktop.queryByTestId("split-page-desktop-children-scroll")).toBeNull();
      const rowChild = findAncestor(
        desktop.getByTestId("child-1"),
        (candidate) => styleWidth(candidate.props.style) === "60%"
      );
      expect(rowChild).toBeDefined();
      expect(StyleSheet.flatten(rowChild?.props.style)?.flex).toBe(1);

      setMobile();
      const mobile = renderWithTheme(twoChildren);
      expect(mobile.queryByTestId("swiper-flatlist")).toBeNull();
      await selectFirst(mobile.getAllByLabelText);
      expect(mobile.getByTestId("swiper-flatlist")).toBeTruthy();
      expect(mobile.queryByTestId("split-page-mobile-children")).toBeNull();
      const paginated = mobile.UNSAFE_root.findAll(
        (node: ReactTestInstance) => node.props?.showPagination === true
      );
      expect(paginated.length).toBeGreaterThan(0);
    });

    it("sizes desktop children from the minimum width until the row is measured", async () => {
      setDesktop();
      const {getByTestId} = renderWithTheme(
        <SplitPage {...defaultProps} desktopChildrenMinWidth={200}>
          <View testID="child-1" />
          <View testID="child-2" />
        </SplitPage>
      );
      const scroll = getByTestId("split-page-desktop-children-scroll");
      expect(styleWidth(getByTestId("split-page-desktop-child-0").props.style)).toBe(200);
      expect(styleWidth(getByTestId("split-page-desktop-child-1").props.style)).toBe(200);

      await act(async () => {
        layoutWidth(scroll, 1000);
      });
      expect(styleWidth(getByTestId("split-page-desktop-child-0").props.style)).toBe(500);
      expect(styleWidth(getByTestId("split-page-desktop-child-1").props.style)).toBe(500);

      await act(async () => {
        layoutWidth(scroll, 300);
      });
      expect(styleWidth(getByTestId("split-page-desktop-child-0").props.style)).toBe(200);
      expect(styleWidth(getByTestId("split-page-desktop-child-1").props.style)).toBe(200);
      expect(scroll.props.contentContainerStyle.width).toBe(400);
    });

    it("keeps the segmented control when desktopChildrenMinWidth is set with three children", () => {
      setDesktop();
      const warnSpy = spyOn(console, "warn").mockImplementation(() => {});
      const {queryByTestId, UNSAFE_root} = renderWithTheme(
        <SplitPage
          {...defaultProps}
          desktopChildrenMinWidth={200}
          tabs={["Tab 1", "Tab 2", "Tab 3"]}
        >
          <View testID="child-1" />
          <View testID="child-2" />
          <View testID="child-3" />
        </SplitPage>
      );
      const segmented = UNSAFE_root.findAll(
        (node: ReactTestInstance) => node.props?.items && node.props?.onChange
      );
      expect(segmented.length).toBeGreaterThan(0);
      expect(queryByTestId("split-page-desktop-children-scroll")).toBeNull();
      expect(warnSpy).toHaveBeenCalledWith(
        "desktopChildrenMinWidth applies only when SplitPage has two or fewer children."
      );
      warnSpy.mockRestore();
    });

    it("renders the labeled narrow pager with a next control on the first child", async () => {
      setMobile();
      const {getAllByLabelText, getByTestId, UNSAFE_root} = renderWithTheme(
        <SplitPage {...defaultProps} narrowViewportChildLabels={["Summary", "Notes"]}>
          <View testID="child-1" />
          <View testID="child-2" />
        </SplitPage>
      );
      await selectFirst(getAllByLabelText);
      expect(getByTestId("split-page-mobile-children")).toBeTruthy();
      expect(getIconButtonByTestId(UNSAFE_root, "split-page-column-next")).toBeTruthy();
      expect(queryIconButtonByTestId(UNSAFE_root, "split-page-column-previous")).toBeUndefined();
      expect(queryIconButtonByTestId(UNSAFE_root, "split-page-back-to-list")).toBeUndefined();
      const paginated = UNSAFE_root.findAll(
        (node: ReactTestInstance) => node.props?.showPagination === true
      );
      expect(paginated).toHaveLength(0);
      const labeled = UNSAFE_root.findAll(
        (node: ReactTestInstance) => typeof node.props?.getItemLayout === "function"
      );
      expect(labeled.length).toBeGreaterThan(0);
      expect(labeled[0].props.showPagination).toBeUndefined();
    });

    it("scrolls to the next child without an unanimated snap from the index change", async () => {
      setMobile();
      const {getAllByLabelText, UNSAFE_root} = renderWithTheme(
        <SplitPage {...defaultProps} narrowViewportChildLabels={["Summary", "Notes"]}>
          <View testID="child-1" />
          <View testID="child-2" />
        </SplitPage>
      );
      await selectFirst(getAllByLabelText);
      swiperScrollToIndex.mockClear();
      await act(async () => {
        getIconButtonByTestId(UNSAFE_root, "split-page-column-next").props.onClick();
      });
      expect(swiperScrollToIndex).toHaveBeenCalledWith({animated: true, index: 1});
      expect(swiperScrollToIndex.mock.calls.some((call) => call[0]?.animated === false)).toBe(
        false
      );
    });

    it("shows only previous on the last of two children", async () => {
      setMobile();
      const two = renderWithTheme(
        <SplitPage {...defaultProps} narrowViewportChildLabels={["Summary", "Notes"]}>
          <View testID="child-1" />
          <View testID="child-2" />
        </SplitPage>
      );
      await selectFirst(two.getAllByLabelText);
      await act(async () => {
        getIconButtonByTestId(two.UNSAFE_root, "split-page-column-next").props.onClick();
      });
      expect(getIconButtonByTestId(two.UNSAFE_root, "split-page-column-previous")).toBeTruthy();
      expect(queryIconButtonByTestId(two.UNSAFE_root, "split-page-column-next")).toBeUndefined();
    });

    it("shows both directions on a middle child and walks previous back to the first", async () => {
      setMobile();
      const three = renderWithTheme(
        <SplitPage
          {...defaultProps}
          narrowViewportChildLabels={["Summary", "Notes", "History"]}
          tabs={["Summary", "Notes", "History"]}
        >
          <View testID="child-1" />
          <View testID="child-2" />
          <View testID="child-3" />
        </SplitPage>
      );
      await selectFirst(three.getAllByLabelText);
      await act(async () => {
        getIconButtonByTestId(three.UNSAFE_root, "split-page-column-next").props.onClick();
      });
      expect(getIconButtonByTestId(three.UNSAFE_root, "split-page-column-previous")).toBeTruthy();
      expect(getIconButtonByTestId(three.UNSAFE_root, "split-page-column-next")).toBeTruthy();
      await act(async () => {
        getIconButtonByTestId(three.UNSAFE_root, "split-page-column-next").props.onClick();
      });
      expect(queryIconButtonByTestId(three.UNSAFE_root, "split-page-column-next")).toBeUndefined();
      swiperScrollToIndex.mockClear();
      await act(async () => {
        getIconButtonByTestId(three.UNSAFE_root, "split-page-column-previous").props.onClick();
      });
      await act(async () => {
        getIconButtonByTestId(three.UNSAFE_root, "split-page-column-previous").props.onClick();
      });
      expect(swiperScrollToIndex).toHaveBeenCalledWith({animated: true, index: 1});
      expect(swiperScrollToIndex).toHaveBeenCalledWith({animated: true, index: 0});
      expect(
        queryIconButtonByTestId(three.UNSAFE_root, "split-page-column-previous")
      ).toBeUndefined();
      expect(getIconButtonByTestId(three.UNSAFE_root, "split-page-column-next")).toBeTruthy();
    });

    it("returns to the list when the labeled back button is pressed", async () => {
      setMobile();
      const onSelectionChange = mock(async () => {});
      const {getAllByLabelText, UNSAFE_root} = renderWithTheme(
        <SplitPage
          {...defaultProps}
          narrowViewportChildLabels={["Summary", "Notes"]}
          narrowViewportListButtonLabel="Back to list"
          onSelectionChange={onSelectionChange}
        >
          <View testID="child-1" />
          <View testID="child-2" />
        </SplitPage>
      );
      await selectFirst(getAllByLabelText);
      await act(async () => {
        getIconButtonByTestId(UNSAFE_root, "split-page-back-to-list").props.onClick();
      });
      expect(onSelectionChange).toHaveBeenCalledWith(undefined);
    });

    it("shows the labeled pager when narrowViewportSelectionActive is set without a list selection", () => {
      setMobile();
      const {getByTestId, queryByLabelText} = renderWithTheme(
        <SplitPage
          {...defaultProps}
          narrowViewportChildLabels={["Summary", "Notes"]}
          narrowViewportSelectionActive
        >
          <View testID="child-1" />
          <View testID="child-2" />
        </SplitPage>
      );
      expect(getByTestId("split-page-mobile-children")).toBeTruthy();
      expect(queryByLabelText("Select")).toBeNull();
    });

    it("resets the narrow pager to the first child when narrowViewportSelectionKey changes", async () => {
      setMobile();
      const view = renderWithTheme(
        <SplitPage
          {...defaultProps}
          narrowViewportChildLabels={["Summary", "Notes"]}
          narrowViewportSelectionActive
          narrowViewportSelectionKey="record-a"
        >
          <View testID="child-1" />
          <View testID="child-2" />
        </SplitPage>
      );
      await act(async () => {
        getIconButtonByTestId(view.UNSAFE_root, "split-page-column-next").props.onClick();
      });
      expect(getIconButtonByTestId(view.UNSAFE_root, "split-page-column-previous")).toBeTruthy();
      swiperScrollToIndex.mockClear();
      await act(async () => {
        view.rerender(
          <SplitPage
            {...defaultProps}
            narrowViewportChildLabels={["Summary", "Notes"]}
            narrowViewportSelectionActive
            narrowViewportSelectionKey="record-b"
          >
            <View testID="child-1" />
            <View testID="child-2" />
          </SplitPage>
        );
      });
      expect(swiperScrollToIndex).toHaveBeenCalledWith({animated: false, index: 0});
      expect(
        queryIconButtonByTestId(view.UNSAFE_root, "split-page-column-previous")
      ).toBeUndefined();
      expect(getIconButtonByTestId(view.UNSAFE_root, "split-page-column-next")).toBeTruthy();
    });

    it("realigns the current child when the page width changes", async () => {
      setMobile();
      const restoreWidth = setWindowWidth(375);
      const view = renderWithTheme(
        <SplitPage
          {...defaultProps}
          narrowViewportChildLabels={["Summary", "Notes"]}
          narrowViewportSelectionActive
          narrowViewportSelectionKey="record-a"
        >
          <View testID="child-1" />
          <View testID="child-2" />
        </SplitPage>
      );
      await act(async () => {
        getIconButtonByTestId(view.UNSAFE_root, "split-page-column-next").props.onClick();
      });
      swiperScrollToIndex.mockClear();
      await act(async () => {
        layoutWidth(view.getByTestId("split-page-mobile-children"), 280);
      });
      expect(swiperScrollToIndex).toHaveBeenCalledWith({animated: false, index: 1});
      expect(getIconButtonByTestId(view.UNSAFE_root, "split-page-column-previous")).toBeTruthy();
      expect(queryIconButtonByTestId(view.UNSAFE_root, "split-page-column-next")).toBeUndefined();

      swiperScrollToIndex.mockClear();
      setWindowWidth(420);
      await act(async () => {
        view.rerender(
          <SplitPage
            {...defaultProps}
            narrowViewportChildLabels={["Summary", "Notes"]}
            narrowViewportSelectionActive
            narrowViewportSelectionKey="record-a"
          >
            <View testID="child-1" />
            <View testID="child-2" />
          </SplitPage>
        );
      });
      expect(swiperScrollToIndex).toHaveBeenCalledWith({animated: false, index: 1});
      expect(swiperScrollToIndex.mock.calls.some((call) => call[0]?.index === 0)).toBe(false);
      expect(getIconButtonByTestId(view.UNSAFE_root, "split-page-column-previous")).toBeTruthy();
      restoreWidth();
    });

    it("falls back to the dotted swiper when narrowViewportChildLabels does not match the children", async () => {
      setMobile();
      const warnSpy = spyOn(console, "warn").mockImplementation(() => {});
      const {getAllByLabelText, queryByTestId, UNSAFE_root} = renderWithTheme(
        <SplitPage {...defaultProps} narrowViewportChildLabels={["Summary"]}>
          <View testID="child-1" />
          <View testID="child-2" />
        </SplitPage>
      );
      await selectFirst(getAllByLabelText);
      expect(warnSpy).toHaveBeenCalledWith(
        "narrowViewportChildLabels must have one entry per child. Falling back to the default narrow pager."
      );
      expect(queryByTestId("split-page-mobile-children")).toBeNull();
      const paginated = UNSAFE_root.findAll(
        (node: ReactTestInstance) => node.props?.showPagination === true
      );
      expect(paginated.length).toBeGreaterThan(0);
      warnSpy.mockRestore();
    });

    it("applies the default md border radius to desktop child columns but not the list column", () => {
      setDesktop();
      const {getByTestId, UNSAFE_root} = renderWithTheme(
        <SplitPage {...defaultProps} desktopChildrenMinWidth={200}>
          <View testID="child-1" />
          <View testID="child-2" />
        </SplitPage>
      );
      expect(styleBorderRadius(getByTestId("split-page-desktop-child-0").props.style)).toBe(
        getRounding("md")
      );
      expect(styleBorderRadius(getByTestId("split-page-desktop-child-1").props.style)).toBe(
        getRounding("md")
      );
      const listColumn = UNSAFE_root.findAll(
        (node: ReactTestInstance) =>
          styleWidth(node.props?.style) === 300 && node.props?.style?.maxWidth === 300
      )[0];
      expect(listColumn).toBeTruthy();
      expect(styleBorderRadius(listColumn?.props?.style)).toBeUndefined();
    });

    it("allows childColumnRounding to override the desktop child column border radius", () => {
      setDesktop();
      const {getByTestId} = renderWithTheme(
        <SplitPage {...defaultProps} childColumnRounding="lg" desktopChildrenMinWidth={200}>
          <View testID="child-1" />
          <View testID="child-2" />
        </SplitPage>
      );
      expect(styleBorderRadius(getByTestId("split-page-desktop-child-0").props.style)).toBe(
        getRounding("lg")
      );
    });

    it("applies child column border radius on the labeled narrow pager child containers", async () => {
      setMobile();
      const {getAllByLabelText, getByTestId} = renderWithTheme(
        <SplitPage {...defaultProps} narrowViewportChildLabels={["Summary", "Notes"]}>
          <View testID="child-1" />
          <View testID="child-2" />
        </SplitPage>
      );
      await selectFirst(getAllByLabelText);
      expect(styleBorderRadius(getByTestId("split-page-mobile-child-0").props.style)).toBe(
        getRounding("md")
      );
      expect(styleBorderRadius(getByTestId("split-page-mobile-child-1").props.style)).toBe(
        getRounding("md")
      );
    });
  });

  describe("desktop child column scrolling", () => {
    const tallChild = (testID: string): ReactElement => {
      return <View style={{height: 4000}} testID={testID} />;
    };

    const renderFullHeightChild = (): ReactElement => {
      return (
        <View style={{height: "100%"}} testID="bounded-child">
          <View style={{height: 48}} testID="fixed-section" />
          <ScrollView testID="internal-scroll">
            <View style={{height: 4000}} testID="internal-tall" />
          </ScrollView>
        </View>
      );
    };

    const expectClippingPane = (
      pane: ReactTestInstance,
      borderRadius: number,
      width: number | string
    ): void => {
      const style = flattenedStyle(pane.props.style);
      expect(style.borderRadius).toBe(borderRadius);
      expect(style.height).toBe("100%");
      expect(style.overflow).toBe("hidden");
      expect(style.width).toBe(width);
    };

    const expectVerticalChildScroll = (scroll: ReactTestInstance, tallTestID: string): void => {
      const style = flattenedStyle(scroll.props.style);
      expect(style.overflow).toBeUndefined();
      expect(style.flex).toBe(1);
      expect(style.height).toBe("100%");
      expect(scroll.props.horizontal).toBeFalsy();
      expect(scroll.props.contentContainerStyle).toEqual({flex: 1});
      expect(scroll.findByProps({testID: tallTestID})).toBeTruthy();
    };

    const expectBoundedFullHeightChild = (scroll: ReactTestInstance): void => {
      const child = scroll.findByProps({testID: "bounded-child"});
      const childStyle = flattenedStyle(child.props.style);
      expect(childStyle.height).toBe("100%");
      expect(childStyle.position).toBeUndefined();
      expect(scroll.props.contentContainerStyle).toEqual({flex: 1});
      expect(child.findByProps({testID: "fixed-section"})).toBeTruthy();
      expect(child.findByProps({testID: "internal-scroll"})).toBeTruthy();
      expect(child.findByProps({testID: "internal-tall"})).toBeTruthy();
    };

    it("scrolls ordinary tall content in desktopChildrenMinWidth columns and keeps the pane clipped", () => {
      setDesktop();
      const {getByTestId} = renderWithTheme(
        <SplitPage {...defaultProps} desktopChildrenMinWidth={200}>
          {tallChild("tall-0")}
          {tallChild("tall-1")}
        </SplitPage>
      );

      expectClippingPane(getByTestId("split-page-desktop-child-0"), getRounding("md"), 200);
      expectClippingPane(getByTestId("split-page-desktop-child-1"), getRounding("md"), 200);
      expectVerticalChildScroll(getByTestId("split-page-desktop-child-scroll-0"), "tall-0");
      expectVerticalChildScroll(getByTestId("split-page-desktop-child-scroll-1"), "tall-1");
      expect(
        flattenedStyle(getByTestId("split-page-desktop-children-scroll").props.style).overflow
      ).toBeUndefined();
    });

    it("scrolls ordinary tall content in the default one and two child row", () => {
      setDesktop();
      const {getByTestId} = renderWithTheme(
        <SplitPage {...defaultProps}>
          {tallChild("tall-0")}
          {tallChild("tall-1")}
        </SplitPage>
      );

      expectClippingPane(getByTestId("split-page-desktop-row-child-0"), getRounding("md"), "60%");
      expectClippingPane(getByTestId("split-page-desktop-row-child-1"), getRounding("md"), "60%");
      expect(flattenedStyle(getByTestId("split-page-desktop-row-child-0").props.style).flex).toBe(
        1
      );
      expectVerticalChildScroll(getByTestId("split-page-desktop-child-scroll-0"), "tall-0");
      expectVerticalChildScroll(getByTestId("split-page-desktop-child-scroll-1"), "tall-1");
    });

    it("scrolls ordinary tall content in the segmented layout", () => {
      setDesktop();
      const {getByTestId} = renderWithTheme(
        <SplitPage {...defaultProps} tabs={["One", "Two", "Three"]}>
          {tallChild("tall-0")}
          {tallChild("tall-1")}
          {tallChild("tall-2")}
        </SplitPage>
      );

      expectClippingPane(
        getByTestId("split-page-desktop-segment-child-0"),
        getRounding("md"),
        "60%"
      );
      expectClippingPane(
        getByTestId("split-page-desktop-segment-child-1"),
        getRounding("md"),
        "60%"
      );
      expect(
        flattenedStyle(getByTestId("split-page-desktop-segment-child-0").props.style).paddingRight
      ).toBe(16);
      expect(
        flattenedStyle(getByTestId("split-page-desktop-segment-child-1").props.style).paddingLeft
      ).toBe(16);
      expectVerticalChildScroll(getByTestId("split-page-desktop-child-scroll-0"), "tall-0");
      expectVerticalChildScroll(getByTestId("split-page-desktop-child-scroll-1"), "tall-1");
    });

    it("preserves a custom childColumnRounding on every desktop child layout", () => {
      setDesktop();
      const minWidth = renderWithTheme(
        <SplitPage {...defaultProps} childColumnRounding="lg" desktopChildrenMinWidth={220}>
          <View testID="child-1" />
          <View testID="child-2" />
        </SplitPage>
      );
      expect(
        styleBorderRadius(minWidth.getByTestId("split-page-desktop-child-0").props.style)
      ).toBe(getRounding("lg"));

      const row = renderWithTheme(
        <SplitPage {...defaultProps} childColumnRounding="sm">
          <View testID="child-1" />
        </SplitPage>
      );
      expect(styleBorderRadius(row.getByTestId("split-page-desktop-row-child-0").props.style)).toBe(
        getRounding("sm")
      );

      const segmented = renderWithTheme(
        <SplitPage {...defaultProps} childColumnRounding="xl" tabs={["One", "Two", "Three"]}>
          <View testID="child-1" />
          <View testID="child-2" />
          <View testID="child-3" />
        </SplitPage>
      );
      expect(
        styleBorderRadius(segmented.getByTestId("split-page-desktop-segment-child-0").props.style)
      ).toBe(getRounding("xl"));
    });

    it("keeps a height 100% child bounded to the pane with its own scroll view", () => {
      setDesktop();
      const minWidth = renderWithTheme(
        <SplitPage {...defaultProps} desktopChildrenMinWidth={240}>
          {renderFullHeightChild()}
          <View testID="other-child" />
        </SplitPage>
      );
      const minWidthPane = minWidth.getByTestId("split-page-desktop-child-0");
      expect(flattenedStyle(minWidthPane.props.style).height).toBe("100%");
      expect(flattenedStyle(minWidthPane.props.style).overflow).toBe("hidden");
      expectBoundedFullHeightChild(minWidth.getByTestId("split-page-desktop-child-scroll-0"));

      const row = renderWithTheme(
        <SplitPage {...defaultProps}>{renderFullHeightChild()}</SplitPage>
      );
      expectBoundedFullHeightChild(row.getByTestId("split-page-desktop-child-scroll-0"));
      expect(
        flattenedStyle(row.getByTestId("split-page-desktop-row-child-0").props.style).height
      ).toBe("100%");

      const segmented = renderWithTheme(
        <SplitPage {...defaultProps} tabs={["One", "Two", "Three"]}>
          {renderFullHeightChild()}
          <View testID="child-2" />
          <View testID="child-3" />
        </SplitPage>
      );
      expectBoundedFullHeightChild(segmented.getByTestId("split-page-desktop-child-scroll-0"));
      expect(
        flattenedStyle(segmented.getByTestId("split-page-desktop-segment-child-0").props.style)
          .overflow
      ).toBe("hidden");
    });
  });

  describe("narrow child column scrolling", () => {
    const renderFullHeightChild = (): ReactElement => {
      return (
        <View style={{height: "100%"}} testID="bounded-child">
          <View style={{height: 48}} testID="fixed-section" />
          <ScrollView testID="internal-scroll">
            <View style={{height: 4000}} testID="internal-tall" />
          </ScrollView>
        </View>
      );
    };

    const selectFirst = async (
      getAllByLabelText: (label: string) => ReactTestInstance[]
    ): Promise<void> => {
      const boxes = getAllByLabelText("Select");
      await act(async () => {
        fireEvent.press(boxes[0]);
      });
    };

    const layoutPager = (node: ReactTestInstance, height: number, width: number): void => {
      act(() => {
        node.props.onLayout({
          nativeEvent: {layout: {height, width, x: 0, y: 0}},
        });
      });
    };

    const expectBoundedNarrowChild = (page: ReactTestInstance): void => {
      const child = page.findByProps({testID: "bounded-child"});
      const childStyle = flattenedStyle(child.props.style);
      expect(childStyle.height).toBe("100%");
      expect(childStyle.position).toBeUndefined();
      expect(page.findByProps({testID: "fixed-section"})).toBeTruthy();
      expect(page.findByProps({testID: "internal-scroll"})).toBeTruthy();
      expect(page.findByProps({testID: "internal-tall"})).toBeTruthy();
    };

    it("bounds a labeled narrow page to the measured pane so a height 100% child can scroll inside it", async () => {
      setMobile();
      const {getAllByLabelText, getByTestId, UNSAFE_root} = renderWithTheme(
        <SplitPage
          {...defaultProps}
          bottomNavBarHeight={24}
          narrowViewportChildLabels={["Summary", "Notes"]}
          narrowViewportListButtonLabel="Back to list"
        >
          {renderFullHeightChild()}
          <View testID="other-child" />
        </SplitPage>
      );
      await selectFirst(getAllByLabelText);
      const pageBeforeLayout = getByTestId("split-page-mobile-child-0");
      expect(flattenedStyle(pageBeforeLayout.props.style).height).toBe("100%");

      layoutPager(getByTestId("split-page-mobile-children"), 360, 320);

      const page = getByTestId("split-page-mobile-child-0");
      const style = flattenedStyle(page.props.style);
      expect(style.height).toBe(360);
      expect(style.overflow).toBe("hidden");
      expect(style.borderRadius).toBe(getRounding("md"));
      expect(style.paddingBottom).toBe(24);
      expect(style.width).toBe(320);
      expectBoundedNarrowChild(page);
      const swiper = flattenedStyle(getByTestId("swiper-flatlist").props.style);
      expect(swiper.height).toBe("100%");
      expect(swiper.overflow).toBeUndefined();
      const next = getIconButtonByTestId(UNSAFE_root, "split-page-column-next");
      const controls = findAncestor(
        next,
        (node) => flattenedStyle(node.props.style).position === "absolute"
      );
      expect(flattenedStyle(controls?.props.style).bottom).toBe(32);
      expect(getIconButtonByTestId(UNSAFE_root, "split-page-back-to-list")).toBeTruthy();
    });

    it("bounds dotted narrow pages to the measured pane and keeps pagination room", async () => {
      setMobile();
      const {getAllByLabelText, getByTestId} = renderWithTheme(
        <SplitPage {...defaultProps} bottomNavBarHeight={16} childColumnRounding="lg">
          {renderFullHeightChild()}
          <View testID="other-child" />
        </SplitPage>
      );
      await selectFirst(getAllByLabelText);
      expect(flattenedStyle(getByTestId("split-page-dotted-child-0").props.style).height).toBe(
        "90%"
      );

      layoutPager(getByTestId("split-page-dotted-pager"), 400, 300);

      const page = getByTestId("split-page-dotted-child-0");
      const style = flattenedStyle(page.props.style);
      expect(style.height).toBe(360);
      expect(style.overflow).toBe("hidden");
      expect(style.borderRadius).toBe(getRounding("lg"));
      expect(style.paddingBottom).toBe(16);
      expect(style.padding).toBe(4);
      expect(style.width).toBe(367);
      expectBoundedNarrowChild(page);
      const swiper = flattenedStyle(getByTestId("swiper-flatlist").props.style);
      expect(swiper.height).toBe("100%");
      expect(swiper.overflow).toBeUndefined();
    });

    it("bounds a single dotted page to the full measured height", async () => {
      setMobile();
      const {getAllByLabelText, getByTestId} = renderWithTheme(
        <SplitPage {...defaultProps}>{renderFullHeightChild()}</SplitPage>
      );
      await selectFirst(getAllByLabelText);
      layoutPager(getByTestId("split-page-dotted-pager"), 410, 300);
      expect(flattenedStyle(getByTestId("split-page-dotted-child-0").props.style).height).toBe(410);
      expectBoundedNarrowChild(getByTestId("split-page-dotted-child-0"));
    });
  });
});
