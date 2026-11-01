import type {FC} from "react";
import {useCallback, useEffect, useRef, useState} from "react";
import {Pressable, View} from "react-native";

import {Box} from "../Box";
import {Button} from "../Button";
import {Heading} from "../Heading";
import {Icon} from "../Icon";
import {LabeledCheckBox} from "../LabeledCheckBox";
import {OtpField} from "../OtpField";
import {Page} from "../Page";
import {Text} from "../Text";
import {TextField} from "../TextField";
import {useTheme} from "../Theme";
import {maskEmail} from "./loginMethods";
import type {TwoFactorChallengeScreenProps, TwoFactorCodeKind} from "./loginTypes";

const DEFAULT_CODE_LENGTH = 6;

/**
 * The second step of a two-factor sign-in: a one-time code from an authenticator app, or a backup
 * code, with an optional "trust this device" choice. Presentational: it reports the code through
 * `onSubmit` and never calls an auth client itself.
 *
 * @example
 * ```tsx
 * <TwoFactorChallengeScreen
 *   error={error}
 *   loading={isVerifying}
 *   onCancel={() => router.replace("/login")}
 *   onSubmit={async ({code, kind, trustDevice}) => {
 *     if (kind === "totp") {
 *       await authClient.twoFactor.verifyTotp({code, trustDevice});
 *     } else {
 *       await authClient.twoFactor.verifyBackupCode({code, trustDevice});
 *     }
 *   }}
 *   trustDeviceDays={30}
 * />
 * ```
 */
export const TwoFactorChallengeScreen: FC<TwoFactorChallengeScreenProps> = ({
  onSubmit,
  loading = false,
  error,
  trustDeviceDays,
  onCancel,
  cancelText = "Sign in a different way",
  title,
  accountLabel,
  logo,
  codeLength = DEFAULT_CODE_LENGTH,
  initialKind = "totp",
  initialTrustDevice,
  autoFocus = true,
  testID = "two-factor-challenge",
}) => {
  const [kind, setKind] = useState<TwoFactorCodeKind>(initialKind);
  const [totpCode, setTotpCode] = useState("");
  const [backupCode, setBackupCode] = useState("");
  // Trust starts checked for an authenticator code unless the caller opts out. Backup codes
  // keep the same choice when the user switches mode.
  const [trustDevice, setTrustDevice] = useState(initialTrustDevice ?? initialKind === "totp");
  // Remounting the code cells after an error clears them and puts focus back on the first cell.
  const [otpResetKey, setOtpResetKey] = useState(0);
  // Counts finished submissions so the effect below can react after the parent's error lands.
  const [settledCount, setSettledCount] = useState(0);
  const isSubmittingRef = useRef(false);
  const previousRef = useRef({error, loading, settledCount});

  const canTrustDevice = trustDeviceDays !== undefined && trustDeviceDays > 0;
  const isTotp = kind === "totp";
  const code = isTotp ? totpCode : backupCode.trim();
  const isCodeComplete = isTotp ? totpCode.length === codeLength : code.length > 0;

  const resetCode = useCallback((): void => {
    setTotpCode("");
    setBackupCode("");
    setOtpResetKey((current) => current + 1);
  }, []);

  // A rejected code shows as an error: clear the code when a new error arrives, and also when a
  // submission finishes (loading ends or onSubmit settles) with an error set, so the same error
  // text twice still clears it.
  useEffect(() => {
    const previous = previousRef.current;
    previousRef.current = {error, loading, settledCount};
    if (!error) {
      return;
    }
    const isNewError = error !== previous.error;
    const didFinishLoading = previous.loading && !loading;
    const didSettle = settledCount !== previous.settledCount;
    if (isNewError || didFinishLoading || didSettle) {
      resetCode();
    }
  }, [error, loading, resetCode, settledCount]);

  const submit = useCallback(
    async (submittedCode: string, submittedKind: TwoFactorCodeKind): Promise<void> => {
      // The ref blocks a second submission (auto-submit plus a Verify press) before loading lands.
      if (loading || !submittedCode || isSubmittingRef.current) {
        return;
      }
      isSubmittingRef.current = true;
      try {
        await onSubmit({
          code: submittedCode,
          kind: submittedKind,
          trustDevice: canTrustDevice && trustDevice,
        });
      } catch (error: unknown) {
        console.warn("TwoFactorChallengeScreen: onSubmit rejected", error);
        resetCode();
      } finally {
        isSubmittingRef.current = false;
        setSettledCount((current) => current + 1);
      }
    },
    [canTrustDevice, loading, onSubmit, resetCode, trustDevice]
  );

  const handleSubmitPress = useCallback(async (): Promise<void> => {
    if (!isCodeComplete) {
      return;
    }
    await submit(code, kind);
  }, [code, isCodeComplete, kind, submit]);

  const handleOtpEnter = useCallback(
    (enteredCode: string): void => {
      if (enteredCode.length !== codeLength) {
        return;
      }
      void submit(enteredCode, "totp");
    },
    [codeLength, submit]
  );

  const handleOtpComplete = useCallback(
    (completedCode: string): void => {
      void submit(completedCode, "totp");
    },
    [submit]
  );

  const handleToggleKind = useCallback((): void => {
    setKind((current) => (current === "totp" ? "backup" : "totp"));
    setTotpCode("");
    setBackupCode("");
  }, []);

  const {theme} = useTheme();
  const trustDeviceLabel = "Trust this device";
  const resolvedTitle = title ?? (isTotp ? "Enter your code" : "Use a backup code");
  const namedAccount = accountLabel?.includes("@") ? maskEmail(accountLabel) : accountLabel;
  const totpDescription = namedAccount
    ? `Open your authenticator app and enter the ${codeLength}-digit code for ${namedAccount}.`
    : `Open your authenticator app and enter the ${codeLength}-digit code.`;
  const displayedError = error || undefined;

  return (
    <Page navigation={undefined}>
      <Box alignSelf="center" flex="grow" maxWidth={400} padding={4} testID={testID} width="100%">
        <Box flex="grow" gap={5} width="100%">
          {Boolean(onCancel) && (
            <Pressable
              accessibilityRole="link"
              disabled={loading}
              onPress={onCancel}
              testID={`${testID}-back`}
            >
              <Box alignItems="center" direction="row" gap={1}>
                <Icon color="link" iconName="chevron-left" size="md" />
                <Text bold color="link">
                  Back
                </Text>
              </Box>
            </Pressable>
          )}
          {Boolean(logo) && <Box>{logo}</Box>}
          {Boolean(theme) && (
            <View
              style={{
                alignItems: "center",
                backgroundColor: theme!.surface.secondaryExtraLight,
                borderRadius: theme!.radius.full,
                height: 56,
                justifyContent: "center",
                width: 56,
              }}
            >
              <Icon color="secondaryDark" iconName={isTotp ? "shield-halved" : "lock"} size="xl" />
            </View>
          )}
          <Box gap={2}>
            <Heading size="xl" testID={`${testID}-title`}>
              {resolvedTitle}
            </Heading>
            <Text color="secondaryLight" testID={`${testID}-description`}>
              {isTotp
                ? totpDescription
                : "Enter one of the backup codes you saved when you turned on two-factor sign-in. Each code works once."}
            </Text>
          </Box>

          {isTotp ? (
            <OtpField
              accessibilityLabel="Authentication code"
              // After a rejected code the cells remount (otpResetKey) and take focus back.
              autoFocus={autoFocus || otpResetKey > 0}
              disabled={loading}
              invalid={Boolean(displayedError)}
              key={otpResetKey}
              length={codeLength}
              onChange={setTotpCode}
              onComplete={handleOtpComplete}
              onEnter={handleOtpEnter}
              testID={`${testID}-otp`}
              value={totpCode}
            />
          ) : (
            // Backup codes are case-sensitive: the "search" type turns off auto-capitalize and
            // autocorrect on native, which the "text" type leaves on.
            <View
              role={displayedError ? "alert" : undefined}
              testID={displayedError ? `${testID}-error` : undefined}
            >
              <TextField
                accessibilityLabel="Backup code"
                autoComplete="off"
                disabled={loading}
                errorPosition="below"
                errorText={displayedError}
                helperText="Dashes and spaces are optional."
                mono
                onChange={setBackupCode}
                onEnter={handleSubmitPress}
                placeholder="xxxxx-xxxxx"
                returnKeyType="go"
                testID={`${testID}-backup-input`}
                title="Backup code"
                type="search"
                value={backupCode}
              />
            </View>
          )}

          {canTrustDevice && (
            <LabeledCheckBox
              checked={trustDevice}
              disabled={loading}
              helperText={`We won't ask for a code here for ${trustDeviceDays} days.`}
              label={trustDeviceLabel}
              onChange={setTrustDevice}
              testID={`${testID}-trust-device`}
            />
          )}

          {Boolean(displayedError) && isTotp && (
            <View role="alert" style={{width: "100%"}} testID={`${testID}-error`}>
              <Box alignItems="start" direction="row" gap={2} width="100%">
                <Icon color="error" iconName="circle-exclamation" size="sm" />
                <View style={{flex: 1, minWidth: 0}}>
                  <Text color="error">{displayedError}</Text>
                </View>
              </Box>
            </View>
          )}
          <Button
            disabled={loading || !isCodeComplete}
            fullWidth
            loading={loading}
            onClick={handleSubmitPress}
            testID={`${testID}-submit`}
            text="Verify"
          />

          <Box alignItems="center">
            <Pressable
              accessibilityRole="link"
              disabled={loading}
              onPress={handleToggleKind}
              testID={`${testID}-backup-toggle`}
            >
              <Text bold color="link">
                {isTotp ? "Use a backup code instead" : "Use your authenticator app"}
              </Text>
            </Pressable>
          </Box>
        </Box>
        {Boolean(onCancel) && (
          <Box alignItems="center" paddingY={2}>
            <Pressable
              accessibilityRole="link"
              disabled={loading}
              onPress={onCancel}
              testID={`${testID}-cancel`}
            >
              <Text color="secondaryLight">{cancelText}</Text>
            </Pressable>
          </Box>
        )}
      </Box>
    </Page>
  );
};
