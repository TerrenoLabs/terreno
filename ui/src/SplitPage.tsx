import {
  Children,
  type ComponentProps,
  type ElementRef,
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
} from "react-native";
import {SwiperFlatList} from "react-native-swiper-flatlist";

import {Box} from "./Box";
import type {SplitPageListItem, SplitPageProps} from "./Common";
import {FlatList} from "./FlatList";
import {IconButton} from "./IconButton";
import {isNarrowViewport} from "./MediaQuery";
import {SegmentedControl} from "./SegmentedControl";
import {Spinner} from "./Spinner";
import {useTheme} from "./Theme";

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
  const [desktopScrollWidth, setDesktopScrollWidth] = useState(0);
  const [measuredPageWidth, setMeasuredPageWidth] = useState(0);

  const isNarrowLayout =
    narrowBelowWidth === undefined ? isNarrowViewport() : windowWidth <= narrowBelowWidth;
  const isDetailActive = selectedId !== undefined || narrowViewportSelectionActive === true;

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
              return (
                <ScrollView
                  contentContainerStyle={{
                    flex: 1,
                  }}
                  key={tabIndex}
                  style={{
                    flex: 1,
                    height: "100%",
                    paddingLeft: i ? 16 : 0,
                    paddingRight: i ? 0 : 16,
                    width: "60%",
                  }}
                >
                  {elementArray[tabIndex]}
                </ScrollView>
              );
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
            return (
              <ScrollView
                contentContainerStyle={{flexGrow: 1}}
                key={index}
                style={{
                  flexGrow: 0,
                  flexShrink: 0,
                  height: "100%",
                  maxWidth: childWidth,
                  width: childWidth,
                }}
                testID={`split-page-desktop-child-${index}`}
              >
                {element}
              </ScrollView>
            );
          })}
        </ScrollView>
      );
    }

    return (
      <Box alignItems="center" direction="row" flex="grow" justifyContent="center" paddingX={2}>
        {elementArray.map((element, index) => {
          return (
            <ScrollView
              contentContainerStyle={{
                flex: 1,
              }}
              key={index}
              style={{
                flex: 1,
                height: "100%",
                width: "60%",
              }}
            >
              {element}
            </ScrollView>
          );
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

  const renderLabeledMobilePager = (labels: string[]) => {
    const pageWidth = measuredPageWidth > 0 ? measuredPageWidth : windowWidth;
    const lastIndex = elementArray.length - 1;
    const controlBottom = (bottomNavBarHeight ?? 0) + 8;
    return (
      <View
        onLayout={(event: LayoutChangeEvent) => {
          const nextWidth = event.nativeEvent.layout.width;
          setMeasuredPageWidth((current) => (current === nextWidth ? current : nextWidth));
        }}
        style={{flex: 1, width: "100%"}}
        testID="split-page-mobile-children"
      >
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
          style={{width: "100%"}}
        >
          {elementArray.map((element, index) => {
            return (
              <View
                key={index}
                style={{
                  height: "100%",
                  padding: 0,
                  paddingBottom: bottomNavBarHeight,
                  width: pageWidth,
                }}
                testID={`split-page-mobile-child-${index}`}
              >
                {element}
              </View>
            );
          })}
        </SwiperFlatList>
        {narrowViewportListButtonLabel ? (
          <View
            style={{
              bottom: controlBottom,
              left: 16,
              position: "absolute",
              zIndex: 1,
            }}
          >
            <IconButton
              accessibilityHint={narrowViewportListButtonLabel}
              accessibilityLabel={narrowViewportListButtonLabel}
              backgroundOpacity={0.88}
              iconName="arrow-left"
              onClick={() => onItemDeselect()}
              testID="split-page-back-to-list"
              variant="muted"
            />
          </View>
        ) : null}
        <View
          style={{
            bottom: controlBottom,
            flexDirection: "row",
            gap: 8,
            position: "absolute",
            right: 16,
            zIndex: 1,
          }}
        >
          {activeChildIndex > 0 ? (
            <IconButton
              accessibilityLabel={`Show previous column: ${labels[activeChildIndex - 1]}`}
              backgroundOpacity={0.88}
              iconName="chevron-left"
              onClick={() => {
                showMobileChild(activeChildIndex - 1);
              }}
              testID="split-page-column-previous"
              variant="muted"
            />
          ) : null}
          {activeChildIndex < lastIndex ? (
            <IconButton
              accessibilityLabel={`Show next column: ${labels[activeChildIndex + 1]}`}
              backgroundOpacity={0.88}
              iconName="chevron-right"
              onClick={() => {
                showMobileChild(activeChildIndex + 1);
              }}
              testID="split-page-column-next"
              variant="muted"
            />
          ) : null}
        </View>
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
    return (
      <SwiperFlatList
        nestedScrollEnabled
        paginationStyle={{justifyContent: "center", width: "95%"}}
        renderAll
        showPagination
        style={{width: "100%"}}
      >
        {elementArray.map((element, i) => {
          return (
            <View
              key={i}
              style={{
                height: elementArray.length > 1 ? "90%" : "100%",
                padding: 4,
                paddingBottom: bottomNavBarHeight,
                width: windowWidth - 8,
              }}
            >
              {element}
            </View>
          );
        })}
      </SwiperFlatList>
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
