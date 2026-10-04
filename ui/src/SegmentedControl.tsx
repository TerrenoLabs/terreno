import {type FC, useCallback, useState} from "react";
import {Pressable, View} from "react-native";

import {Badge} from "./Badge";
import type {SegmentedControlProps} from "./Common";
import {Heading} from "./Heading";
import {Icon} from "./Icon";
import {Text} from "./Text";
import {useTheme} from "./Theme";
import {resolveSegmentedControlTestIDsFromProps} from "./testing/resolveTestId";

const HEIGHT_BY_SIZE = {lg: 44, md: 36, sm: 28} as const;

export const SegmentedControl: FC<SegmentedControlProps> = ({
  items,
  onChange = () => {},
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
          alignSelf: hugsContent ? "flex-start" : undefined,
          backgroundColor: theme.primitives.neutral300,
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
            return (
              <Pressable
                aria-role="button"
                key={actualIndex}
                onPress={() => onChange(actualIndex)}
                style={{
                  alignItems: "center",
                  backgroundColor: actualIndex === selectedIndex ? theme.surface.base : undefined,
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
                {hugsContent ? <Text size="sm">{item}</Text> : <Heading size="sm">{item}</Heading>}
                {visibleBadges[index] && (
                  <Badge
                    status={visibleBadges[index].status ?? "info"}
                    value={visibleBadges[index].count}
                    variant="numberOnly"
                  />
                )}
              </Pressable>
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
