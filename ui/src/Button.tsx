import FontAwesome6 from "@expo/vector-icons/FontAwesome6";
import debounce from "lodash/debounce";
import {
  type CustomPressableProps,
  PressableOpacity,
  PressableScale,
  PressableWithoutFeedback,
} from "pressto";
import type React from "react";
import {lazy, memo, Suspense, useCallback, useEffect, useMemo, useRef, useState} from "react";
import {
  ActivityIndicator,
  Pressable,
  type PressableProps,
  Text,
  type TextStyle,
  View,
  type ViewStyle,
} from "react-native";

import {Box} from "./Box";
import type {ButtonPressAnimation, ButtonProps} from "./Common";
import {useCustomIcon} from "./IconRegistry";
import {isNarrowViewport} from "./MediaQuery";
import {useTheme} from "./Theme";
import {Tooltip} from "./Tooltip";
import {Unifier} from "./Unifier";
import {isNative} from "./Utilities";

// Lazy load Modal to break the circular dependency: Modal -> Button -> Modal
const LazyModal = lazy(() => import("./Modal").then((module) => ({default: module.Modal})));

const DEFAULT_BUTTON_PRESS_ANIMATION: ButtonPressAnimation = "scale";

const PRESSABLE_BY_ANIMATION: Record<
  ButtonPressAnimation,
  React.ComponentType<CustomPressableProps>
> = {
  none: PressableWithoutFeedback,
  opacity: PressableOpacity,
  scale: PressableScale,
};

type ButtonPressableProps = CustomPressableProps & PressableProps;

interface ButtonVisualProps extends Omit<ButtonProps, "onClick"> {
  children?: React.ReactNode;
  isLoading: boolean;
  onPress: () => void;
}

interface DebouncedPress {
  endPressCooldown: () => void;
  onPress: () => void;
}

const useDebouncedPress = (handlePress: () => Promise<void>): DebouncedPress => {
  const debouncedHandlePress = useMemo(
    () => debounce(handlePress, 500, {leading: true, trailing: false}),
    [handlePress]
  );

  // Cancel retained debounce timers when the callback changes or the button unmounts.
  useEffect((): (() => void) => {
    return (): void => {
      debouncedHandlePress.cancel();
    };
  }, [debouncedHandlePress]);

  const endPressCooldown = useCallback((): void => {
    debouncedHandlePress.cancel();
  }, [debouncedHandlePress]);

  return {endPressCooldown, onPress: debouncedHandlePress};
};

const useMountedRef = (): React.RefObject<boolean> => {
  const isMountedRef = useRef(true);

  // Prevent async press completions from updating state after the button unmounts.
  useEffect((): (() => void) => {
    return (): void => {
      isMountedRef.current = false;
    };
  }, []);

  return isMountedRef;
};

const ButtonVisual: React.FC<ButtonVisualProps> = ({
  accessibilityLabel,
  children,
  disabled = false,
  fullWidth = false,
  iconName,
  iconPosition = "left",
  isLoading,
  onPress,
  pressAnimation = DEFAULT_BUTTON_PRESS_ANIMATION,
  size = "default",
  state = "default",
  testID,
  text,
  variant = "primary",
  withConfirmation = false,
  wrapText = false,
}) => {
  const {theme} = useTheme();
  const CustomIcon = useCustomIcon(iconName);

  const {backgroundColor, borderColor, borderWidth, color} = useMemo(() => {
    if (!theme) {
      return {};
    }
    let bgColor = theme.surface.primary;
    let bColor: string | undefined;
    let bWidth: number | undefined;
    let textColor = theme.text.inverted;

    if (disabled) {
      bgColor = theme.surface.disabled;
    } else if (variant === "secondary") {
      bgColor = theme.surface.secondaryDark;
    } else if (variant === "muted") {
      bgColor = theme.surface.secondaryLight;
      textColor = theme.surface.neutralDark;
    } else if (variant === "outline") {
      bgColor = theme.surface.base;
      bColor = theme.text.secondaryDark;
      bWidth = 2;
      textColor = theme.text.secondaryDark;
    } else if (variant === "destructive") {
      bgColor = theme.surface.error;
    } else if (variant === "ghost") {
      bgColor = "transparent";
      textColor = theme.surface.secondaryDark;
    }

    if (!disabled && state === "active") {
      if (variant === "primary") {
        bgColor = theme.surface.secondaryDark;
      } else if (variant === "destructive") {
        bgColor = theme.surface.error;
      } else {
        bgColor = theme.surface.primary;
      }
      bColor = undefined;
      bWidth = undefined;
      textColor = theme.surface.base;
    }

    return {
      backgroundColor: bgColor,
      borderColor: bColor,
      borderWidth: bWidth,
      color: textColor,
    };
  }, [disabled, state, variant, theme]);

  if (!theme) {
    return null;
  }

  const isPressDisabled = disabled || isLoading;
  const PressableComponent = (
    isPressDisabled ? Pressable : PRESSABLE_BY_ANIMATION[pressAnimation]
  ) as React.ComponentType<ButtonPressableProps>;
  const pressableInteractionProps = isPressDisabled ? {disabled: true} : {enabled: true};
  // `maxWidth` lets a button in a row fit the row instead of its one-line label. The fixed `sm`
  // height would clip a wrapped second line, so a wrapping `sm` button grows from 28px instead.
  const wrapBoxStyle: ViewStyle | undefined = wrapText
    ? {
        maxWidth: "100%",
        ...(size === "sm"
          ? {height: undefined, minHeight: 28, paddingVertical: 4 - (borderWidth ?? 0)}
          : undefined),
      }
    : undefined;
  const wrapRowStyle: ViewStyle | undefined = wrapText ? {flexShrink: 1} : undefined;
  const wrapLabelStyle: TextStyle | undefined = wrapText
    ? {flexShrink: 1, textAlign: "center"}
    : undefined;

  return (
    <PressableComponent
      accessibilityHint={
        withConfirmation ? "Opens a confirmation dialog" : "Press to perform action"
      }
      accessibilityLabel={accessibilityLabel ?? text}
      accessibilityRole="button"
      accessibilityState={{disabled: isPressDisabled}}
      {...pressableInteractionProps}
      onPress={onPress}
      style={{
        alignItems: "center",
        alignSelf: fullWidth ? "stretch" : "flex-start",
        backgroundColor,
        borderColor,
        borderRadius: theme.radius.rounded,
        borderWidth,
        flexDirection: "column",
        height: size === "sm" ? 28 : undefined,
        justifyContent: "center",
        paddingHorizontal: (size === "sm" ? 16 : 20) - (borderWidth ?? 0),
        paddingVertical: size === "sm" ? 0 : 8 - (borderWidth ?? 0),
        width: fullWidth ? "100%" : "auto",
        ...wrapBoxStyle,
      }}
      testID={testID}
    >
      <View style={{flexDirection: "row", ...wrapRowStyle}}>
        <View
          style={{flexDirection: iconPosition === "left" ? "row" : "row-reverse", ...wrapRowStyle}}
        >
          {Boolean(iconName) && (
            <View
              style={{
                alignSelf: "center",
                marginLeft: iconPosition === "right" ? 8 : 0,
                marginRight: iconPosition === "left" ? 8 : 0,
              }}
            >
              {CustomIcon ? (
                <CustomIcon color={color ?? theme.text.inverted} size={size === "sm" ? 12 : 16} />
              ) : (
                <FontAwesome6 color={color} name={iconName} size={size === "sm" ? 12 : 16} solid />
              )}
            </View>
          )}
          <Text
            style={{color, fontSize: size === "sm" ? 14 : 16, fontWeight: "700", ...wrapLabelStyle}}
          >
            {text}
          </Text>
        </View>
        {isLoading && (
          <Box marginLeft={2}>
            <ActivityIndicator color={color} size="small" />
          </Box>
        )}
      </View>
      {children}
    </PressableComponent>
  );
};

const PlainButton: React.FC<ButtonProps> = (props) => {
  const {loading = false, onClick} = props;
  const {
    confirmationText: _confirmationText,
    modalSubTitle: _modalSubTitle,
    modalTitle: _modalTitle,
    onClick: _onClick,
    withConfirmation: _withConfirmation,
    ...visualProps
  } = props;
  const [isHandlingPress, setIsHandlingPress] = useState(false);
  const isMountedRef = useMountedRef();
  const handlePress = useCallback(async (): Promise<void> => {
    await Unifier.utils.haptic();
    if (!isMountedRef.current) {
      return;
    }
    setIsHandlingPress(true);

    try {
      await onClick();
    } catch (error) {
      if (isMountedRef.current) {
        setIsHandlingPress(false);
      }
      throw error;
    }
    if (isMountedRef.current) {
      setIsHandlingPress(false);
    }
  }, [isMountedRef, onClick]);
  const {onPress} = useDebouncedPress(handlePress);

  return <ButtonVisual {...visualProps} isLoading={loading || isHandlingPress} onPress={onPress} />;
};

const ConfirmationButton: React.FC<ButtonProps> = ({
  confirmationText = "Are you sure you want to continue?",
  loading = false,
  modalSubTitle,
  modalTitle = "Confirm",
  onClick,
  ...props
}) => {
  const [showConfirmation, setShowConfirmation] = useState(false);
  const isMountedRef = useMountedRef();
  const handlePress = useCallback(async (): Promise<void> => {
    await Unifier.utils.haptic();
    if (!isMountedRef.current) {
      return;
    }
    setShowConfirmation(true);
  }, [isMountedRef]);
  const {endPressCooldown, onPress} = useDebouncedPress(handlePress);
  // The press debounce only guards opening the modal, so closing it must clear the
  // cooldown or a quick reopen after Cancel, dismiss, or Confirm would be swallowed.
  const handleDismiss = useCallback((): void => {
    endPressCooldown();
    if (isMountedRef.current) {
      setShowConfirmation(false);
    }
  }, [endPressCooldown, isMountedRef]);
  const handleConfirm = useCallback(async (): Promise<void> => {
    await onClick();
    endPressCooldown();
    if (isMountedRef.current) {
      setShowConfirmation(false);
    }
  }, [endPressCooldown, isMountedRef, onClick]);

  return (
    <ButtonVisual {...props} isLoading={loading} onPress={onPress} withConfirmation>
      {showConfirmation && (
        <Suspense fallback={null}>
          <LazyModal
            onDismiss={handleDismiss}
            primaryButtonOnClick={handleConfirm}
            primaryButtonText="Confirm"
            secondaryButtonOnClick={handleDismiss}
            secondaryButtonText="Cancel"
            subtitle={modalSubTitle}
            text={confirmationText}
            title={modalTitle}
            visible={showConfirmation}
          />
        </Suspense>
      )}
    </ButtonVisual>
  );
};

const ButtonRender: React.FC<ButtonProps> = (props) => {
  const {tooltipText, tooltipIdealPosition, tooltipIncludeArrow = false} = props;
  const isMobileOrNative = isNarrowViewport() || isNative();
  const button = props.withConfirmation ? (
    <ConfirmationButton {...props} />
  ) : (
    <PlainButton {...props} />
  );

  if (tooltipText && !isMobileOrNative) {
    return (
      <Tooltip
        idealPosition={tooltipIdealPosition}
        includeArrow={tooltipIncludeArrow}
        text={tooltipText}
      >
        {button}
      </Tooltip>
    );
  }

  return button;
};

const MemoizedButton = memo(ButtonRender);

export const Button: React.FC<ButtonProps> = MemoizedButton;
