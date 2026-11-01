import {type FC, useCallback, useEffect, useState} from "react";
import {Pressable} from "react-native";

import {Box} from "../Box";
import {Heading} from "../Heading";
import {Text} from "../Text";
import {LoginAccountCard} from "./LoginAccountCard";
import type {LoginMethodLabels} from "./loginMethods";
import type {LoginAccountOption, LoginAccountSource} from "./loginTypes";

interface LoginAccountEntry {
  account: LoginAccountOption;
  source: LoginAccountSource;
  method: LoginMethodLabels;
}

interface LoginAccountListProps {
  /** Sessions first, then remembered accounts. */
  accounts: LoginAccountEntry[];
  /** Called when a row is pressed. */
  onContinue: (account: LoginAccountOption, source: LoginAccountSource) => void | Promise<void>;
  /** Enables Edit mode. Sessions stay unforgettable. */
  onForget?: (account: LoginAccountOption) => void | Promise<void>;
  /** Disables every row. */
  disabled?: boolean;
  /** Prefix for row test IDs: `${testID}-continue-${index}` and `${testID}-forget-${index}`. */
  testID: string;
  /** Method id that gets the last-used pill, when it matches an account. */
  lastUsedMethod?: string;
  /** Last-used pill text. */
  lastUsedLabel: string;
  /** Opens the list already in Edit mode. */
  initialEditing?: boolean;
}

/**
 * The continue-as list: one bordered group of account rows, with an Edit mode that forgets
 * remembered accounts on this device.
 */
export const LoginAccountList: FC<LoginAccountListProps> = ({
  accounts,
  onContinue,
  onForget,
  disabled = false,
  testID,
  lastUsedMethod,
  lastUsedLabel,
  initialEditing = false,
}) => {
  const [isEditing, setIsEditing] = useState(initialEditing);
  const rememberedCount = accounts.filter((entry) => entry.source === "remembered").length;
  const canEdit = Boolean(onForget) && rememberedCount > 0;

  // Removing the last remembered account leaves nothing to edit.
  useEffect(() => {
    if (isEditing && rememberedCount === 0) {
      setIsEditing(false);
    }
  }, [isEditing, rememberedCount]);

  const toggleEditing = useCallback((): void => {
    setIsEditing((current) => !current);
  }, []);

  if (accounts.length === 0) {
    return null;
  }

  return (
    <Box testID={`${testID}-accounts`} width="100%">
      <Box alignItems="center" direction="row" justifyContent="between" marginBottom={2}>
        <Heading size="sm">{isEditing ? "Accounts on this device" : "Continue as"}</Heading>
        {canEdit && (
          <Pressable
            accessibilityRole="button"
            onPress={toggleEditing}
            testID={`${testID}-accounts-edit`}
          >
            <Text bold color="link">
              {isEditing ? "Done" : "Edit"}
            </Text>
          </Pressable>
        )}
      </Box>
      <Box border="default" overflow="hidden" rounding="lg" width="100%">
        {accounts.map((entry, index) => (
          <LoginAccountCard
            account={entry.account}
            continueTestID={`${testID}-continue-${index}`}
            disabled={disabled}
            editing={isEditing}
            forgetTestID={`${testID}-forget-${index}`}
            isLastUsed={Boolean(lastUsedMethod) && entry.account.method === lastUsedMethod}
            key={`${entry.source}-${entry.account.id}`}
            lastUsedLabel={lastUsedLabel}
            lastUsedTestID={`${testID}-last-used-account-${index}`}
            method={entry.method}
            onContinue={onContinue}
            onForget={entry.source === "remembered" ? onForget : undefined}
            separated={index > 0}
            source={entry.source}
          />
        ))}
      </Box>
      {isEditing && (
        <Box marginTop={2}>
          <Text color="secondaryLight" size="sm">
            Removing an account only forgets it on this device. It doesn't sign you out anywhere
            else or delete the account.
          </Text>
        </Box>
      )}
    </Box>
  );
};
