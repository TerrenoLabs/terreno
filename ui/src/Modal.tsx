import {type FC, useEffect, useRef} from "react";
import {
  Dimensions,
  type DimensionValue,
  Platform,
  Pressable,
  Modal as RNModal,
  useWindowDimensions,
  View,
} from "react-native";
import ActionSheet, {type ActionSheetRef} from "react-native-actions-sheet";
import {Gesture, GestureDetector} from "react-native-gesture-handler";
import {runOnJS} from "react-native-reanimated";

import {Button} from "./Button";
import type {ModalProps, TerrenoTheme} from "./Common";
import {Heading} from "./Heading";
import {Icon} from "./Icon";
import {Text} from "./Text";
import {useTheme} from "./Theme";
import {resolveModalTestIDsFromProps, toTestProps} from "./testing/resolveTestId";
import {isNative} from "./Utilities";

const getModalSize = (size: "sm" | "md" | "lg"): DimensionValue => {
  const sizeMap = {
    lg: 900,
    md: 720,
    sm: 540,
  };
  let sizePx: DimensionValue = sizeMap[size] || sizeMap.sm;
  if (sizePx > Dimensions.get("window").width) {
    sizePx = "90%";
  }
  return sizePx;
};

const stopWebClickPropagation = (event: {stopPropagation: () => void}): void => {
  event.stopPropagation();
};

const ModalContent: FC<{
  children?: ModalProps["children"];
  title?: ModalProps["title"];
  subtitle?: ModalProps["subtitle"];
  text?: ModalProps["text"];
  primaryButtonText?: ModalProps["primaryButtonText"];
  primaryButtonDisabled?: ModalProps["primaryButtonDisabled"];
  secondaryButtonText?: ModalProps["secondaryButtonText"];
  primaryButtonOnClick?: ModalProps["primaryButtonOnClick"];
  secondaryButtonOnClick?: ModalProps["secondaryButtonOnClick"];
  onDismiss: ModalProps["onDismiss"];
  sizePx: DimensionValue;
  theme: TerrenoTheme;
  isMobile: boolean;
  isNarrow: boolean;
  modalTestIDs: ReturnType<typeof resolveModalTestIDsFromProps>;
}> = ({
  children,
  title,
  subtitle,
  text,
  primaryButtonText,
  primaryButtonDisabled,
  secondaryButtonText,
  primaryButtonOnClick,
  secondaryButtonOnClick,
  onDismiss,
  sizePx,
  theme,
  isMobile,
  isNarrow,
  modalTestIDs,
}) => {
  return (
    <View
      style={{
        alignItems: "center",
        alignSelf: "center",
        backgroundColor: theme.surface.base,
        borderRadius: theme.radius.default,
        maxHeight: "100%",
        padding: 32,
        width: sizePx,
        zIndex: 1,
        ...(isMobile
          ? {}
          : {
              boxShadow: "0px 4px 24px rgba(0, 0, 0, 0.5)",
              elevation: 24,
              margin: "auto",
            }),
      }}
      {...toTestProps(modalTestIDs.root)}
    >
      <View style={{alignSelf: "flex-end", position: "relative"}}>
        <Pressable
          accessibilityHint="Closes the modal"
          aria-label="Close modal"
          aria-role="button"
          onPress={onDismiss}
          style={{
            alignItems: "center",
            bottom: -8,
            flex: 1,
            justifyContent: "center",
            left: -8,
            position: "absolute",
            right: -8,
            top: -8,
          }}
          {...toTestProps(modalTestIDs.dismiss)}
        >
          <Icon iconName="x" size="sm" />
        </Pressable>
      </View>
      {Boolean(title) && (
        <View
          accessibilityHint="Modal title"
          aria-label={title}
          aria-role="header"
          style={{alignSelf: "flex-start"}}
          {...toTestProps(modalTestIDs.title)}
        >
          <Heading size="lg">{title}</Heading>
        </View>
      )}
      {Boolean(subtitle) && (
        <View
          accessibilityHint="Modal Sub Heading Text"
          aria-label={subtitle}
          aria-role="text"
          style={{alignSelf: "flex-start", marginTop: subtitle ? 8 : 0}}
        >
          <Text size="lg">{subtitle}</Text>
        </View>
      )}
      {Boolean(text) && (
        <View
          accessibilityHint="Modal body text"
          aria-label={text}
          aria-role="text"
          style={{alignSelf: "flex-start", marginVertical: text ? 12 : 0}}
        >
          <Text>{text}</Text>
        </View>
      )}
      {children && (
        <View
          style={{
            flex: isMobile ? undefined : 1,
            marginTop: text ? 0 : 12,
            width: "100%",
          }}
        >
          {children}
        </View>
      )}
      <View
        style={{
          alignSelf: isNarrow ? "stretch" : "flex-end",
          flexDirection: isNarrow ? "column" : "row",
          marginTop: text && !children ? 20 : 32,
          ...(isNarrow ? {gap: 12} : {}),
        }}
      >
        {Boolean(secondaryButtonText && secondaryButtonOnClick) && (
          <View style={{marginRight: !isNarrow && primaryButtonText ? 20 : 0}}>
            <Button
              fullWidth={isNarrow}
              onClick={secondaryButtonOnClick!}
              testID={modalTestIDs.secondaryButton}
              text={secondaryButtonText as string}
              variant="muted"
            />
          </View>
        )}
        {Boolean(primaryButtonText && primaryButtonOnClick) && (
          <Button
            disabled={primaryButtonDisabled}
            fullWidth={isNarrow}
            onClick={primaryButtonOnClick!}
            testID={modalTestIDs.primaryButton}
            text={primaryButtonText as string}
          />
        )}
      </View>
    </View>
  );
};

export const Modal: FC<ModalProps> = ({
  children,
  persistOnBackgroundClick = false,
  primaryButtonDisabled = false,
  primaryButtonText,
  secondaryButtonText,
  size = "sm",
  subtitle,
  testID,
  testIDs,
  text,
  title,
  visible,
  onDismiss,
  primaryButtonOnClick,
  secondaryButtonOnClick,
}: ModalProps) => {
  const actionSheetRef = useRef<ActionSheetRef>(null);
  const {theme} = useTheme();
  const {width: windowWidth} = useWindowDimensions();
  const modalTestIDs = resolveModalTestIDsFromProps({testID, testIDs});

  const handleDismiss = () => {
    if (visible && onDismiss) {
      onDismiss();
    }
  };

  const handlePrimaryButtonClick = (
    value?: Parameters<NonNullable<ModalProps["primaryButtonOnClick"]>>[0]
  ) => {
    if (visible && primaryButtonOnClick) {
      return primaryButtonOnClick(value);
    }
  };

  const handleSecondaryButtonClick = (
    value?: Parameters<NonNullable<ModalProps["secondaryButtonOnClick"]>>[0]
  ) => {
    if (visible && secondaryButtonOnClick) {
      return secondaryButtonOnClick(value);
    }
  };

  const dragToClose = Gesture.Pan().onEnd((event) => {
    if (event.translationY > 20) {
      // Gesture callbacks run on the UI thread, runOnJS is required to safely invoke handleDismiss on the JS thread
      runOnJS(handleDismiss)();
    }
  });

  // On web, blur the active element before the modal opens to prevent
  // "aria-hidden on a focused element" warnings from React Native Web.
  useEffect(() => {
    if (visible && Platform.OS === "web") {
      const active = document.activeElement;
      if (active instanceof HTMLElement) {
        active.blur();
      }
    }
  }, [visible]);

  // Open the action sheet ref when the visible prop changes.
  useEffect(() => {
    if (actionSheetRef.current) {
      actionSheetRef.current.setModalVisible(visible);
    }
  }, [visible]);

  // Choose the presentation by platform, not by screen size. The web branch below relies on DOM
  // semantics (nested Pressables using `e.stopPropagation()` and a `cursor` style) that native
  // platforms do not implement, so it must only run on web. Keying this off screen size instead
  // sent native *tablets* (width >= "sm") down the web branch: on Android the nested Pressables
  // fight over the touch responder, producing repeated press animations and a Confirm button that
  // never fires. All native devices (phones and tablets) use the ActionSheet presentation.
  const isMobile = isNative();
  const isNarrow = !isMobile && windowWidth < 480;
  const sizePx = getModalSize(size);

  const modalContentProps = {
    children,
    isMobile,
    isNarrow,
    modalTestIDs,
    onDismiss: handleDismiss,
    persistOnBackgroundClick,
    primaryButtonDisabled,
    primaryButtonOnClick: handlePrimaryButtonClick,
    primaryButtonText,
    secondaryButtonOnClick: handleSecondaryButtonClick,
    secondaryButtonText,
    sizePx,
    subtitle,
    text,
    theme,
    title,
  };

  if (isMobile) {
    return (
      <ActionSheet
        closeOnTouchBackdrop={!persistOnBackgroundClick}
        gestureEnabled={false}
        // Disable ActionSheet's built-in gestures to avoid conflicts with scrolling
        onClose={handleDismiss}
        ref={actionSheetRef}
      >
        <View>
          {/* Attach our own swipe-to-dismiss gesture to the top handle */}
          <GestureDetector gesture={dragToClose}>
            <View
              accessibilityHint="Pull down to close the modal"
              aria-label="Pull down bar"
              aria-role="adjustable"
              // add hitSlop to make the bar easier to hit since it's small
              hitSlop={{bottom: 20, left: 50, right: 50, top: 20}}
              style={{
                alignItems: "center",
                alignSelf: "center",
                backgroundColor: "#949494",
                borderRadius: 5,
                height: 3,
                justifyContent: "center",
                marginTop: 10,
                padding: 2,
                width: "30%",
              }}
            />
          </GestureDetector>

          <ModalContent {...modalContentProps}>{children}</ModalContent>
        </View>
      </ActionSheet>
    );
  } else {
    return (
      <RNModal animationType="none" onRequestClose={handleDismiss} transparent visible={visible}>
        <Pressable
          onPress={persistOnBackgroundClick ? undefined : handleDismiss}
          style={{
            alignItems: "center",
            backgroundColor: "rgba(0, 0, 0, 0.5)",
            flex: 1,
            justifyContent: "center",
          }}
        >
          <View
            // Web: nested Pressables bubble DOM clicks to the backdrop dismiss handler.
            {...(Platform.OS === "web" ? {onClick: stopWebClickPropagation} : {})}
            style={{cursor: "auto"}}
          >
            <ModalContent {...modalContentProps}>{children}</ModalContent>
          </View>
        </Pressable>
      </RNModal>
    );
  }
};
