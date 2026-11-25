import {type FC, memo, useCallback, useMemo} from "react";
import {Pressable, View} from "react-native";

import type {IconName, PaginationProps} from "./Common";
import {Icon} from "./Icon";
import {Text} from "./Text";
import {useTheme} from "./Theme";
import {useStableCallback} from "./useStableCallback";

const ignorePress = (): void => {};

const PaginationButton: FC<{
  type: "first" | "prev" | "next" | "last" | "more";
  onClick: () => void;
  totalPages?: number;
  page?: number;
}> = ({type, onClick, totalPages = 1, page = 1}) => {
  let icon: IconName;
  let disabled = false;

  if (type === "prev") {
    icon = "angle-left";
    disabled = page <= 1;
  } else if (type === "next") {
    icon = "angle-right";
    disabled = page >= totalPages;
  } else if (type === "more") {
    icon = "ellipsis";
  } else {
    throw new Error(`Invalid Pagination Button type ${type}`);
  }
  // TODO: Show text input when tapping more.

  return (
    <Pressable
      accessibilityHint={`Click to go to ${type} page`}
      aria-label="Pagination Button"
      disabled={disabled}
      onPress={onClick}
      style={{
        alignItems: "center",
        display: "flex",
        height: 32,
        justifyContent: "center",
        width: 32,
      }}
    >
      <Icon color={disabled ? "extraLight" : "primary"} iconName={icon} size="md" />
    </Pressable>
  );
};

// Memoized so a page change re-renders the two numbers whose highlight moved, not all of them.
const PaginationNumber: FC<{
  number: number | "more";
  current: boolean;
  onSelect: (page: number) => void;
}> = memo(({number, current, onSelect}) => {
  const handlePress = useCallback((): void => {
    if (number !== "more") {
      onSelect(number);
    }
  }, [number, onSelect]);

  // Shortcut to make rendering the number buttons easier.
  if (number === "more") {
    return <PaginationButton onClick={ignorePress} type="more" />;
  }
  return (
    <Pressable
      accessibilityHint={`Click to go to page ${number}`}
      accessibilityLabel="Pagination Number"
      onPress={handlePress}
      style={{
        alignItems: "center",
        borderRadius: 4,
        display: "flex",
        height: 32,
        justifyContent: "center",
        width: 32,
      }}
    >
      <Text color={current ? "accent" : "primary"}>{number}</Text>
    </Pressable>
  );
});
PaginationNumber.displayName = "PaginationNumber";

export const Pagination: FC<PaginationProps> = ({totalPages, page, setPage, testID}) => {
  const {theme} = useTheme();
  const selectPage = useStableCallback(setPage);

  // Determine the number of pages to show. Show the first page,
  // the page before and after the current page, and the last page.
  const pages: (number | "more")[] = useMemo(() => {
    const pagesResult: (number | "more")[] = [];

    if (totalPages < 6) {
      for (let i = 1; i <= totalPages; i++) {
        pagesResult.push(i);
      }
    } else {
      pagesResult.push(1);

      if (page > 3) {
        pagesResult.push("more");
      } else {
        pagesResult.push(2);
        pagesResult.push(3);
      }

      // This is to help sort the last few numbers of the total pages behind the current page.
      if (page > totalPages - 2 && !pagesResult.includes(totalPages - 2)) {
        pagesResult.push(totalPages - 2);
      }

      if (page > totalPages - 1 && !pagesResult.includes(totalPages - 1)) {
        pagesResult.push(totalPages - 1);
      }

      if (!pagesResult.includes(page)) {
        pagesResult.push(page);
      }

      if (page < totalPages - 2) {
        pagesResult.push("more");
      } else if (page !== totalPages && !pagesResult.includes(totalPages - 1)) {
        pagesResult.push(totalPages - 1);
      }

      if (!pagesResult.includes(totalPages)) {
        pagesResult.push(totalPages);
      }
    }
    return pagesResult;
  }, [page, totalPages]);

  // TODO: Add hover for pagination numbers.

  if (!pages) {
    return null;
  }
  return (
    <View
      style={{
        alignItems: "center",
        display: "flex",
        flexDirection: "row",
        gap: theme.spacing.xs,
      }}
      testID={testID}
    >
      <PaginationButton
        onClick={() => {
          if (page > 1) {
            setPage(page - 1);
          }
        }}
        page={page}
        totalPages={totalPages}
        type="prev"
      />
      {pages.map((number, index) => (
        <PaginationNumber
          current={number === page}
          key={number === "more" ? `more${index}` : number}
          number={number}
          onSelect={selectPage}
        />
      ))}

      <PaginationButton
        onClick={() => {
          setPage(page + 1);
        }}
        page={page}
        totalPages={totalPages}
        type="next"
      />
    </View>
  );
};
