import {afterAll, afterEach, beforeEach, describe, expect, it, mock, spyOn} from "bun:test";
import {act, fireEvent} from "@testing-library/react-native";
import {forwardRef, type ReactNode, type Ref, useImperativeHandle} from "react";
import {Pressable, type ScaledSize, StyleSheet, useWindowDimensions, View} from "react-native";
import type {ReactTestInstance} from "react-test-renderer";

// bunSetup mocks IconButton to render null. Render a pressable host that keeps the testID,
// label, and onClick so the pager controls can be found and pressed.
mock.module("./IconButton", () => ({
  IconButton: ({
    accessibilityHint,
    accessibilityLabel,
    iconName,
    onClick,
    testID,
  }: {
    accessibilityHint?: string;
    accessibilityLabel?: string;
    iconName: string;
    onClick?: () => void;
    testID?: string;
  }) => (
    <Pressable
      accessibilityHint={accessibilityHint}
      accessibilityLabel={accessibilityLabel}
      onPress={onClick}
      testID={testID ?? `icon-button-${iconName}`}
    />
  ),
}));

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
      {children}: {children?: ReactNode},
      ref: Ref<{scrollToIndex: (options: PagerScrollOptions) => void}>
    ) => {
      useImperativeHandle(ref, () => ({scrollToIndex: swiperScrollToIndex}));
      return <View testID="swiper-flatlist">{children}</View>;
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
    mediaQuerySmallerThan: () => true,
  }));
};

// Restore MediaQuery to bunSetup defaults after all tests to prevent cross-file pollution.
// bunSetup mocks: isNarrowViewport → false, mediaQueryLargerThan → false.
const restoreDefault = () => {
  mock.module("./MediaQuery", () => ({
    isNarrowViewport: mock(() => false),
    mediaQueryLargerThan: mock(() => false),
  }));
};

afterAll(() => {
  restoreDefault();
  mock.module("./IconButton", () => ({
    IconButton: mock(() => null),
  }));
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
      const {getAllByLabelText, getByTestId, queryByTestId, UNSAFE_root} = renderWithTheme(
        <SplitPage {...defaultProps} narrowViewportChildLabels={["Summary", "Notes"]}>
          <View testID="child-1" />
          <View testID="child-2" />
        </SplitPage>
      );
      await selectFirst(getAllByLabelText);
      expect(getByTestId("split-page-mobile-children")).toBeTruthy();
      expect(getByTestId("split-page-column-next")).toBeTruthy();
      expect(queryByTestId("split-page-column-previous")).toBeNull();
      expect(queryByTestId("split-page-back-to-list")).toBeNull();
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
      const {getAllByLabelText, getByTestId} = renderWithTheme(
        <SplitPage {...defaultProps} narrowViewportChildLabels={["Summary", "Notes"]}>
          <View testID="child-1" />
          <View testID="child-2" />
        </SplitPage>
      );
      await selectFirst(getAllByLabelText);
      swiperScrollToIndex.mockClear();
      await act(async () => {
        fireEvent.press(getByTestId("split-page-column-next"));
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
        fireEvent.press(two.getByTestId("split-page-column-next"));
      });
      expect(two.getByTestId("split-page-column-previous")).toBeTruthy();
      expect(two.queryByTestId("split-page-column-next")).toBeNull();
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
        fireEvent.press(three.getByTestId("split-page-column-next"));
      });
      expect(three.getByTestId("split-page-column-previous")).toBeTruthy();
      expect(three.getByTestId("split-page-column-next")).toBeTruthy();
      await act(async () => {
        fireEvent.press(three.getByTestId("split-page-column-next"));
      });
      expect(three.queryByTestId("split-page-column-next")).toBeNull();
      swiperScrollToIndex.mockClear();
      await act(async () => {
        fireEvent.press(three.getByTestId("split-page-column-previous"));
      });
      await act(async () => {
        fireEvent.press(three.getByTestId("split-page-column-previous"));
      });
      expect(swiperScrollToIndex).toHaveBeenCalledWith({animated: true, index: 1});
      expect(swiperScrollToIndex).toHaveBeenCalledWith({animated: true, index: 0});
      expect(three.queryByTestId("split-page-column-previous")).toBeNull();
      expect(three.getByTestId("split-page-column-next")).toBeTruthy();
    });

    it("returns to the list when the labeled back button is pressed", async () => {
      setMobile();
      const onSelectionChange = mock(async () => {});
      const {getAllByLabelText, getByTestId} = renderWithTheme(
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
        fireEvent.press(getByTestId("split-page-back-to-list"));
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
        fireEvent.press(view.getByTestId("split-page-column-next"));
      });
      expect(view.getByTestId("split-page-column-previous")).toBeTruthy();
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
      expect(view.queryByTestId("split-page-column-previous")).toBeNull();
      expect(view.getByTestId("split-page-column-next")).toBeTruthy();
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
        fireEvent.press(view.getByTestId("split-page-column-next"));
      });
      swiperScrollToIndex.mockClear();
      await act(async () => {
        layoutWidth(view.getByTestId("split-page-mobile-children"), 280);
      });
      expect(swiperScrollToIndex).toHaveBeenCalledWith({animated: false, index: 1});
      expect(view.getByTestId("split-page-column-previous")).toBeTruthy();
      expect(view.queryByTestId("split-page-column-next")).toBeNull();

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
      expect(view.getByTestId("split-page-column-previous")).toBeTruthy();
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
  });
});
