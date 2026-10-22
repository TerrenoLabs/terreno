import {type FC, useCallback, useEffect, useRef, useState} from "react";
import {type TextInput, View} from "react-native";

import {Box} from "../Box";
import {Button} from "../Button";
import {Card} from "../Card";
import {Heading} from "../Heading";
import {LabeledCheckBox} from "../LabeledCheckBox";
import {Text} from "../Text";
import {TextField} from "../TextField";
import {getRejectionMessage} from "./securityMethods";
import type {PasswordCardMode, PasswordCardProps} from "./securityTypes";

const DEFAULT_MIN_LENGTH = 8;

/** Inline error per field, shown under that field after a submit attempt. */
interface PasswordFieldErrors {
  currentPassword?: string;
  newPassword?: string;
  confirmPassword?: string;
}

/** Fields in screen order, for focusing the first invalid one. */
const FIELD_ORDER: (keyof PasswordFieldErrors)[] = [
  "currentPassword",
  "newPassword",
  "confirmPassword",
];

/** Copy for each mode. */
const MODE_COPY: Record<
  PasswordCardMode,
  {title: string; description: string; submit: string; success: string}
> = {
  change: {
    description: "Choose a new password for signing in with your email.",
    submit: "Change password",
    success: "Your password has been changed.",
    title: "Change password",
  },
  set: {
    description:
      "You sign in with a linked account. Add a password to also sign in with your email.",
    submit: "Set password",
    success: "Your password has been set. You can now sign in with your email.",
    title: "Set a password",
  },
};

/**
 * Changes the user's password, or sets a first one for a user who signed up with a social
 * provider. Change mode asks for the current password and can sign out other devices.
 * Validates length and confirmation inline, then reports through `onSubmit`; never calls an auth
 * client itself.
 *
 * @example
 * ```tsx
 * <PasswordCard
 *   hasPassword={accounts.some((account) => account.providerId === "credential")}
 *   onSubmit={async ({mode, currentPassword, newPassword, revokeOtherSessions}) => {
 *     if (mode === "change") {
 *       await authClient.changePassword({currentPassword, newPassword, revokeOtherSessions});
 *     } else {
 *       await setPassword({newPassword}); // a server route: Better Auth's setPassword is server-only
 *     }
 *   }}
 * />
 * ```
 */
export const PasswordCard: FC<PasswordCardProps> = ({
  hasPassword,
  onSubmit,
  showRevokeOtherSessions = true,
  minLength = DEFAULT_MIN_LENGTH,
  error,
  loading = false,
  testID = "password-card",
}) => {
  const mode: PasswordCardMode = hasPassword ? "change" : "set";
  const copy = MODE_COPY[mode];
  const [currentPassword, setCurrentPassword] = useState("");
  const [newPassword, setNewPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [revokeOtherSessions, setRevokeOtherSessions] = useState(false);
  const [fieldErrors, setFieldErrors] = useState<PasswordFieldErrors>({});
  const [submitError, setSubmitError] = useState<string | undefined>(undefined);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [successMessage, setSuccessMessage] = useState<string | undefined>(undefined);
  const isSubmittingRef = useRef(false);
  const previousModeRef = useRef(mode);
  const inputRefs = useRef<Partial<Record<keyof PasswordFieldErrors, TextInput | null>>>({});

  const setCurrentInputRef = useCallback((ref: TextInput | null): void => {
    inputRefs.current.currentPassword = ref;
  }, []);
  const setNewInputRef = useCallback((ref: TextInput | null): void => {
    inputRefs.current.newPassword = ref;
  }, []);
  const setConfirmInputRef = useCallback((ref: TextInput | null): void => {
    inputRefs.current.confirmPassword = ref;
  }, []);

  const resetForm = useCallback((): void => {
    setCurrentPassword("");
    setNewPassword("");
    setConfirmPassword("");
    setRevokeOtherSessions(false);
    setFieldErrors({});
  }, []);

  // Setting a first password flips the card to change mode; start that form empty.
  useEffect(() => {
    if (previousModeRef.current === mode) {
      return;
    }
    previousModeRef.current = mode;
    resetForm();
    setSubmitError(undefined);
  }, [mode, resetForm]);

  const isBusy = loading || isSubmitting;
  const invalidFieldCount = Object.values(fieldErrors).filter(Boolean).length;
  const shownError = error ?? submitError;

  const handleCurrentChange = useCallback((value: string): void => {
    setCurrentPassword(value);
    setSuccessMessage(undefined);
    setFieldErrors((current) => ({...current, currentPassword: undefined}));
  }, []);

  const handleNewChange = useCallback((value: string): void => {
    setNewPassword(value);
    setSuccessMessage(undefined);
    setFieldErrors((current) => ({...current, newPassword: undefined}));
  }, []);

  const handleConfirmChange = useCallback((value: string): void => {
    setConfirmPassword(value);
    setSuccessMessage(undefined);
    setFieldErrors((current) => ({...current, confirmPassword: undefined}));
  }, []);

  const validate = useCallback((): PasswordFieldErrors => {
    const errors: PasswordFieldErrors = {};
    if (mode === "change" && !currentPassword) {
      errors.currentPassword = "Enter your current password.";
    }
    if (newPassword.length < minLength) {
      errors.newPassword = `Use at least ${minLength} characters.`;
    }
    if (confirmPassword !== newPassword) {
      errors.confirmPassword = "Passwords don't match.";
    }
    return errors;
  }, [confirmPassword, currentPassword, minLength, mode, newPassword]);

  const handleSubmit = useCallback(async (): Promise<void> => {
    // The ref blocks a second submission (Enter plus a press) before state updates land.
    if (isBusy || isSubmittingRef.current) {
      return;
    }
    const errors = validate();
    setFieldErrors(errors);
    const firstInvalidField = FIELD_ORDER.find((field) => Boolean(errors[field]));
    if (firstInvalidField) {
      inputRefs.current[firstInvalidField]?.focus?.();
      return;
    }
    isSubmittingRef.current = true;
    setIsSubmitting(true);
    setSubmitError(undefined);
    setSuccessMessage(undefined);
    try {
      await onSubmit({
        ...(mode === "change" ? {currentPassword} : {}),
        mode,
        newPassword,
        revokeOtherSessions: mode === "change" && showRevokeOtherSessions && revokeOtherSessions,
      });
      resetForm();
      setSuccessMessage(copy.success);
    } catch (rejection: unknown) {
      console.warn("PasswordCard: onSubmit rejected", rejection);
      setSubmitError(
        getRejectionMessage({
          error: rejection,
          fallback: "Couldn't update your password. Try again.",
        })
      );
    } finally {
      isSubmittingRef.current = false;
      setIsSubmitting(false);
    }
  }, [
    copy.success,
    currentPassword,
    isBusy,
    mode,
    newPassword,
    onSubmit,
    resetForm,
    revokeOtherSessions,
    showRevokeOtherSessions,
    validate,
  ]);

  return (
    <Card testID={testID}>
      <Box gap={4}>
        <Box gap={1}>
          <Heading size="md" testID={`${testID}-title`}>
            {copy.title}
          </Heading>
          <Text color="secondaryLight">{copy.description}</Text>
        </Box>

        {mode === "change" && (
          <TextField
            accessibilityLabel="Current password"
            autoComplete="current-password"
            disabled={isBusy}
            errorText={fieldErrors.currentPassword}
            inputRef={setCurrentInputRef}
            onChange={handleCurrentChange}
            onEnter={handleSubmit}
            testID={`${testID}-current`}
            title="Current password"
            type="password"
            value={currentPassword}
          />
        )}

        <TextField
          accessibilityLabel="New password"
          autoComplete="new-password"
          disabled={isBusy}
          errorText={fieldErrors.newPassword}
          helperText={fieldErrors.newPassword ? undefined : `At least ${minLength} characters.`}
          inputRef={setNewInputRef}
          onChange={handleNewChange}
          onEnter={handleSubmit}
          testID={`${testID}-new`}
          title="New password"
          type="password"
          value={newPassword}
        />

        <TextField
          accessibilityLabel="Confirm new password"
          autoComplete="new-password"
          disabled={isBusy}
          errorText={fieldErrors.confirmPassword}
          inputRef={setConfirmInputRef}
          onChange={handleConfirmChange}
          onEnter={handleSubmit}
          testID={`${testID}-confirm`}
          title="Confirm new password"
          type="password"
          value={confirmPassword}
        />

        {mode === "change" && showRevokeOtherSessions && (
          <LabeledCheckBox
            checked={revokeOtherSessions}
            disabled={isBusy}
            label="Sign out of other devices"
            onChange={setRevokeOtherSessions}
            testID={`${testID}-revoke-other-sessions`}
          />
        )}

        {invalidFieldCount > 0 && (
          <View role="alert" testID={`${testID}-validation-error`}>
            <Text color="error">
              {invalidFieldCount === 1
                ? "Fix the highlighted field."
                : `Fix the ${invalidFieldCount} highlighted fields.`}
            </Text>
          </View>
        )}

        {Boolean(shownError) && (
          <View role="alert" testID={`${testID}-error`}>
            <Text color="error">{shownError}</Text>
          </View>
        )}

        {Boolean(successMessage) && !shownError && (
          <View role="status" testID={`${testID}-success`}>
            <Text color="success">{successMessage}</Text>
          </View>
        )}

        <Box alignItems="start">
          <Button
            disabled={isBusy}
            loading={isBusy}
            onClick={handleSubmit}
            testID={`${testID}-submit`}
            text={copy.submit}
          />
        </Box>
      </Box>
    </Card>
  );
};
