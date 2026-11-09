// TableHeaderCell.tsx
import FontAwesome6 from "@expo/vector-icons/FontAwesome6";
import {type ReactElement, useCallback} from "react";

import {Box} from "../Box";
import type {AlignItems, TableHeaderCellProps} from "../Common";
import {useTheme} from "../Theme";
import {TableTitle} from "./TableTitle";
import {useTableContext} from "./tableContext";

/**
 * Use TableHeaderCell to define a header cell in Table.
 */
export const TableHeaderCell = ({
  children,
  index,
  sortable,
  align = "left",
  title,
  onSortChange,
}: TableHeaderCellProps): ReactElement => {
  const {theme} = useTheme();

  const {columns, setSortColumn, sortColumn} = useTableContext();
  const width = columns[index];
  if (!width) {
    console.warn(`No width defined for column ${index} in TableHeaderCell`);
  }
  if (children && title) {
    console.warn("Both children and title are defined in TableHeaderCell. Title will be ignored.");
  }
  if (!children && !title) {
    console.error("Either children or title is required in TableHeaderCell");
  }

  const sort = sortColumn?.column === index ? sortColumn.direction : undefined;
  let alignItems: AlignItems = "start";
  if (align === "center") {
    alignItems = "center";
  } else if (align === "right") {
    alignItems = "end";
  }

  const onClick = useCallback(() => {
    // desc => asc => undefined
    const newSort = sort === "desc" ? "asc" : sort === "asc" ? undefined : "desc";
    if (setSortColumn) {
      setSortColumn(newSort ? {column: index, direction: newSort} : undefined);
    }
    onSortChange?.(newSort);
  }, [index, onSortChange, setSortColumn, sort]);

  if (sortable && !onSortChange) {
    console.error("onSortChange is required when sortable is true");
  }
  return (
    <Box
      accessibilityHint="changes sort alphabetical order"
      accessibilityLabel="sort"
      alignItems="center"
      direction="row"
      flex="grow"
      justifyContent={alignItems}
      onClick={sortable ? onClick : undefined}
    >
      {Boolean(children) && children}
      {Boolean(title) && <TableTitle align={align} title={title!} />}
      {Boolean(sort) && (
        <Box alignSelf="end" paddingX={2}>
          {/* Make it look like an IconButton, but we can't nest buttons and the whole row is clickable. */}
          <Box
            alignItems="center"
            color="primary"
            height={16}
            justifyContent="center"
            rounding="rounded"
            width={16}
          >
            <FontAwesome6
              color={theme.text.inverted}
              name={sort === "asc" ? "arrow-down" : "arrow-up"}
              selectable={undefined}
              size={10}
              solid
            />
          </Box>
        </Box>
      )}
    </Box>
  );
};
