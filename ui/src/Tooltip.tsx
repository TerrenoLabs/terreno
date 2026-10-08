import {type FC, type ReactNode, useCallback, useEffect, useRef, useState} from "react";
import {
  Dimensions,
  type LayoutChangeEvent,
  type LayoutRectangle,
  Platform,
  Pressable,
  View,
  type ViewStyle,
} from "react-native";

import type {TooltipPosition, TooltipProps} from "./Common";
import {createWebPortal} from "./createWebPortal";
import {Portal} from "./PortalHost";
import {resolveDocumentBodyPortalTarget} from "./resolveDocumentBodyPortalTarget";
import {Text} from "./Text";
import {useTheme} from "./Theme";

const TOOLTIP_OFFSET = 6;
// How many pixels to leave between the tooltip and the edge of the screen
const TOOLTIP_OVERFLOW_PADDING = 20;

interface ChildrenMeasurement {
  width: number;
  height: number;
  pageX: number;
  pageY: number;
}

// empty object is a fallback for when the tooltip is not measured yet
interface Measurement {
  children: ChildrenMeasurement | {};
  tooltip: LayoutRectangle | {};
  measured: boolean;
  idealPosition?: TooltipPosition;
}

interface TooltipPlacement {
  finalPosition: TooltipPosition;
  left: number;
  top: number;
}

interface ChildrenProps {
  onClick?: () => void;
  onHoverIn?: () => void;
  onHoverOut?: () => void;
}

export const getTooltipPosition = ({
  children,
  tooltip,
  measured,
  idealPosition,
}: Measurement): Partial<TooltipPlacement> => {
  if (!measured) {
    console.debug("No measurements for child yet, cannot show tooltip yet.");
    return {};
  }

  const {
    pageY: childrenY,
    height: childrenHeight,
    pageX: childrenX,
    width: childrenWidth,
  }: ChildrenMeasurement = children as ChildrenMeasurement;
  const {width: tooltipWidth, height: tooltipHeight} = tooltip as LayoutRectangle;

  const horizontalCenter = childrenX + childrenWidth / 2;
  const right = childrenX + childrenWidth + TOOLTIP_OFFSET;
  const left = childrenX - tooltipWidth - TOOLTIP_OFFSET;
  const top = childrenY - tooltipHeight - TOOLTIP_OFFSET;
  const bottom = childrenY + childrenHeight + TOOLTIP_OFFSET;
  const verticalCenter = childrenY + childrenHeight / 2 - tooltipHeight / 2;

  const overflowTop = top < TOOLTIP_OVERFLOW_PADDING;
  const overflowBottom =
    bottom + tooltipHeight + TOOLTIP_OVERFLOW_PADDING > Dimensions.get("window").height;
  const overflowLeft = left < TOOLTIP_OVERFLOW_PADDING;
  const overflowRight =
    right + tooltipWidth > Dimensions.get("window").width - TOOLTIP_OVERFLOW_PADDING;
  let finalPosition: TooltipPosition = idealPosition || "top";
  // Try to place the tooltip in the ideal position if possible
  switch (idealPosition) {
    case "left":
      if (!overflowLeft) {
        return {finalPosition, left, top: verticalCenter};
      }
      break;
    case "right":
      if (!overflowRight) {
        return {finalPosition, left: right, top: verticalCenter};
      }
      break;
    case "top":
    case undefined:
      if (!overflowTop) {
        return {finalPosition, left: horizontalCenter - tooltipWidth / 2, top};
      }
      break;
    case "bottom":
      if (!overflowBottom) {
        return {finalPosition, left: horizontalCenter - tooltipWidth / 2, top: bottom};
      }
      break;
  }

  // Fallback to an alternate position if the ideal position overflows
  if (!overflowBottom) {
    finalPosition = "bottom";
    return {finalPosition, left: horizontalCenter - tooltipWidth / 2, top: bottom};
  } else if (!overflowTop) {
    finalPosition = "top";
    return {finalPosition, left: horizontalCenter - tooltipWidth / 2, top};
  } else if (!overflowLeft) {
    finalPosition = "left";
    return {finalPosition, left, top: verticalCenter};
  } else {
    finalPosition = "right";
    return {
      finalPosition,
      left: Dimensions.get("window").width - TOOLTIP_OVERFLOW_PADDING - tooltipWidth,
      top: verticalCenter,
    };
  }
};

export const Arrow: FC<{position: TooltipPosition; color: string}> = ({position, color}) => {
  const getArrowStyle = (): ViewStyle => {
    const arrowStyles = {
      bottom: {
        borderBottomWidth: 6,
        borderLeftColor: "transparent",
        borderLeftWidth: 6,
        borderRightColor: "transparent",
        borderRightWidth: 6,
        borderTopColor: color,
        marginTop: 8,
      },
      left: {
        borderBottomColor: "transparent",
        borderBottomWidth: 6,
        borderLeftColor: color,
        borderLeftWidth: 6,
        borderTopColor: "transparent",
        borderTopWidth: 6,
        marginRight: 8,
      },
      right: {
        borderBottomColor: "transparent",
        borderBottomWidth: 6,
        borderRightColor: color,
        borderRightWidth: 6,
        borderTopColor: "transparent",
        borderTopWidth: 6,
        marginLeft: 8,
      },
      top: {
        borderBottomColor: color,
        borderLeftColor: "transparent",
        borderLeftWidth: 6,
        borderRightColor: "transparent",
        borderRightWidth: 6,
        borderTopWidth: 6,
        marginBottom: 8,
      },
    };
    return {
      alignSelf: "center",
      borderStyle: "solid",
      height: 0,
      width: 0,
      ...arrowStyles[position],
    } as ViewStyle;
  };

  const arrowStyle = getArrowStyle();
  return <View style={arrowStyle} />;
};

export const Tooltip: FC<TooltipProps> = ({text, children, idealPosition, includeArrow}) => {
  const {theme} = useTheme();
  const hoverDelay = 800;
  const hoverEndDelay = 0;
  const [visible, setVisible] = useState(false);
  const [finalPosition, setFinalPosition] = useState<TooltipPosition>("top");

  const [measurement, setMeasurement] = useState<Measurement>({
    children: {},
    measured: false,
    tooltip: {},
  });

  const showTooltipTimer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const hideTooltipTimer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const childrenWrapperRef = useRef<View>(null);
  const touched = useRef(false);
  const isWeb = Platform.OS === "web";
  const resetMeasurement = useCallback(() => {
    setMeasurement({
      children: {},
      measured: false,
      tooltip: {},
    });
  }, []);
  const hideTooltip = useCallback(() => {
    if (showTooltipTimer.current) {
      clearTimeout(showTooltipTimer.current);
    }
    if (hideTooltipTimer.current) {
      clearTimeout(hideTooltipTimer.current);
    }

    touched.current = false;
    setVisible(false);
    resetMeasurement();
  }, [resetMeasurement]);

  // If the tooltip is visible, and the user clicks outside of the tooltip, hide it.
  useEffect(() => {
    return () => {
      // Hide tooltip on unmount to prevent it from staying stuck on screen
      hideTooltip();
    };
  }, [hideTooltip]);

  const getArrowContainerStyle = (): ViewStyle => {
    if (!includeArrow) {
      return {};
    }
    const containerStyles = {
      bottom: {
        left: "50%",
        top: -12,
        transform: [{translateX: -6}],
      },
      left: {
        right: -12,
        top: "50%",
        transform: [{translateY: -6}],
      },
      right: {
        left: -12,
        top: "50%",
        transform: [{translateY: -6}],
      },
      top: {
        bottom: -12,
        left: "50%",
        transform: [{translateX: -6}],
      },
    };
    return {position: "absolute", ...containerStyles[finalPosition]} as ViewStyle;
  };

  const arrowContainerStyles = getArrowContainerStyle();

  const handleOnLayout = useCallback(
    ({nativeEvent: {layout}}: LayoutChangeEvent) => {
      if (childrenWrapperRef?.current && !childrenWrapperRef?.current?.measure) {
        console.error("Tooltip: childrenWrapperRef does not have a measure method.");
        return;
      } else if (!childrenWrapperRef?.current) {
        console.error("Tooltip: childrenWrapperRef is null.");
      }

      childrenWrapperRef?.current?.measure((_x, _y, width, height, pageX, pageY) => {
        setMeasurement({
          children: {height, pageX, pageY, width},
          measured: true,
          tooltip: {...layout},
        });
        const position = getTooltipPosition({
          children: {height, pageX, pageY, width},
          idealPosition,
          measured: true,
          tooltip: {...layout},
        });
        if (position.finalPosition) {
          setFinalPosition(position.finalPosition);
        }
      });
    },
    [idealPosition]
  );

  const handleTouchStart = useCallback(() => {
    if (visible) {
      hideTooltip();
      return;
    }

    if (hideTooltipTimer.current) {
      clearTimeout(hideTooltipTimer.current);
    }

    showTooltipTimer.current = setTimeout(() => {
      touched.current = true;
      setVisible(true);
    }, 100);
  }, [hideTooltip, visible]);

  const handleHoverIn = useCallback(() => {
    if (hideTooltipTimer.current) {
      clearTimeout(hideTooltipTimer.current);
    }

    showTooltipTimer.current = setTimeout(() => {
      touched.current = true;
      setVisible(true);
    }, hoverDelay);
  }, []);

  const handleHoverOut = useCallback(() => {
    if (showTooltipTimer.current) {
      clearTimeout(showTooltipTimer.current);
    }
    if (hideTooltipTimer.current) {
      clearTimeout(hideTooltipTimer.current);
    }

    hideTooltipTimer.current = setTimeout(() => {
      hideTooltip();
    }, hoverEndDelay);
  }, [hideTooltip]);

  const handleClick = useCallback(() => {
    if (visible) {
      hideTooltip();
    }
  }, [hideTooltip, visible]);

  const mobilePressProps = {
    onPress: useCallback(() => {
      if (!touched.current) {
        (children.props as ChildrenProps).onClick?.();
      }
    }, [children.props]),
  };

  // Allow disabling tooltips when there is no string,
  // otherwise you need to wrap the children in a function to determine if there should be a tooltip
  // or not, which gets messy.
  if (!text) {
    return children;
  }

  const placement = measurement.measured
    ? getTooltipPosition({...(measurement as Measurement), idealPosition})
    : {};
  const isPositioned = placement.left !== undefined && placement.top !== undefined;

  // On web the bubble attaches to document.body with fixed positioning, so no
  // full-screen portal layer sits over the page while the tooltip is open.
  const webPortalTarget = isWeb ? resolveDocumentBodyPortalTarget() : null;

  const tooltipBubble = (
    <View
      onLayout={handleOnLayout}
      style={{
        // The trigger is measured on the first layout pass, so keep the tooltip
        // off screen until then instead of flashing it in the top left corner.
        left: isPositioned ? placement.left : -9999,
        opacity: isPositioned ? 1 : 0,
        position: (webPortalTarget ? "fixed" : "absolute") as ViewStyle["position"],
        top: isPositioned ? placement.top : -9999,
        // Match the body-level web overlays (RNW Modal, DropdownPanel) so tooltips
        // inside them stay on top.
        zIndex: webPortalTarget ? 9999 : 999,
      }}
    >
      {includeArrow && isWeb && (
        <View style={arrowContainerStyles as ViewStyle}>
          <Arrow color={theme.surface.secondaryExtraDark} position={finalPosition} />
        </View>
      )}
      <View
        style={{
          backgroundColor: theme.surface.secondaryExtraDark,
          borderRadius: theme.radius.default,
          display: "flex",
          flexShrink: 1,
          maxWidth: 320,
          paddingHorizontal: 8,
          paddingVertical: 2,
        }}
      >
        <Pressable
          accessibilityHint="Tooltip information"
          aria-label={text}
          aria-role="button"
          onPress={hideTooltip}
          style={{
            backgroundColor: theme.surface.secondaryExtraDark,
            borderRadius: theme.radius.default,
          }}
          testID="tooltip-container"
        >
          <Text color="inverted" size="sm">
            {text}
          </Text>
        </Pressable>
      </View>
    </View>
  );

  const renderTooltip = (): ReactNode => {
    if (!visible) {
      return null;
    }
    if (webPortalTarget) {
      return createWebPortal({children: tooltipBubble, container: webPortalTarget});
    }
    return <Portal>{tooltipBubble}</Portal>;
  };

  return (
    <View>
      {renderTooltip()}
      <View
        hitSlop={{bottom: 10, left: 15, right: 15, top: 10}}
        onPointerEnter={() => {
          handleHoverIn();
          (children.props as ChildrenProps).onHoverIn?.();
        }}
        onPointerLeave={() => {
          handleHoverOut();
          (children.props as ChildrenProps).onHoverOut?.();
        }}
        onPress={isWeb ? handleClick : undefined}
        onTouchStart={handleTouchStart}
        ref={childrenWrapperRef}
        {...(!isWeb && mobilePressProps)}
      >
        {children}
      </View>
    </View>
  );
};
