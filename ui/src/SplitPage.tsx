import {
  Children,
  type ComponentProps,
  type ElementRef,
  type ReactElement,
  type ReactNode,
  useCallback,
  useEffect,
  useRef,
  useState,
} from "react";
import {
  type LayoutChangeEvent,
  type ListRenderItemInfo,
  ScrollView,
  useWindowDimensions,
  View,
  type ViewStyle,
} from "react-native";
import {SwiperFlatList} from "react-native-swiper-flatlist";

import {Box} from "./Box";
import {getRounding, getSpacing, type SplitPageListItem, type SplitPageProps} from "./Common";
import {FlatList} from "./FlatList";
import {IconButton} from "./IconButton";
import {isNarrowViewport} from "./MediaQuery";
import {SegmentedControl} from "./SegmentedControl";
import {Spinner} from "./Spinner";
import {useTheme} from "./Theme";

// flex: 1 (basis 0, shrink 1) sizes the content container to the pane. A height: "100%"
// child then stays pane-bounded and can scroll internally. A taller child that does not
// shrink still extends this ScrollView. flexGrow: 1 leaves the basis at the content size,
// so that same height: "100%" child grows with its content instead of the pane.
const desktopChildContentContainerStyle = {flex: 1};

// Matches IconButton's default box. The labeled pager reserves this slot even when the
// arrow is hidden, so the other arrow does not reflow.
const labeledColumnNavButtonHeight = 32;
const labeledPagerEdgeSpacing = getSpacing(2);

const renderDesktopChildColumn = ({
  borderRadius,
  columnKey,
  element,
  paneStyle,
  scrollTestID,
  testID,
}: {
  borderRadius: number;
  columnKey: number;
  element: ReactNode;
  paneStyle: ViewStyle;
  scrollTestID: string;
  testID: string;
}): ReactElement => {
  return (
    <View
      key={columnKey}
      style={{
        ...paneStyle,
        borderRadius,
        height: "100%",
        overflow: "hidden",
      }}
      testID={testID}
    >
      <ScrollView
        contentContainerStyle={desktopChildContentContainerStyle}
        style={{flex: 1, height: "100%"}}
        testID={scrollTestID}
      >
        {element}
      </ScrollView>
    </View>
  );
};

// A component for rendering a list on one side and a details view on the right for large screens,
// and a scrollable list where clicking an item takes you the details view.
// On web, opt in to minimum widths for the desktop side-by-side children, or a labeled pager
// on the narrow viewport. `narrowBelowWidth` chooses that viewport from the window width;
// otherwise it follows `isNarrowViewport()`. The native SplitPage ignores those props.
export const SplitPage = <TItem extends SplitPageListItem = SplitPageListItem>({
  children,
  tabs = [],
  loading = false,
  color,
  keyboardOffset,
  renderListViewItem,
  renderListViewHeader,
  renderContent,
  onSelectionChange = () => {},
  listViewData,
  listViewExtraData,
  listViewWidth,
  listViewMaxWidth,
  bottomNavBarHeight,
  desktopChildrenMinWidth,
  narrowBelowWidth,
  narrowViewportChildLabels,
  narrowViewportListButtonLabel,
  narrowViewportSelectionActive,
  narrowViewportSelectionKey,
  childColumnRounding = "md",
  showItemList,
}: SplitPageProps<TItem>) => {
  const {theme} = useTheme();
  const {width: windowWidth} = useWindowDimensions();
  const [selectedId, setSelectedId] = useState<number | undefined>(undefined);
  const [activeTabs, setActiveTabs] = useState<number[]>([0, 1]);
  const [activeChildIndex, setActiveChildIndex] = useState(0);
  const activeChildIndexRef = useRef(activeChildIndex);
  activeChildIndexRef.current = activeChildIndex;
  const swiperRef = useRef<ElementRef<typeof SwiperFlatList> | null>(null);
  const narrowPagerRef = useRef<ElementRef<typeof View> | null>(null);
  const [desktopScrollWidth, setDesktopScrollWidth] = useState(0);
  const [measuredPageWidth, setMeasuredPageWidth] = useState(0);
  const [measuredPageHeight, setMeasuredPageHeight] = useState(0);

  const isNarrowLayout =
    narrowBelowWidth === undefined ? isNarrowViewport() : windowWidth <= narrowBelowWidth;
  const isDetailActive = selectedId !== undefined || narrowViewportSelectionActive === true;
  const childColumnBorderRadius = getRounding(childColumnRounding);

  const elementArray = Children.toArray(children).filter((c) => c !== null);

  const onItemSelect = useCallback(
    async (item: ListRenderItemInfo<TItem>): Promise<void> => {
      setSelectedId(item.index);
      await onSelectionChange(item);
    },
    [onSelectionChange]
  );

  const onItemDeselect = useCallback(async () => {
    setSelectedId(undefined);
    await onSelectionChange(undefined);
  }, [onSelectionChange]);

  // If the list is showing, deselect the item.
  useEffect(() => {
    if (showItemList) {
      void onItemDeselect();
    }
  }, [showItemList, onItemDeselect]);

  // Reset the narrow pager when the selected record changes. Width changes stay out of this effect
  // so a resize does not jump back to the first child.
  // biome-ignore lint/correctness/useExhaustiveDependencies: these values are the reset triggers.
  useEffect(() => {
    setActiveChildIndex(0);
    swiperRef.current?.scrollToIndex({animated: false, index: 0});
  }, [isDetailActive, isNarrowLayout, narrowViewportSelectionKey, selectedId]);

  // Keep the current child aligned after the page width changes, without snapping over a chevron animation.
  // biome-ignore lint/correctness/useExhaustiveDependencies: widths are the realign triggers; the index is read from a ref.
  useEffect(() => {
    swiperRef.current?.scrollToIndex({
      animated: false,
      index: activeChildIndexRef.current,
    });
  }, [measuredPageWidth, windowWidth]);

  const rememberNarrowPagerSize = useCallback((width: number, height: number): void => {
    if (width > 0) {
      setMeasuredPageWidth((current) => (current === width ? current : width));
    }
    if (height > 0) {
      setMeasuredPageHeight((current) => (current === height ? current : height));
    }
  }, []);

  const onNarrowPagerLayout = useCallback(
    (event: LayoutChangeEvent): void => {
      const {height, width} = event.nativeEvent.layout;
      rememberNarrowPagerSize(width, height);
    },
    [rememberNarrowPagerSize]
  );

  // The pager frame is already the visible height. Reading it here covers the case where
  // the view's onLayout callback does not run after the frame settles.
  useEffect(() => {
    if (!isNarrowLayout || !isDetailActive) {
      return;
    }
    const node = narrowPagerRef.current as unknown as HTMLElement | null;
    if (
      node == null ||
      typeof node.offsetHeight !== "number" ||
      typeof ResizeObserver === "undefined"
    ) {
      return;
    }
    const measure = (): void => {
      rememberNarrowPagerSize(node.offsetWidth, node.offsetHeight);
    };
    measure();
    const observer = new ResizeObserver(() => {
      measure();
    });
    observer.observe(node);
    return () => {
      observer.disconnect();
    };
  }, [rememberNarrowPagerSize, isNarrowLayout, isDetailActive]);

  if (!children && !renderContent) {
    console.warn("A child node is required");
    return null;
  }

  if (elementArray.length > 2 && elementArray.length !== tabs.length) {
    console.warn("There must be a tab for each child");
    return null;
  }

  if (desktopChildrenMinWidth !== undefined && elementArray.length > 2) {
    console.warn("desktopChildrenMinWidth applies only when SplitPage has two or fewer children.");
  }

  if (
    narrowViewportChildLabels !== undefined &&
    narrowViewportChildLabels.length !== elementArray.length
  ) {
    console.warn(
      "narrowViewportChildLabels must have one entry per child. Falling back to the default narrow pager."
    );
  }

  const renderItem = (itemInfo: ListRenderItemInfo<TItem>) => {
    return (
      <Box
        accessibilityHint=""
        accessibilityLabel="Select"
        onClick={async () => {
          await onItemSelect(itemInfo);
        }}
      >
        {renderListViewItem(itemInfo)}
      </Box>
    );
  };

  const renderList = () => {
    return (
      <View
        style={{
          display: "flex",
          flexDirection: "column",
          flexGrow: 1,
          flexShrink: 0,
          maxWidth: listViewMaxWidth ?? listViewWidth ?? 300,
          width: listViewWidth ?? 300,
        }}
      >
        {renderListViewHeader?.()}
        <FlatList
          data={listViewData}
          extraData={listViewExtraData}
          keyExtractor={(item) => item.id}
          renderItem={renderItem}
        />
      </View>
    );
  };

  const renderListContent = () => {
    return (
      <Box flex="grow" padding={2}>
        {renderContent?.(selectedId)}
      </Box>
    );
  };

  const renderChildrenContent = () => {
    if (Array.isArray(children) && elementArray.length > 2) {
      return (
        <View
          style={{
            alignItems: "center",
            flex: 1,
            height: "100%",
            width: "100%",
          }}
        >
          <Box marginBottom={4} paddingX={4} width="100%">
            <SegmentedControl
              items={tabs}
              onChange={(index) => {
                setActiveTabs([...([index] as number[])]);
              }}
              selectedIndex={activeTabs[0]}
            />
          </Box>
          <Box
            direction="row"
            flex="grow"
            height="100%"
            paddingX={4}
            width={activeTabs.length > 1 ? "100%" : "60%"}
          >
            {activeTabs.map((tabIndex, i) => {
              return renderDesktopChildColumn({
                borderRadius: childColumnBorderRadius,
                columnKey: tabIndex,
                element: elementArray[tabIndex],
                paneStyle: {
                  flex: 1,
                  paddingLeft: i ? 16 : 0,
                  paddingRight: i ? 0 : 16,
                  width: "60%",
                },
                scrollTestID: `split-page-desktop-child-scroll-${i}`,
                testID: `split-page-desktop-segment-child-${i}`,
              });
            })}
          </Box>
        </View>
      );
    }

    if (
      desktopChildrenMinWidth !== undefined &&
      elementArray.length >= 1 &&
      elementArray.length <= 2
    ) {
      const childCount = elementArray.length;
      const childWidth =
        desktopScrollWidth > 0
          ? Math.max(desktopChildrenMinWidth, desktopScrollWidth / childCount)
          : desktopChildrenMinWidth;
      const rowWidth = Math.max(
        desktopScrollWidth,
        desktopChildrenMinWidth * childCount,
        childWidth * childCount
      );
      return (
        <ScrollView
          contentContainerStyle={{flexDirection: "row", width: rowWidth}}
          horizontal
          nestedScrollEnabled
          onLayout={(event: LayoutChangeEvent) => {
            const nextWidth = event.nativeEvent.layout.width;
            setDesktopScrollWidth((current) => (current === nextWidth ? current : nextWidth));
          }}
          style={{flex: 1, height: "100%"}}
          testID="split-page-desktop-children-scroll"
        >
          {elementArray.map((element, index) => {
            return renderDesktopChildColumn({
              borderRadius: childColumnBorderRadius,
              columnKey: index,
              element,
              paneStyle: {
                flexGrow: 0,
                flexShrink: 0,
                maxWidth: childWidth,
                width: childWidth,
              },
              scrollTestID: `split-page-desktop-child-scroll-${index}`,
              testID: `split-page-desktop-child-${index}`,
            });
          })}
        </ScrollView>
      );
    }

    return (
      <Box alignItems="center" direction="row" flex="grow" justifyContent="center" paddingX={2}>
        {elementArray.map((element, index) => {
          return renderDesktopChildColumn({
            borderRadius: childColumnBorderRadius,
            columnKey: index,
            element,
            paneStyle: {
              flex: 1,
              width: "60%",
            },
            scrollTestID: `split-page-desktop-child-scroll-${index}`,
            testID: `split-page-desktop-row-child-${index}`,
          });
        })}
      </Box>
    );
  };

  const renderMobileList = () => {
    if (isNarrowLayout && isDetailActive) {
      return null;
    }

    return (
      <View
        style={{
          display: "flex",
          flexDirection: "column",
          flexGrow: 1,
          flexShrink: 0,
          height: "100%",
          maxWidth: "100%",
          width: "100%",
        }}
      >
        {renderListViewHeader?.()}
        <FlatList
          data={listViewData}
          extraData={listViewExtraData}
          keyExtractor={(item) => item.id}
          nestedScrollEnabled
          renderItem={renderItem}
        />
      </View>
    );
  };

  const renderMobileListContent = () => {
    if (isNarrowLayout && !isDetailActive) {
      return null;
    }

    return (
      <Box flex="grow" padding={2}>
        {isNarrowLayout && (
          <Box width="100%">
            <IconButton
              accessibilityHint="close split page"
              accessibilityLabel="close"
              iconName="xmark"
              onClick={() => onItemDeselect()}
            />
          </Box>
        )}
        {renderContent?.(selectedId)}
      </Box>
    );
  };

  const showMobileChild = (destination: number): void => {
    setActiveChildIndex(destination);
    swiperRef.current?.scrollToIndex({animated: true, index: destination});
  };

  // The horizontal pager's content container sizes to its children, so height: "100%" on a page
  // grows with the child instead of the visible pane. overflowY: hidden on that pager then clips
  // the extra height. A measured pixel height gives the page a definite box: rounded corners still
  // clip, and a height: "100%" child can scroll inside that box.
  const narrowPageHeight = (ratio: number): number | "100%" | "90%" => {
    if (measuredPageHeight > 0) {
      return measuredPageHeight * ratio;
    }
    return ratio === 1 ? "100%" : "90%";
  };

  const renderLabeledMobilePager = (labels: string[]) => {
    const pageWidth = measuredPageWidth > 0 ? measuredPageWidth : windowWidth;
    const lastIndex = elementArray.length - 1;
    const navInset = bottomNavBarHeight ?? 0;
    const labeledChromeHeight =
      labeledPagerEdgeSpacing +
      labeledPagerEdgeSpacing +
      labeledColumnNavButtonHeight +
      labeledPagerEdgeSpacing +
      navInset;
    const columnHeight =
      measuredPageHeight > 0 ? Math.max(measuredPageHeight - labeledChromeHeight, 0) : undefined;
    const navSlotStyle: ViewStyle = {
      alignItems: "center",
      flexShrink: 0,
      height: labeledColumnNavButtonHeight,
      justifyContent: "center",
      width: labeledColumnNavButtonHeight,
    };
    return (
      <View
        onLayout={onNarrowPagerLayout}
        ref={narrowPagerRef}
        style={{flex: 1, height: "100%", minHeight: 0, width: "100%"}}
        testID="split-page-mobile-children"
      >
        <View
          style={{flexShrink: 0, height: labeledPagerEdgeSpacing}}
          testID="split-page-column-top-space"
        />
        <SwiperFlatList
          getItemLayout={(_data, index) => ({
            index,
            length: pageWidth,
            offset: pageWidth * index,
          })}
          nestedScrollEnabled
          onChangeIndex={({index}) => {
            setActiveChildIndex(index);
          }}
          ref={swiperRef}
          renderAll
          style={{
            flexGrow: columnHeight === undefined ? 1 : 0,
            flexShrink: 1,
            height: columnHeight,
            minHeight: 0,
            width: "100%",
          }}
        >
          {elementArray.map((element, index) => {
            return (
              <View
                key={index}
                style={{
                  borderRadius: childColumnBorderRadius,
                  height: columnHeight ?? "100%",
                  overflow: "hidden",
                  padding: 0,
                  width: pageWidth,
                }}
                testID={`split-page-mobile-child-${index}`}
              >
                {element}
              </View>
            );
          })}
        </SwiperFlatList>
        <View
          style={{
            alignItems: "center",
            flexDirection: "row",
            flexShrink: 0,
            height: labeledColumnNavButtonHeight,
            justifyContent: "space-between",
            marginTop: labeledPagerEdgeSpacing,
            paddingHorizontal: getSpacing(4),
          }}
          testID="split-page-column-nav"
        >
          <View
            style={{
              alignItems: "center",
              flexDirection: "row",
              flexShrink: 0,
              gap: labeledPagerEdgeSpacing,
            }}
          >
            {narrowViewportListButtonLabel ? (
              <View style={navSlotStyle} testID="split-page-column-back-slot">
                <IconButton
                  accessibilityHint={narrowViewportListButtonLabel}
                  accessibilityLabel={narrowViewportListButtonLabel}
                  iconName="arrow-left"
                  onClick={() => onItemDeselect()}
                  testID="split-page-back-to-list"
                />
              </View>
            ) : null}
            <View accessible={false} style={navSlotStyle} testID="split-page-column-previous-slot">
              {activeChildIndex > 0 ? (
                <IconButton
                  accessibilityLabel={`Show previous column: ${labels[activeChildIndex - 1]}`}
                  iconName="chevron-left"
                  onClick={() => {
                    showMobileChild(activeChildIndex - 1);
                  }}
                  testID="split-page-column-previous"
                />
              ) : null}
            </View>
          </View>
          <View accessible={false} style={navSlotStyle} testID="split-page-column-next-slot">
            {activeChildIndex < lastIndex ? (
              <IconButton
                accessibilityLabel={`Show next column: ${labels[activeChildIndex + 1]}`}
                iconName="chevron-right"
                onClick={() => {
                  showMobileChild(activeChildIndex + 1);
                }}
                testID="split-page-column-next"
              />
            ) : null}
          </View>
        </View>
        <View
          style={{flexShrink: 0, height: labeledPagerEdgeSpacing + navInset}}
          testID="split-page-column-bottom-space"
        />
      </View>
    );
  };

  const renderMobileChildrenContent = () => {
    if (!isDetailActive) {
      return null;
    }
    if (
      isNarrowLayout &&
      elementArray.length > 1 &&
      narrowViewportChildLabels !== undefined &&
      narrowViewportChildLabels.length === elementArray.length
    ) {
      return renderLabeledMobilePager(narrowViewportChildLabels);
    }
    const pageRatio = elementArray.length > 1 ? 0.9 : 1;
    return (
      <View
        onLayout={onNarrowPagerLayout}
        ref={narrowPagerRef}
        style={{flex: 1, height: "100%", minHeight: 0, width: "100%"}}
        testID="split-page-dotted-pager"
      >
        <SwiperFlatList
          nestedScrollEnabled
          paginationStyle={{justifyContent: "center", width: "95%"}}
          renderAll
          showPagination
          style={{height: "100%", width: "100%"}}
        >
          {elementArray.map((element, i) => {
            return (
              <View
                key={i}
                style={{
                  borderRadius: childColumnBorderRadius,
                  height: narrowPageHeight(pageRatio),
                  overflow: "hidden",
                  padding: 4,
                  paddingBottom: bottomNavBarHeight,
                  width: windowWidth - 8,
                }}
                testID={`split-page-dotted-child-${i}`}
              >
                {element}
              </View>
            );
          })}
        </SwiperFlatList>
      </View>
    );
  };

  const renderSplitPage = () => {
    return (
      <>
        {renderList()}
        {renderContent ? renderListContent() : renderChildrenContent()}
      </>
    );
  };

  const renderMobileSplitPage = () => {
    const renderMainContent = renderContent
      ? renderMobileListContent()
      : renderMobileChildrenContent();
    return isDetailActive ? renderMainContent : renderMobileList();
  };

  const isLabeledPagerBody =
    isNarrowLayout &&
    isDetailActive &&
    !renderContent &&
    elementArray.length > 1 &&
    narrowViewportChildLabels !== undefined &&
    narrowViewportChildLabels.length === elementArray.length;

  return (
    <Box
      avoidKeyboard
      color={color || "baseAlternate"}
      direction="row"
      display="flex"
      height="100%"
      keyboardOffset={keyboardOffset}
      padding={isLabeledPagerBody ? 0 : 2}
      width="100%"
    >
      {loading === true && (
        <Spinner
          color={theme.text.primary as unknown as ComponentProps<typeof Spinner>["color"]}
          size="md"
        />
      )}
      {isNarrowLayout ? renderMobileSplitPage() : renderSplitPage()}
    </Box>
  );
};
