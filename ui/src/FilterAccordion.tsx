import {type ComponentProps, type FC, useState} from "react";
import {Pressable, View} from "react-native";

import type {FilterAccordionProps} from "./Common";
import {FilterChangesBadge} from "./FilterChangesBadge";
import {Icon} from "./Icon";
import {Text} from "./Text";
import {useTheme} from "./Theme";
import {resolveTestID} from "./testing/resolveTestId";

// react-native's Pressable does not type the web `onKeyDown` event, but React
// Native Web forwards it. A disclosure button needs its own spacebar handler
// (per ARIA, Space activates it) since role="button" only activates on Enter.
interface WebKeyDownEvent {
  key?: string;
  preventDefault: () => void;
  repeat?: boolean;
}

interface WebKeyDownProps {
  onKeyDown?: (event: WebKeyDownEvent) => void;
}

/**
 * An expandable/collapsible filter row. The header (title, optional changes
 * badge, and chevron) is the full click zone. When expanded, the row switches
 * to the alternate surface and reveals `children`. Empty by default.
 */
export const FilterAccordion: FC<FilterAccordionProps> = ({
  title,
  children,
  expanded,
  defaultExpanded = false,
  onToggle,
  showChangesBadge = false,
  testID,
}) => {
  const {theme} = useTheme();
  const [isHovered, setIsHovered] = useState(false);
  const [internalExpanded, setInternalExpanded] = useState(defaultExpanded);

  const isControlled = expanded !== undefined;
  const isExpanded = isControlled ? expanded : internalExpanded;

  const handleToggle = (): void => {
    const next = !isExpanded;
    if (!isControlled) {
      setInternalExpanded(next);
    }
    onToggle?.(next);
  };

  let backgroundColor = theme.surface.base;
  if (isExpanded) {
    backgroundColor = theme.surface.baseAlternate;
  } else if (isHovered) {
    backgroundColor = theme.surface.baseHover;
  }

  const webKeyDownProps: WebKeyDownProps = {
    onKeyDown: (event) => {
      if (event.key !== " " && event.key !== "Spacebar") {
        return;
      }
      event.preventDefault();
      // A native button activates once per press, so ignore held-key auto-repeat.
      if (event.repeat) {
        return;
      }
      handleToggle();
    },
  };

  return (
    <View
      style={{
        backgroundColor,
        borderRadius: theme.radius.default,
        gap: theme.spacing.md,
        paddingHorizontal: theme.spacing.sm,
        paddingVertical: theme.primitives.spacing3,
      }}
      testID={testID}
    >
      <Pressable
        {...(webKeyDownProps as Pick<ComponentProps<typeof Pressable>, "onKeyDown">)}
        accessibilityRole="button"
        accessibilityState={{expanded: isExpanded}}
        aria-expanded={isExpanded}
        onHoverIn={() => setIsHovered(true)}
        onHoverOut={() => setIsHovered(false)}
        onPress={handleToggle}
        style={{
          alignItems: "center",
          flexDirection: "row",
          justifyContent: "space-between",
        }}
        testID={testID ? resolveTestID(testID, "header") : undefined}
      >
        <View style={{alignItems: "center", flex: 1, flexDirection: "row", gap: 6}}>
          <Text size="md">{title}</Text>
          {showChangesBadge && (
            <FilterChangesBadge testID={testID ? resolveTestID(testID, "badge") : undefined} />
          )}
        </View>
        <Icon color="primary" iconName={isExpanded ? "chevron-up" : "chevron-down"} size="sm" />
      </Pressable>
      {Boolean(isExpanded && children) && (
        <View testID={testID ? resolveTestID(testID, "content") : undefined}>{children}</View>
      )}
    </View>
  );
};
