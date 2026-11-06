import {type FC, useState} from "react";
import {Pressable, View} from "react-native";

import type {FilterSelectMenuProps} from "./Common";
import {FilterChangesBadge} from "./FilterChangesBadge";
import {SelectField} from "./SelectField";
import {Text} from "./Text";
import {useTheme} from "./Theme";
import {resolveTestID} from "./testing/resolveTestId";

const SELECT_WIDTH = 138;

/**
 * A single-select filter row: a title on the left and a compact select control
 * on the right. Only the select is the click zone. Hovering the select tints
 * the row with the `surface-base-hover` token.
 */
export const FilterSelectMenu: FC<FilterSelectMenuProps> = ({
  title,
  options,
  value,
  onChange,
  placeholder,
  showChangesBadge = false,
  disabled = false,
  testID,
}) => {
  const {theme} = useTheme();
  const [isHovered, setIsHovered] = useState(false);

  return (
    <View
      style={{
        alignItems: "center",
        backgroundColor: isHovered ? theme.surface.baseHover : theme.surface.base,
        borderRadius: theme.radius.default,
        flexDirection: "row",
        gap: theme.spacing.sm,
        paddingHorizontal: theme.spacing.sm,
        paddingVertical: theme.primitives.spacing3,
      }}
      testID={testID}
    >
      <View style={{alignItems: "center", flex: 1, flexDirection: "row", gap: 6}}>
        <Text size="md">{title}</Text>
        {showChangesBadge && (
          <FilterChangesBadge testID={testID ? resolveTestID(testID, "badge") : undefined} />
        )}
      </View>
      <Pressable
        onHoverIn={() => setIsHovered(true)}
        onHoverOut={() => setIsHovered(false)}
        style={{overflow: "hidden", width: SELECT_WIDTH}}
        testID={testID ? resolveTestID(testID, "selectContainer") : undefined}
      >
        <SelectField
          disabled={disabled}
          // The compact filter select is fixed at SELECT_WIDTH. Search mode renders
          // the trigger as an <input> whose intrinsic min-width exceeds that width,
          // overflowing the row and pushing the chevron outside the control's border.
          // Filter option lists are short, so a plain (non-search) dropdown is correct.
          disableSearch
          onChange={onChange}
          options={options}
          placeholder={placeholder}
          // The DropdownPanel is a fixed portal on document.body (zIndex 9999).
          // Render the menu in a matching body portal so it floats above the
          // panel instead of a React Native Modal that would stack behind it.
          renderMenuInBodyPortal
          testID={testID ? resolveTestID(testID, "select") : undefined}
          value={value}
        />
      </Pressable>
    </View>
  );
};
