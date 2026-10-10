// TODO: Update SplitPage native to have desktop UX for tablet sized screens
import {useCallback, useEffect, useState} from "react";
import flattenChildren from "react-keyed-flatten-children";
import {Dimensions, type ListRenderItemInfo, View} from "react-native";
import {SwiperFlatList} from "react-native-swiper-flatlist";

import {Box} from "./Box";
import type {SplitPageListItem, SplitPageProps} from "./Common";
import {FlatList} from "./FlatList";
import {IconButton} from "./IconButton";
import {Spinner} from "./Spinner";
import {Unifier} from "./Unifier";

export const SplitPage = <TItem extends SplitPageListItem = SplitPageListItem>({
  children,
  loading = false,
  color,
  keyboardOffset,
  renderListViewItem,
  renderListViewHeader,
  renderContent,
  onSelectionChange = () => {},
  listViewData,
  listViewExtraData,
  bottomNavBarHeight,
  showItemList,
}: SplitPageProps<TItem>) => {
  const [selectedId, setSelectedId] = useState<number | undefined>(undefined);

  // flattenChildren is necessary to pull children from a React Fragment. Without this,
  // splitPage would only recognize the fragment container instead stripping it to render
  // the children individually
  const elementArray = flattenChildren(children);
  const {width} = Dimensions.get("window");

  const onItemSelect = useCallback(
    async (item: ListRenderItemInfo<TItem>): Promise<void> => {
      setSelectedId(item.index);
      await onSelectionChange(item);
    },
    [onSelectionChange]
  );

  const onItemDeselect = useCallback(async (): Promise<void> => {
    setSelectedId(undefined);
    await onSelectionChange(undefined);
  }, [onSelectionChange]);

  // If the list is showing, deselect the item.
  useEffect(() => {
    if (showItemList) {
      void onItemDeselect();
    }
  }, [showItemList, onItemDeselect]);

  if (!children && !renderContent) {
    console.warn("A child node is required");
    return null;
  }

  const renderItem = (itemInfo: ListRenderItemInfo<TItem>) => {
    return (
      <Box
        accessibilityHint=""
        accessibilityLabel="Edit"
        onClick={async () => {
          await Unifier.utils.haptic();
          await onItemSelect(itemInfo);
        }}
      >
        {renderListViewItem(itemInfo)}
      </Box>
    );
  };

  const renderList = () => {
    if (selectedId !== undefined) {
      return null;
    }

    return (
      <View
        style={{
          display: "flex",
          flexDirection: "column",
          flexGrow: 1,
          flexShrink: 0,
          maxWidth: "100%",
          paddingBottom: bottomNavBarHeight,
          width: "100%",
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
    if (selectedId === undefined) {
      return null;
    }
    return (
      <Box flex="grow" padding={2}>
        <Box width="100%">
          <IconButton
            accessibilityHint="close split page"
            accessibilityLabel="close"
            iconName="xmark"
            onClick={() => onItemDeselect()}
          />
        </Box>
        {renderContent?.(selectedId)}
      </Box>
    );
  };

  const renderChildrenContent = () => {
    if (selectedId === undefined) {
      return null;
    }
    return (
      <SwiperFlatList
        nestedScrollEnabled
        renderAll
        showPagination={elementArray.length > 1}
        style={{width: "100%"}}
      >
        {elementArray.map((element, i) => {
          return (
            <View
              key={`${element?.toString() ?? ""}-${i}`}
              style={{height: elementArray.length > 1 ? "95%" : "100%", padding: 4, width}}
            >
              {element}
            </View>
          );
        })}
      </SwiperFlatList>
    );
  };

  const renderMainContent = renderContent ? renderListContent() : renderChildrenContent();

  return (
    <Box
      avoidKeyboard
      color={color || "baseAlternate"}
      flex="grow"
      height="100%"
      keyboardOffset={keyboardOffset}
      width="100%"
    >
      {loading === true && <Spinner color="light" size="md" />}
      {selectedId === undefined ? renderList() : renderMainContent}
    </Box>
  );
};
