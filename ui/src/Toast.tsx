import type React from "react";
import {Platform, Pressable, StyleSheet, View} from "react-native";

import type {IconName, SurfaceColor, TextColor, ToastProps} from "./Common";
import {Heading} from "./Heading";
import {Icon} from "./Icon";
import {Text} from "./Text";
import {useTheme} from "./Theme";
import {useToastNotifications} from "./ToastNotifications";
import {isAPIError, printAPIError} from "./Utilities";

const TOAST_DURATION_MS = 3 * 1000;

// The layout wrapper is wider than the visible toast, so it passes clicks through to the page
// beside the toast. pointerEvents must be registered here: react-native-web drops it from
// inline styles.
const styles = StyleSheet.create({
  wrapper: {pointerEvents: "box-none"},
});

/**
 * Base testID of the action button. Suffixed with the toast id when the caller
 * supplied one, so stacked action toasts stay individually addressable.
 */
const ACTION_BUTTON_TEST_ID = "toast-action-button";

interface UseToastVariantOptions {
  /**
   * Stable toast id. Showing the same id again replaces the toast on screen
   * instead of stacking a duplicate — use it for a recurring notification that
   * should only ever have one instance (e.g. one per data collection).
   */
  id?: string;
  persistent?: ToastProps["persistent"];
  secondary?: ToastProps["secondary"];
  size?: ToastProps["size"];
  onDismiss?: ToastProps["onDismiss"];
  subtitle?: ToastProps["subtitle"];
  buttonText?: ToastProps["buttonText"];
  buttonOnClick?: ToastProps["buttonOnClick"];
}

interface UseToastOptions extends UseToastVariantOptions {
  variant?: ToastProps["variant"];
}

export const useToast = (): {
  hide: (id: string) => void;
  success: (title: string, options?: UseToastVariantOptions) => string;
  info: (title: string, options?: UseToastVariantOptions) => string;
  warn: (title: string, options?: UseToastVariantOptions) => string;
  error: (title: string, options?: UseToastVariantOptions) => string;
  show: (title: string, options?: UseToastOptions) => string;
  catch: (error: unknown, message?: string, options?: UseToastVariantOptions) => void;
} => {
  const toast = useToastNotifications();
  const show = (title: string, options?: UseToastOptions): string => {
    if (!toast?.show) {
      console.warn("Toast not ready yet — provider ref may not be initialized");
      return "";
    }
    const toastData: Partial<ToastProps> & Record<string, unknown> = {
      variant: "info",
      ...options,
      title,
    };
    return toast.show(title, {
      data: toastData,
      duration: options?.persistent ? 0 : TOAST_DURATION_MS,
      ...(options?.id ? {id: options.id} : {}),
    });
  };
  return {
    catch: (error: unknown, message?: string, options?: UseToastVariantOptions): void => {
      let exceptionMsg: string;
      if (isAPIError(error)) {
        // Get the error without details.
        exceptionMsg = `${message}: ${printAPIError(error)}`;
        console.error(exceptionMsg);
      } else {
        const errorObj = error as {message?: string; error?: string} | null | undefined;
        exceptionMsg = errorObj?.message ?? errorObj?.error ?? String(error);
        console.error(`${message}: ${exceptionMsg}`);
      }
      show(exceptionMsg, {...options, variant: "error"});
    },
    error: (title: string, options?: UseToastVariantOptions): string => {
      console.error(title);
      return show(title, {...options, variant: "error"});
    },
    hide: (id: string) => toast?.hide?.(id),
    info: (title: string, options?: UseToastVariantOptions): string => {
      console.info(title);
      return show(title, {...options, variant: "info"});
    },
    show,
    success: (title: string, options?: UseToastVariantOptions): string => {
      console.info(title);
      return show(title, {...options, variant: "success"});
    },
    warn: (title: string, options?: UseToastVariantOptions): string => {
      console.warn(title);
      return show(title, {...options, variant: "warning"});
    },
  };
};

// TODO: Support secondary version of Toast.
// TODO: Support dismissible version of Toast. Currently only persistent are dismissible.
export const Toast = ({
  title,
  id,
  variant = "info",
  secondary,
  size = "sm",
  onDismiss,
  persistent,
  // TODO enforce these should only show if size is "lg" with type discrinimation
  subtitle,
  buttonText,
  buttonOnClick,
}: ToastProps): React.ReactElement => {
  const {theme} = useTheme();
  let color: SurfaceColor;
  let textColor: TextColor;
  let iconName: IconName;

  if (secondary) {
    throw new Error("Secondary not supported yet");
  }

  if (persistent && !onDismiss) {
    console.warn("Toast is persistent but no onDismiss callback provided");
  }

  if (variant === "warning") {
    color = "warning";
    textColor = "inverted";
    iconName = "triangle-exclamation";
  } else if (variant === "error") {
    color = "error";
    textColor = "inverted";
    iconName = "circle-exclamation";
  } else if (variant === "success") {
    color = "success";
    textColor = "inverted";
    iconName = "circle-check";
  } else {
    color = "neutralDark";
    textColor = "inverted";
    iconName = "circle-info";
  }

  const hasActionButton = Boolean(buttonText && buttonOnClick);

  return (
    <View
      style={[
        styles.wrapper,
        {
          display: "flex",
          flexDirection: "row",
          flexGrow: 1,
          justifyContent: "center",
          marginTop: theme.spacing.sm,
          maxWidth: Platform.OS === "web" ? 900 : "100%",
          paddingLeft: Platform.OS === "web" ? "10%" : theme.spacing.sm,
          paddingRight: Platform.OS === "web" ? "10%" : theme.spacing.sm,
          width: "100%",
        },
      ]}
    >
      <View
        style={{
          alignItems: "center",
          alignSelf: "flex-start",
          backgroundColor: theme.surface[color],
          borderRadius: theme.radius.default,
          display: "flex",
          flexDirection: "row",
          flexShrink: 1,
          gap: 10,
          maxWidth: "100%", // Ensure the content does not overflow
          minHeight: size === "lg" ? 32 : undefined,
          minWidth: 150,
          paddingBottom: theme.spacing.xs,
          paddingRight: theme.spacing.sm,
          paddingTop: theme.spacing.xs,
        }}
      >
        <View
          style={{
            alignItems: "center",
            display: "flex",
            flexDirection: "row",
            flexGrow: 1,
            flexShrink: 1, // Ensure the content can shrink properly
            gap: 12,
            maxWidth: "100%",
            paddingLeft: 8,
            paddingRight: 8,
          }}
        >
          <View
            style={{
              alignItems: size === "lg" ? "center" : undefined,
              alignSelf: size === "lg" ? "stretch" : undefined,
              borderBottomLeftRadius: theme.radius.default,
              borderTopLeftRadius: theme.radius.default,
              display: "flex",
              flexDirection: "row",
              paddingBottom: size === "lg" ? 8 : 0,
              paddingLeft: size === "lg" ? 4 : 0,
              paddingRight: size === "lg" ? 4 : 0,
              paddingTop: size === "lg" ? 8 : 0,
            }}
          >
            <Icon color={textColor} iconName={iconName} size={size === "lg" ? "2xl" : "md"} />
          </View>
          <View
            style={{
              alignItems: "flex-start",
              alignSelf: "stretch",
              display: "flex",
              flexDirection: "column",
              flexShrink: 1, // Ensure the content can shrink properly
              flexWrap: "wrap",
              gap: 2,
              justifyContent: "center",
              paddingBottom: 8,
              paddingTop: 8,
            }}
          >
            {size === "lg" ? (
              <Heading color={textColor} size="sm">
                {title}
              </Heading>
            ) : (
              <Text bold color={textColor} size="md">
                {title}
              </Text>
            )}
            {Boolean(size === "lg" && subtitle) && (
              <Text color={textColor} size="sm">
                {subtitle}
              </Text>
            )}
          </View>
        </View>
        {hasActionButton ? (
          <Pressable
            accessibilityHint={`Press to ${buttonText}`}
            accessibilityLabel={buttonText}
            accessibilityRole="button"
            onPress={buttonOnClick}
            style={{
              alignItems: "center",
              alignSelf: "center",
              backgroundColor: theme.surface.base,
              borderRadius: theme.radius.rounded,
              display: "flex",
              justifyContent: "center",
              marginLeft: theme.spacing.xs,
              paddingHorizontal: theme.spacing.sm,
              paddingVertical: theme.spacing.xs,
            }}
            testID={id ? `${ACTION_BUTTON_TEST_ID}-${id}` : ACTION_BUTTON_TEST_ID}
          >
            <Text bold color="primary" size="sm">
              {buttonText}
            </Text>
          </Pressable>
        ) : null}
        {Boolean(persistent && onDismiss) && (
          <Pressable
            accessibilityLabel="Dismiss notification"
            accessibilityRole="button"
            onPress={onDismiss}
            style={{
              alignItems: "center",
              alignSelf: "center",
              display: "flex",
              gap: 12,
              marginLeft: 10,
              padding: size === "lg" ? 8 : 0,
            }}
          >
            <Icon color={textColor} iconName="xmark" />
          </Pressable>
        )}
      </View>
    </View>
  );
};
