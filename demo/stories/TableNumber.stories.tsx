import {Box, type TableNumberProps, TableText} from "@terreno/ui";

export const TableNumberDemo = (props?: Partial<TableNumberProps>) => {
  const {value = "$1.97", ...rest} = props ?? {};
  return (
    <Box alignItems="center" justifyContent="center">
      <TableText {...rest} value={String(value)} />
    </Box>
  );
};
