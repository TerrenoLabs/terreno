import FontAwesome6 from "@expo/vector-icons/FontAwesome6";
import debounce from "lodash/debounce";
import {type FC, useMemo, useState} from "react";
import {ActivityIndicator, Pressable, Text, View} from "react-native";

import {Box} from "./Box";
import type {SocialLoginButtonProps} from "./Common";
import {OutlinePill} from "./login/OutlinePill";
import {useTheme} from "./Theme";
import {Unifier} from "./Unifier";

/**
 * Brand colors for social login providers
 */
const PROVIDER_COLORS = {
  apple: {
    background: "#000000",
    border: "#000000",
    text: "#ffffff",
  },
  github: {
    background: "#24292e",
    border: "#24292e",
    text: "#ffffff",
  },
  google: {
    background: "#ffffff",
    border: "#dadce0",
    text: "#1f1f1f",
  },
};

/**
 * Font Awesome icon names for social providers
 */
const PROVIDER_ICONS: Record<string, string> = {
  apple: "apple",
  github: "github",
  google: "google",
};

/**
 * Display names for the branded social providers.
 */
export const SOCIAL_PROVIDER_NAMES: Record<string, string> = {
  apple: "Apple",
  github: "GitHub",
  google: "Google",
};

/**
 * The display name of a branded provider id, or undefined for any other id. Ids come from the
 * server and from device storage, so an id such as `__proto__` or `constructor` must not read an
 * `Object.prototype` member.
 */
export const getSocialProviderName = (providerId: string): string | undefined => {
  if (!Object.hasOwn(SOCIAL_PROVIDER_NAMES, providerId)) {
    return undefined;
  }
  return SOCIAL_PROVIDER_NAMES[providerId];
};

/**
 * A branded social login button for OAuth authentication.
 *
 * Supports Google, GitHub, and Apple sign-in with appropriate brand colors
 * and icons following each provider's brand guidelines.
 *
 * @example
 * ```tsx
 * <SocialLoginButton
 *   provider="google"
 *   onPress={async () => {
 *     await authClient.signIn.social({ provider: "google" });
 *   }}
 * />
 * ```
 */
export const SocialLoginButton: FC<SocialLoginButtonProps> = ({
  accessibilityLabel,
  provider,
  onPress,
  loading: propsLoading,
  variant = "primary",
  disabled = false,
  fullWidth = true,
  text,
  testID,
  lastUsedLabel,
  lastUsedTestID,
}) => {
  // Pressing tracks the button's own onPress; the parent's `loading` prop is read on every render
  // so a parent can start or clear the spinner after mount.
  const [isPressing, setIsPressing] = useState(false);
  const loading = isPressing || propsLoading;
  const {theme} = useTheme();
  const resolvedTestID = testID ?? `social-login-${provider}`;

  const {backgroundColor, borderColor, textColor} = useMemo(() => {
    const colors = PROVIDER_COLORS[provider];

    if (variant === "outline") {
      return {
        backgroundColor: theme?.surface.base ?? "#ffffff",
        borderColor: colors.border,
        textColor: theme?.text.primary ?? "#1f1f1f",
      };
    }

    return {
      backgroundColor: colors.background,
      borderColor: colors.border,
      textColor: colors.text,
    };
  }, [provider, variant, theme]);

  const iconName = PROVIDER_ICONS[provider];
  const providerName = SOCIAL_PROVIDER_NAMES[provider];
  const buttonText = text ?? `Continue with ${providerName}`;

  const handlePress = useMemo(
    () =>
      debounce(
        async () => {
          await Unifier.utils.haptic();
          setIsPressing(true);

          try {
            await onPress();
          } catch (error) {
            console.error(`Social login error (${provider}):`, error);
          } finally {
            setIsPressing(false);
          }
        },
        500,
        {leading: true}
      ),
    [onPress, provider]
  );

  if (!theme) {
    return null;
  }

  const isDisabled = disabled || loading;

  if (variant === "outline") {
    return (
      <OutlinePill
        accessibilityLabel={accessibilityLabel ?? buttonText}
        disabled={disabled}
        icon={
          iconName ? (
            <FontAwesome6
              brand
              color={isDisabled ? theme.text.secondaryLight : theme.text.primary}
              name={iconName}
              size={18}
            />
          ) : undefined
        }
        lastUsedLabel={lastUsedLabel}
        lastUsedTestID={lastUsedTestID}
        loading={loading}
        onPress={handlePress}
        testID={resolvedTestID}
        text={buttonText}
      />
    );
  }

  return (
    <Pressable
      accessibilityHint={`Sign in with ${providerName}`}
      aria-label={accessibilityLabel ?? buttonText}
      aria-role="button"
      disabled={isDisabled}
      onPress={handlePress}
      style={{
        alignItems: "center",
        alignSelf: fullWidth ? "stretch" : undefined,
        backgroundColor: isDisabled ? theme.surface.disabled : backgroundColor,
        borderColor,
        borderRadius: theme.radius.rounded,
        borderWidth: 1,
        flexDirection: "row",
        justifyContent: "center",
        opacity: isDisabled ? 0.6 : 1,
        paddingHorizontal: 20,
        paddingVertical: 12,
        width: fullWidth ? "100%" : "auto",
      }}
      testID={resolvedTestID}
    >
      <View style={{alignItems: "center", flexDirection: "row"}}>
        {Boolean(iconName) && (
          <View style={{marginRight: 12}}>
            <FontAwesome6
              brand
              color={isDisabled ? theme.text.secondaryLight : textColor}
              name={iconName}
              size={20}
            />
          </View>
        )}
        <Text
          style={{
            color: isDisabled ? theme.text.secondaryLight : textColor,
            fontSize: 16,
            fontWeight: "600",
          }}
        >
          {buttonText}
        </Text>
        {Boolean(loading) && (
          <Box marginLeft={2}>
            <ActivityIndicator
              color={isDisabled ? theme.text.secondaryLight : textColor}
              size="small"
            />
          </Box>
        )}
      </View>
    </Pressable>
  );
};
