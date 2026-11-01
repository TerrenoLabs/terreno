import {type FC, useCallback} from "react";
import {Pressable, View} from "react-native";

import {Avatar} from "../Avatar";
import {Box} from "../Box";
import type {IconName} from "../Common";
import {Icon} from "../Icon";
import {Text} from "../Text";
import {useTheme} from "../Theme";
import {LastUsedPill} from "./LastUsedBadge";
import {type LoginMethodLabels, maskEmail} from "./loginMethods";
import type {LoginAccountOption, LoginAccountSource} from "./loginTypes";

interface LoginAccountCardProps {
  /** The account this row continues as. */
  account: LoginAccountOption;
  /** Whether the account is a signed-in session or a remembered account. */
  source: LoginAccountSource;
  /** Names for the account's sign-in method. */
  method: LoginMethodLabels;
  /** Called when the row is pressed. Ignored while `editing`. */
  onContinue: (account: LoginAccountOption, source: LoginAccountSource) => void | Promise<void>;
  /** Called when Remove is pressed. Remove renders only when this is set and `editing` is true. */
  onForget?: (account: LoginAccountOption) => void | Promise<void>;
  /** Whether the row is disabled. */
  disabled?: boolean;
  /** Test ID of the pressable row. */
  continueTestID: string;
  /** Test ID of the Remove button. */
  forgetTestID: string;
  /** Draws the separator above this row. */
  separated?: boolean;
  /** Shows the last-used pill after the name. */
  isLastUsed?: boolean;
  /** Last-used pill text. */
  lastUsedLabel?: string;
  /** Test ID of the last-used pill. */
  lastUsedTestID?: string;
  /** Swaps the chevron for Remove, or "Can't remove" on a session. */
  editing?: boolean;
}

const BRAND_ICONS = new Set(["apple", "github", "google"]);

const providerIcon = (method: string): {iconName: IconName; type: "brand" | "solid"} => {
  if (BRAND_ICONS.has(method)) {
    return {iconName: method as IconName, type: "brand"};
  }
  if (method === "passkey") {
    return {iconName: "key", type: "solid"};
  }
  return {iconName: "envelope", type: "solid"};
};

const capitalize = (value: string): string => {
  if (!value) {
    return value;
  }
  return `${value.charAt(0).toUpperCase()}${value.slice(1)}`;
};

/**
 * One row in the continue-as list: avatar, name, method and a masked email. The whole row
 * continues the sign-in, except in Edit mode where a remembered account can be removed.
 */
export const LoginAccountCard: FC<LoginAccountCardProps> = ({
  account,
  source,
  method,
  onContinue,
  onForget,
  disabled = false,
  continueTestID,
  forgetTestID,
  separated = false,
  isLastUsed = false,
  lastUsedLabel = "Last used",
  lastUsedTestID,
  editing = false,
}) => {
  const {theme} = useTheme();
  const provider = capitalize(method.name);
  const displayName = account.name ?? account.email;
  const title = displayName ?? `Continue with ${method.phrase}`;
  const masked = account.email ? maskEmail(account.email) : undefined;
  const isSession = source === "session";
  const canForget = !isSession && Boolean(onForget);
  const accessibilityLabel = displayName
    ? `Continue as ${displayName}, ${method.name}`
    : `Continue with ${method.phrase}`;
  const removeLabel = `Remove ${displayName ?? "this account"}, ${provider}, from this device`;
  const icon = providerIcon(account.method);

  const handleContinue = useCallback((): void => {
    void onContinue(account, source);
  }, [account, onContinue, source]);

  const handleForget = useCallback(async (): Promise<void> => {
    await onForget?.(account);
  }, [account, onForget]);

  if (!theme) {
    return null;
  }

  const identity = (
    <>
      {displayName ? (
        <Avatar name={displayName} size="sm" src={account.image} />
      ) : (
        <Icon color="secondaryLight" iconName="circle-user" size="xl" />
      )}
      <Box flex="shrink" gap={1}>
        <Box alignItems="center" direction="row" gap={2}>
          <Text bold truncate>
            {title}
          </Text>
          {isLastUsed && (
            <LastUsedPill
              label={lastUsedLabel}
              testID={lastUsedTestID ?? `${continueTestID}-last-used`}
            />
          )}
        </Box>
        <Box alignItems="center" direction="row" gap={2}>
          {isSession ? (
            <View
              style={{
                backgroundColor: theme.status.active,
                borderRadius: 4,
                height: 8,
                width: 8,
              }}
            />
          ) : (
            <Icon color="secondaryLight" iconName={icon.iconName} size="sm" type={icon.type} />
          )}
          <Text color="secondaryLight" size="sm" truncate>
            {isSession
              ? account.email
                ? `Signed in · ${account.email}`
                : "Signed in"
              : masked
                ? `${provider} · ${masked}`
                : provider}
          </Text>
        </Box>
      </Box>
    </>
  );

  return (
    <View
      style={{
        borderTopColor: theme.border.hover,
        borderTopWidth: separated ? 1 : 0,
      }}
    >
      <Box alignItems="center" direction="row" gap={3} minHeight={68} paddingX={4} paddingY={3}>
        {editing ? (
          <>
            <Box alignItems="center" direction="row" flex="grow" gap={3}>
              {identity}
            </Box>
            {canForget ? (
              <Pressable
                accessibilityLabel={removeLabel}
                accessibilityRole="button"
                accessibilityState={{disabled}}
                disabled={disabled}
                onPress={() => {
                  void handleForget();
                }}
                style={{justifyContent: "center", minHeight: 44, paddingHorizontal: 8}}
                testID={forgetTestID}
              >
                <Text color="error">Remove</Text>
              </Pressable>
            ) : (
              <Text color="secondaryLight" size="sm">
                Can't remove
              </Text>
            )}
          </>
        ) : (
          <Pressable
            accessibilityHint={
              isSession ? "Switches to this signed-in account" : "Signs in to this account"
            }
            accessibilityRole="button"
            accessibilityState={{disabled}}
            aria-label={accessibilityLabel}
            disabled={disabled}
            onPress={handleContinue}
            style={{alignItems: "center", flexDirection: "row", flexGrow: 1, gap: 12}}
            testID={continueTestID}
          >
            {identity}
            <Icon color="secondaryLight" iconName="chevron-right" size="md" />
          </Pressable>
        )}
      </Box>
    </View>
  );
};
