import type {FC} from "react";
import {Text} from "react-native";

import type {TableTitleProps} from "../Common";
import {DATA_TABLE_HEADER_FONT_SIZE} from "../dataTableColumnWidths";
import {useTheme} from "../Theme";

export const TableTitle: FC<TableTitleProps> = ({title, align = "left"}) => {
  const {theme} = useTheme();
  return (
    // No hint needed for a title.
    <Text
      aria-label={`Table title: ${title}`}
      aria-role="header"
      ellipsizeMode="tail" // ensures that the text is clipped at the end of the line for all platforms
      numberOfLines={3}
      style={{
        color: theme.text.primary,
        flexWrap: "wrap",
        fontFamily: "text",
        fontSize: DATA_TABLE_HEADER_FONT_SIZE,
        fontWeight: "700",
        lineHeight: 16,
        overflow: "hidden",
        textAlign: align,
        textTransform: "uppercase",
      }}
    >
      {title}
    </Text>
  );
};
