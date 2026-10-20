import {router, Stack, useGlobalSearchParams, usePathname, useSegments} from "expo-router";
import {
  type ComponentProps,
  createContext,
  type FC,
  type ReactElement,
  useCallback,
  useContext,
  useState,
} from "react";
import {type LayoutChangeEvent, useWindowDimensions, View} from "react-native";
import {SafeAreaView} from "react-native-safe-area-context";

import type {ListDetailLayoutProps, ListDetailState} from "./Common";
import {useTheme} from "./Theme";

const DEFAULT_SPLIT_AT_WIDTH = 768;
const DEFAULT_LIST_WIDTH = 360;
const DEFAULT_DETAIL_ROUTE = "[id]";
const DEFAULT_PARAM_NAME = "id";

// With the list already on screen, the detail needs no back button or push animation.
const SPLIT_SCREEN_OPTIONS = {animation: "none", headerBackVisible: false} as const;

type StackScreenOptions = ComponentProps<typeof Stack>["screenOptions"];

interface ListDetailContextValue extends ListDetailState {
  emptyDetail?: ReactElement;
  list: ReactElement;
}

const mergeSplitScreenOptions = (
  isSplit: boolean,
  screenOptions: StackScreenOptions
): StackScreenOptions => {
  if (!isSplit) {
    return screenOptions;
  }
  if (typeof screenOptions === "function") {
    return (props) => ({...SPLIT_SCREEN_OPTIONS, ...screenOptions(props)});
  }
  return {...SPLIT_SCREEN_OPTIONS, ...screenOptions};
};

// The open item is the detail route directly below the group's index; an `id` from a parent
// dynamic segment or a deeper route never counts.
const useSelectedId = ({
  detailRoute,
  indexHref,
  paramName,
}: {
  detailRoute: string;
  indexHref: string;
  paramName: string;
}): string | undefined => {
  const pathname = usePathname();
  const segments = useSegments();
  const params = useGlobalSearchParams();

  if (segments[segments.length - 1] !== detailRoute) {
    return undefined;
  }
  const raw = params[paramName];
  const value = Array.isArray(raw) ? raw[0] : raw;
  if (!value) {
    return undefined;
  }
  // The detail must sit directly below the index. Ids may contain "/", so compare whole paths.
  const indexPath = indexHref.replace(/\/+$/, "");
  const isDirectChild =
    pathname === `${indexPath}/${value}` ||
    pathname === `${indexPath}/${encodeURIComponent(value)}`;
  return isDirectChild ? value : undefined;
};

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
  const {clear, isSplit, select, selectedId} = useListDetailContext();
  return {clear, isSplit, select, selectedId};
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
  detailHref,
  indexHref,
  emptyDetail,
  detailRoute = DEFAULT_DETAIL_ROUTE,
  paramName = DEFAULT_PARAM_NAME,
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

  const selectedId = useSelectedId({detailRoute, indexHref, paramName});

  // When split, swap the open detail in place so back always returns to the list.
  const select = useCallback(
    (id: string): void => {
      if (!isSplit || selectedId === undefined) {
        router.push(detailHref(id));
        return;
      }
      if (id !== selectedId) {
        router.replace(detailHref(id));
      }
    },
    [detailHref, isSplit, selectedId]
  );

  // Pop back to the index inside this Stack. A detail opened from outside the group has no
  // index below it, so dismissTo replaces it with the index rather than leaving the group.
  const clear = useCallback((): void => {
    if (selectedId === undefined) {
      return;
    }
    router.dismissTo(indexHref);
  }, [indexHref, selectedId]);

  const contextValue: ListDetailContextValue = {
    clear,
    emptyDetail,
    isSplit,
    list,
    select,
    selectedId,
  };

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
          <Stack screenOptions={mergeSplitScreenOptions(isSplit, screenOptions)}>{children}</Stack>
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
