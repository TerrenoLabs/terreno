import {Stack} from "expo-router";
import {createContext, type FC, type ReactElement, useCallback, useContext, useState} from "react";
import {type LayoutChangeEvent, useWindowDimensions, View} from "react-native";
import {SafeAreaView} from "react-native-safe-area-context";

import type {ListDetailLayoutProps, ListDetailState} from "./Common";
import {useTheme} from "./Theme";

const DEFAULT_SPLIT_AT_WIDTH = 768;
const DEFAULT_LIST_WIDTH = 360;

interface ListDetailContextValue {
  emptyDetail?: ReactElement;
  isSplit: boolean;
  list: ReactElement;
}

const ListDetailContext = createContext<ListDetailContextValue | null>(null);

const useListDetailContext = (): ListDetailContextValue => {
  const context = useContext(ListDetailContext);
  if (!context) {
    throw new Error("useListDetail must be used inside a ListDetailLayout");
  }
  return context;
};

/**
 * Reads the list/detail layout state from the nearest ListDetailLayout.
 */
export const useListDetail = (): ListDetailState => {
  const {isSplit} = useListDetailContext();
  return {isSplit};
};

/**
 * Route-driven list/detail layout for a route group's `_layout.tsx`. On a narrow layout it is
 * an expo-router Stack: the index route shows the list and pushes the detail route. When the
 * layout is at least `splitAtWidth` wide, the list stays in a left pane and the Stack shows
 * the detail beside it. The Stack never moves in the tree, so crossing the breakpoint keeps
 * the open route. `list` moves between the index screen and the left pane, so it remounts:
 * keep list state such as filters or search text in the route or a store.
 *
 * ```tsx
 * // app/mail/_layout.tsx
 * export const unstable_settings = {initialRouteName: "index"};
 * const MailLayout: React.FC = () => (
 *   <ListDetailLayout
 *     detailHref={(id) => `/mail/${id}`}
 *     emptyDetail={<Text>Select a message</Text>}
 *     indexHref="/mail"
 *     list={<MailList />}
 *   />
 * );
 * // app/mail/index.tsx
 * const MailIndex: React.FC = () => <ListDetailIndex />;
 * ```
 */
export const ListDetailLayout: FC<ListDetailLayoutProps> = ({
  list,
  emptyDetail,
  splitAtWidth = DEFAULT_SPLIT_AT_WIDTH,
  listWidth = DEFAULT_LIST_WIDTH,
  screenOptions,
  children,
}) => {
  const {theme} = useTheme();
  const {width: windowWidth} = useWindowDimensions();
  const [measuredWidth, setMeasuredWidth] = useState<number | undefined>(undefined);

  // The layout may sit beside a sidebar, so its own width decides the split. The window
  // width stands in until the first layout event.
  const isSplit = (measuredWidth ?? windowWidth) >= splitAtWidth;

  const onLayout = useCallback((event: LayoutChangeEvent): void => {
    const {width} = event.nativeEvent.layout;
    if (width > 0) {
      setMeasuredWidth(width);
    }
  }, []);

  const contextValue: ListDetailContextValue = {emptyDetail, isSplit, list};

  return (
    <ListDetailContext.Provider value={contextValue}>
      <View onLayout={onLayout} style={{flex: 1, flexDirection: "row"}} testID="list-detail-layout">
        {/* Keep this slot even when empty so the detail pane, and its Stack, never remount. */}
        {isSplit ? (
          <View
            style={{
              borderRightColor: theme.border.default,
              borderRightWidth: 1,
              flexShrink: 0,
              width: listWidth,
            }}
            testID="list-detail-list-pane"
          >
            {/* The pane has no Stack header, so it insets itself where it meets the screen edges. */}
            <SafeAreaView edges={["top", "left", "bottom"]} style={{flex: 1}}>
              {list}
            </SafeAreaView>
          </View>
        ) : null}
        <View style={{flex: 1, minWidth: 0}} testID="list-detail-detail-pane">
          <Stack screenOptions={screenOptions}>{children}</Stack>
        </View>
      </View>
    </ListDetailContext.Provider>
  );
};

/**
 * The route group's `index.tsx` screen. Shows the list when stacked, and the empty detail
 * state when the list already sits in the left pane.
 */
export const ListDetailIndex: FC = () => {
  const {emptyDetail, isSplit, list} = useListDetailContext();
  if (!isSplit) {
    return list;
  }
  return (
    <View style={{flex: 1}} testID="list-detail-empty">
      {emptyDetail}
    </View>
  );
};
