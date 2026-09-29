import FontAwesome6 from "@expo/vector-icons/FontAwesome6";
import debounce from "lodash/debounce";
import {type FC, useState} from "react";
import {ActivityIndicator, Text as NativeText, Pressable, View} from "react-native";

import type {IconButtonProps} from "./Common";
import {useCustomIcon} from "./IconRegistry";
import {isNarrowViewport} from "./MediaQuery";
import {Modal} from "./Modal";
import {Text} from "./Text";
import {useTheme} from "./Theme";
import {Tooltip} from "./Tooltip";
import {Unifier} from "./Unifier";
import {applyColorOpacity, isNative} from "./Utilities";

interface ConfirmationModalProps {
  visible: boolean;
  title: string;
  subtitle?: string;
  text: string;
  onConfirm: () => void;
  onCancel: () => void;
}

const ConfirmationModal: FC<ConfirmationModalProps> = ({
  visible,
  title,
  subtitle,
  text,
  onConfirm,
  onCancel,
}) => {
  return (
    <Modal
      onDismiss={onCancel}
      primaryButtonOnClick={onConfirm}
      primaryButtonText="Confirm"
      secondaryButtonOnClick={onCancel}
      secondaryButtonText="Cancel"
      subtitle={subtitle}
      title={title}
      visible={visible}
    >
      <Text>{text}</Text>
    </Modal>
  );
};

const IconButtonComponent: FC<IconButtonProps> = ({
  accessibilityHint,
  accessibilityLabel,
  confirmationHeading = "Confirm",
  confirmationText = "Are you sure you want to continue?",
  disabled = false,
  iconName,
  indicator,
  indicatorText,
  loading: propsLoading = false,
  backgroundOpacity,
  size = "default",
  state = "default",
  testID,
  variant = "primary",
  withConfirmation = false,
  tooltipText,
  onClick,
}) => {
  const [loading, setLoading] = useState(propsLoading);
  const [showConfirmation, setShowConfirmation] = useState(false);
  const {theme} = useTheme();
  const CustomIcon = useCustomIcon(iconName);
  let accessLabel = accessibilityLabel;
  if (tooltipText && accessibilityLabel === "") {
    accessLabel = tooltipText;
  }

  if (!theme) {
    return null;
  }

  let backgroundColor = theme.surface.primary;
  let color = theme.text.inverted;

  if (disabled) {
    backgroundColor = theme.surface.disabled;
    color = theme.text.secondaryLight;
  } else if (variant === "secondary") {
    backgroundColor = theme.surface.neutralLight;
    color = theme.surface.secondaryDark;
  } else if (variant === "muted") {
    backgroundColor = theme.text.inverted;
    color = theme.surface.primary;
  } else if (variant === "navigation") {
    backgroundColor = theme.text.inverted;
    color = theme.text.primary;
  } else if (variant === "destructive") {
    backgroundColor = theme.text.inverted;
    color = theme.text.error;
  } else if (variant === "ghost") {
    backgroundColor = "transparent";
    color = theme.surface.secondaryDark;
  }

  if (!disabled && state === "active") {
    if (variant === "primary") {
      backgroundColor = theme.primitives.primary600;
    } else {
      backgroundColor = theme.surface.primary;
      color = theme.text.inverted;
    }
  }

  if (typeof backgroundOpacity === "number") {
    backgroundColor = applyColorOpacity({color: backgroundColor, opacity: backgroundOpacity});
  }

  const indicatorColor = indicator ? theme.surface[indicator] : undefined;

  return (
    <Pressable
      accessibilityHint={
        (accessibilityHint ?? withConfirmation)
          ? `Opens a confirmation dialog to confirm ${accessLabel}`
          : `Press to perform ${accessLabel} action`
      }
      aria-label={accessLabel}
      aria-role="button"
      disabled={loading || disabled}
      onPress={debounce(
        // TODO: Allow for a click outside of the confirmation modal to close it.
        async () => {
          await Unifier.utils.haptic();
          setLoading(true);
          try {
            // If a confirmation is required, and the confirmation modal is not currently open,
            // open it
            if (withConfirmation && !showConfirmation) {
              setShowConfirmation(true);
            } else if (!withConfirmation && onClick) {
              // If a confirmation is not required, perform the action.
              await onClick();
            }
          } catch (error) {
            setLoading(false);
            throw error;
          }
          setLoading(false);
        },
        500,
        {leading: true}
      )}
      style={{
        alignItems: "center",
        backgroundColor,
        borderRadius: theme.radius.rounded,
        height: size === "sm" ? 28 : 32,
        justifyContent: "center",
        width: size === "sm" ? 28 : 32,
      }}
      testID={testID}
    >
      {loading ? (
        <ActivityIndicator color={color} size="small" />
      ) : CustomIcon ? (
        <CustomIcon color={color} size={size === "sm" ? 12 : variant === "navigation" ? 20 : 16} />
      ) : (
        <FontAwesome6
          color={color}
          name={iconName}
          selectable={undefined}
          size={size === "sm" ? 12 : variant === "navigation" ? 20 : 16}
          solid
          style={{textAlign: "center"}}
        />
      )}
      {Boolean(indicator) && (
        <View
          style={{
            alignItems: "center",
            backgroundColor: indicatorColor,
            borderRadius: 10,
            bottom: 0,
            display: "flex",
            height: 12,
            justifyContent: "center",
            padding: theme.spacing.xs,
            position: "absolute",
            right: 0,
            width: 12,
          }}
        >
          {Boolean(indicatorText) && (
            <NativeText
              style={{
                color: theme.text.inverted,
                fontFamily: "text",
                fontSize: 10,
                fontWeight: 700,
                textAlign: "center",
              }}
            >
              {indicatorText}
            </NativeText>
          )}
        </View>
      )}
      {withConfirmation && (
        <ConfirmationModal
          onCancel={() => setShowConfirmation(false)}
          onConfirm={async () => {
            await onClick();
            setShowConfirmation(false);
          }}
          subtitle={undefined}
          text={confirmationText}
          title={confirmationHeading}
          visible={showConfirmation}
        />
      )}
    </Pressable>
  );
};

export const IconButton: FC<IconButtonProps> = (props) => {
  const {tooltipText, tooltipIdealPosition, tooltipIncludeArrow = false} = props;
  const isMobileOrNative = isNarrowViewport() || isNative();

  if (tooltipText && !isMobileOrNative) {
    return (
      <Tooltip
        idealPosition={tooltipIdealPosition}
        includeArrow={tooltipIncludeArrow}
        text={tooltipText}
      >
        <IconButtonComponent {...props} />
      </Tooltip>
    );
  }

  return <IconButtonComponent {...props} />;
};
