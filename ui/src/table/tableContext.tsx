import type React from "react";
import {type Context, createContext, useContext, useMemo} from "react";

import type {TableContextProviderProps, TableContextType} from "../Common";

const TableContext: Context<TableContextType> = createContext<TableContextType>({
  alternateRowBackground: true,
  borderStyle: "sm",
  columns: [],
  hasDrawerContents: false,
  page: 1,
  setSortColumn: () => {},
  sortColumn: undefined,
  stickyHeader: true,
});

export const {Provider} = TableContext;

export const TableContextProvider = ({
  children,
  columns,
  hasDrawerContents,
  sortColumn,
  setSortColumn,
  stickyHeader,
  borderStyle,
  alternateRowBackground,
  page,
}: TableContextProviderProps): React.ReactElement<typeof Provider> => {
  // Memoized so a table re-render that changes none of these values does not re-render every
  // row and cell that reads the context.
  const value = useMemo(
    (): TableContextType => ({
      alternateRowBackground,
      borderStyle,
      columns,
      hasDrawerContents,
      page,
      setSortColumn,
      sortColumn,
      stickyHeader,
    }),
    [
      alternateRowBackground,
      borderStyle,
      columns,
      hasDrawerContents,
      page,
      setSortColumn,
      sortColumn,
      stickyHeader,
    ]
  );

  return <Provider value={value}>{children}</Provider>;
};

export const useTableContext = (): TableContextType => {
  const {
    columns,
    hasDrawerContents,
    setSortColumn,
    sortColumn,
    stickyHeader,
    alternateRowBackground,
    borderStyle,
  } = useContext(TableContext);
  return {
    alternateRowBackground,
    borderStyle,
    columns,
    hasDrawerContents,
    setSortColumn,
    sortColumn,
    stickyHeader,
  };
};
