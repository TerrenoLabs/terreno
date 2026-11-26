import React, {Children, memo, useRef} from "react";

import {Box} from "../Box";
import type {TableRowProps} from "../Common";
import {IconButton} from "../IconButton";
import {useTableContext} from "./tableContext";

interface TableCellProps {
  children: React.ReactNode;
  index: number;
}

// Memoized so expanding a row's drawer does not re-render every cell in that row.
const TableCell: React.FC<TableCellProps> = memo(({children, index}) => {
  const {columns} = useTableContext();
  return (
    <Box justifyContent="center" marginRight={2} paddingX={3} paddingY={4} width={columns[index]}>
      {children}
    </Box>
  );
});
TableCell.displayName = "TableCell";

/**
 * Use TableRow to define a row in Table.
 */
export const TableRow = ({
  children,
  headerRow = false,
  expanded,
  drawerContents,
  color = "base",
}: TableRowProps): React.ReactElement => {
  const [isExpanded, setIsExpanded] = React.useState(expanded || false);
  const {hasDrawerContents} = useTableContext();
  const rowRef = useRef<typeof Box>(null);

  const border = {__style: {borderBottom: `${headerRow ? 2 : 1}px solid #e0e0e0`}};

  return (
    <Box color={color} dangerouslySetInlineStyle={border} ref={rowRef} width="100%">
      <Box direction="row" paddingY={1} width="100%">
        {Boolean(drawerContents) && (
          <TableCell index={-1}>
            {/* TODO: The expand table button doesn't exactly line up with the designs */}
            <IconButton
              accessibilityHint="press to expand"
              accessibilityLabel="expand"
              iconName={isExpanded ? "chevron-up" : "chevron-down"}
              onClick={() => {
                setIsExpanded(!isExpanded);
              }}
              variant="secondary"
            />
          </TableCell>
        )}
        {/* Still render a blank space so the columns line up. */}
        {Boolean(hasDrawerContents && !drawerContents) && (
          <TableCell index={-1}>
            <Box width={32} />
          </TableCell>
        )}
        {Children.map(children, (child, index) => (
          <TableCell index={index}>{child}</TableCell>
        ))}
      </Box>
      {Boolean(isExpanded) && (
        <Box paddingX={2} width="100%">
          {drawerContents}
        </Box>
      )}
    </Box>
  );
};
