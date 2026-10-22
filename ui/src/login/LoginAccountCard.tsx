import {type FC, useCallback} from "react";
import {Pressable} from "react-native";

import {Avatar} from "../Avatar";
import {Box} from "../Box";
import {Button} from "../Button";
import {Icon} from "../Icon";
import {Text} from "../Text";
import type {LoginMethodLabels} from "./loginMethods";
import type {LoginAccountOption, LoginAccountSource} from "./loginTypes";

interface LoginAccountCardProps {
  /** The account this card continues as. */
  account: LoginAccountOption;
  /** Whether the account is a signed-in session or a remembered account. */
  source: LoginAccountSource;
  /** Names for the account's sign-in method. */
  method: LoginMethodLabels;
  /** Called when the card is pressed. */
  onContinue: (account: LoginAccountOption, source: LoginAccountSource) => void | Promise<void>;
  /** Called when the forget button is pressed. The button renders only when this is set. */
  onForget?: (account: LoginAccountOption) => void | Promise<void>;
  /** Whether the card is disabled. */
  disabled?: boolean;
  /** Test ID of the pressable card. */
  continueTestID: string;
  /** Test ID of the forget button. */
  forgetTestID: string;
}

/**
 * A one-tap "Continue" card on the login screen. Shows the account's avatar, name and email when
 * the app remembers them, and otherwise only the method it signs in with.
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
}) => {
  const displayName = account.name ?? account.email;
  const title = displayName ?? `Continue with ${method.phrase}`;
  const subtitle = account.name && account.email ? account.email : undefined;
  const capitalizedName = `${method.name.charAt(0).toLocaleUpperCase()}${method.name.slice(1)}`;
  const status =
    source === "session"
      ? `Signed in on this device · ${capitalizedName}`
      : `Uses ${method.phrase}`;
  const accessibilityLabel = displayName
    ? `Continue as ${displayName}, ${method.name}`
    : `Continue with ${method.phrase}`;

  const handleContinue = useCallback((): void => {
    void onContinue(account, source);
  }, [account, onContinue, source]);

  const handleForget = useCallback(async (): Promise<void> => {
    await onForget?.(account);
  }, [account, onForget]);

  return (
    <Box
      alignItems="center"
      border="default"
      direction="row"
      gap={2}
      padding={3}
      rounding="md"
      width="100%"
    >
      {/* A Pressable rather than a clickable Box so the card keeps its exact testID. */}
      <Pressable
        accessibilityHint={
          source === "session" ? "Switches to this signed-in account" : "Signs in to this account"
        }
        accessibilityRole="button"
        accessibilityState={{disabled}}
        aria-label={accessibilityLabel}
        disabled={disabled}
        onPress={handleContinue}
        style={{alignItems: "center", flexDirection: "row", flexGrow: 1, flexShrink: 1, gap: 12}}
        testID={continueTestID}
      >
        {displayName ? (
          <Avatar name={displayName} size="sm" src={account.image} />
        ) : (
          <Icon color="secondaryLight" iconName="circle-user" size="2xl" type="regular" />
        )}
        <Box flex="shrink">
          <Text bold truncate>
            {title}
          </Text>
          {Boolean(subtitle) && (
            <Text color="secondaryLight" size="sm" truncate>
              {subtitle}
            </Text>
          )}
          <Text color="secondaryLight" size="sm">
            {status}
          </Text>
        </Box>
      </Pressable>
      {source === "remembered" && Boolean(onForget) && (
        <Button
          accessibilityLabel={`Forget ${displayName ?? `this ${method.name} account`}`}
          disabled={disabled}
          onClick={handleForget}
          size="sm"
          testID={forgetTestID}
          text="Forget"
          variant="muted"
        />
      )}
    </Box>
  );
};
