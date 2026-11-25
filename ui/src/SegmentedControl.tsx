import {type FC, memo, useCallback, useState} from "react";
import {Pressable, View} from "react-native";

import {Badge} from "./Badge";
import type {SegmentedControlBadgeConfig, SegmentedControlProps} from "./Common";
import {Heading} from "./Heading";
import {Icon} from "./Icon";
import {Text} from "./Text";
import {useTheme} from "./Theme";
import {resolveSegmentedControlTestIDsFromProps} from "./testing/resolveTestId";
import {useStableCallback} from "./useStableCallback";

const HEIGHT_BY_SIZE = {lg: 44, md: 36, sm: 28} as const;

const ignoreChange = (): void => {};

interface SegmentProps {
  badgeCount?: SegmentedControlBadgeConfig["count"];
  badgeStatus?: SegmentedControlBadgeConfig["status"];
  hugsContent: boolean;
  index: number;
  isSelected: boolean;
  label: string;
  onSelect: (index: number) => void;
}

// Memoized so changing the selection re-renders the two segments that changed, not every one.
const Segment: FC<SegmentProps> = memo(
  ({badgeCount, badgeStatus, hugsContent, index, isSelected, label, onSelect}) => {
    const {theme} = useTheme();
    const handlePress = useCallback((): void => {
      onSelect(index);
    }, [index, onSelect]);

    return (
      <Pressable
        aria-role="button"
        onPress={handlePress}
        style={{
          alignItems: "center",
          backgroundColor: isSelected ? theme.surface.base : undefined,
          borderRadius: theme.primitives.radius3xl,
          display: "flex",
          flexBasis: hugsContent ? "auto" : 0,
          flexDirection: "row",
          flexGrow: hugsContent ? 0 : 1,
          gap: 8,
          height: "100%",
          justifyContent: "center",
          overflow: "hidden",
          paddingHorizontal: hugsContent ? 12 : 2,
        }}
      >
        {hugsContent ? (
          <Text size="sm" skipLinking>
            {label}
          </Text>
        ) : (
          <Heading size="sm">{label}</Heading>
        )}
        {badgeCount !== undefined && (
          <Badge status={badgeStatus ?? "info"} value={badgeCount} variant="numberOnly" />
        )}
      </Pressable>
    );
  }
);
Segment.displayName = "Segment";

export const SegmentedControl: FC<SegmentedControlProps> = ({
  items,
  onChange = ignoreChange,
  size = "md",
  selectedIndex,
  maxItems,
  badges = [],
  testID,
  testIDs,
}) => {
  const height = HEIGHT_BY_SIZE[size];
  const hugsContent = size === "sm";
  const {theme} = useTheme();
  const segmentedControlTestIDs = resolveSegmentedControlTestIDsFromProps({testID, testIDs});
  const [startIndex, setStartIndex] = useState(0);
  const selectIndex = useStableCallback(onChange);

  const handlePrevious = useCallback(() => {
    setStartIndex((prev) => Math.max(0, prev - (maxItems ?? 4)));
  }, [maxItems]);

  const handleNext = useCallback(() => {
    setStartIndex((prev) =>
      Math.min(items.length - (maxItems ?? items.length), prev + (maxItems ?? 4))
    );
  }, [items.length, maxItems]);

  const visibleItems = maxItems ? items.slice(startIndex, startIndex + maxItems) : items;
  const visibleBadges = maxItems ? badges.slice(startIndex, startIndex + maxItems) : badges;
  const canScrollLeft = startIndex > 0;
  const canScrollRight = maxItems ? startIndex + maxItems < items.length : false;
  const shouldShowScrollButtons = maxItems ? maxItems < items.length : false;

  return (
    <View
      style={{
        alignItems: "center",
        display: "flex",
        flexDirection: "row",
        gap: 8,
      }}
      testID={segmentedControlTestIDs.root}
    >
      {Boolean(shouldShowScrollButtons) && (
        <Pressable
          disabled={!canScrollLeft}
          onPress={handlePrevious}
          testID={segmentedControlTestIDs.previousButton}
        >
          <Icon
            color={canScrollLeft ? "linkLight" : "extraLight"}
            iconName="chevron-left"
            size={hugsContent ? "sm" : "lg"}
          />
        </Pressable>
      )}
      <View
        style={{
          alignItems: "center",
          ...(hugsContent ? {alignSelf: "flex-start" as const} : {}),
          backgroundColor: theme.surface.neutralLight,
          borderRadius: theme.primitives.radius3xl,
          display: "flex",
          flexDirection: "row",
          flexGrow: hugsContent ? 0 : 1,
          flexShrink: 1,
          height,
          maxHeight: height,
          overflow: "hidden",
        }}
      >
        <View
          style={{
            display: "flex",
            flexDirection: "row",
            flexGrow: hugsContent ? 0 : 1,
            gap: 4,
            height: height - 4,
            paddingHorizontal: hugsContent ? 2 : 4,
          }}
        >
          {visibleItems.map((item, index) => {
            const actualIndex = startIndex + index;
            const badge = visibleBadges[index];
            return (
              <Segment
                badgeCount={badge?.count}
                badgeStatus={badge?.status}
                hugsContent={hugsContent}
                index={actualIndex}
                isSelected={actualIndex === selectedIndex}
                key={actualIndex}
                label={item}
                onSelect={selectIndex}
              />
            );
          })}
        </View>
      </View>
      {Boolean(shouldShowScrollButtons) && (
        <Pressable
          disabled={!canScrollRight}
          onPress={handleNext}
          testID={segmentedControlTestIDs.nextButton}
        >
          <Icon
            color={canScrollRight ? "linkLight" : "extraLight"}
            iconName="chevron-right"
            size={hugsContent ? "sm" : "lg"}
          />
        </Pressable>
      )}
    </View>
  );
};
