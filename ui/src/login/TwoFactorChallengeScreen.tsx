import type {FC} from "react";
import {useCallback, useEffect, useRef, useState} from "react";
import {View} from "react-native";

import {Box} from "../Box";
import {Button} from "../Button";
import {Heading} from "../Heading";
import {LabeledCheckBox} from "../LabeledCheckBox";
import {OtpField} from "../OtpField";
import {Page} from "../Page";
import {Text} from "../Text";
import {TextField} from "../TextField";
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
  cancelText = "Use another method",
  title = "Two-factor authentication",
  logo,
  codeLength = DEFAULT_CODE_LENGTH,
  initialKind = "totp",
  testID = "two-factor-challenge",
}) => {
  const [kind, setKind] = useState<TwoFactorCodeKind>(initialKind);
  const [totpCode, setTotpCode] = useState("");
  const [backupCode, setBackupCode] = useState("");
  const [trustDevice, setTrustDevice] = useState(false);
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

  const trustDeviceLabel = `Don't ask again on this device for ${trustDeviceDays} days`;

  return (
    <Page navigation={undefined}>
      <Box
        alignItems="center"
        alignSelf="center"
        flex="grow"
        justifyContent="center"
        maxWidth={400}
        padding={4}
        testID={testID}
        width="100%"
      >
        {Boolean(logo) && <Box marginBottom={6}>{logo}</Box>}

        <Box marginBottom={4}>
          <Heading align="center" testID={`${testID}-title`}>
            {title}
          </Heading>
        </Box>

        <Box gap={4} width="100%">
          <Text align="center" testID={`${testID}-description`}>
            {isTotp
              ? `Enter the ${codeLength}-digit code from your authenticator app.`
              : "Enter one of the backup codes you saved when you turned on two-factor authentication."}
          </Text>

          {isTotp ? (
            <Box alignItems="center" width="100%">
              <OtpField
                accessibilityLabel="Authentication code"
                autoFocus
                disabled={loading}
                key={otpResetKey}
                length={codeLength}
                onChange={setTotpCode}
                onComplete={handleOtpComplete}
                onEnter={handleOtpEnter}
                testID={`${testID}-otp`}
                value={totpCode}
              />
            </Box>
          ) : (
            // Backup codes are case-sensitive: the "search" type turns off auto-capitalize and
            // autocorrect on native, which the "text" type leaves on.
            <TextField
              accessibilityLabel="Backup code"
              autoComplete="off"
              disabled={loading}
              onChange={setBackupCode}
              onEnter={handleSubmitPress}
              placeholder="xxxxx-xxxxx"
              returnKeyType="go"
              testID={`${testID}-backup-input`}
              title="Backup code"
              type="search"
              value={backupCode}
            />
          )}

          {canTrustDevice && (
            <LabeledCheckBox
              checked={trustDevice}
              disabled={loading}
              label={trustDeviceLabel}
              onChange={setTrustDevice}
              testID={`${testID}-trust-device`}
            />
          )}

          {Boolean(error) && (
            <View role="alert" testID={`${testID}-error`}>
              <Text color="error">{error}</Text>
            </View>
          )}

          <Box marginTop={2}>
            <Button
              disabled={loading || !isCodeComplete}
              fullWidth
              loading={loading}
              onClick={handleSubmitPress}
              testID={`${testID}-submit`}
              text="Verify"
            />
          </Box>

          <Box alignItems="center" gap={2}>
            <Button
              disabled={loading}
              onClick={handleToggleKind}
              testID={`${testID}-backup-toggle`}
              text={isTotp ? "Use a backup code" : "Use your authenticator app"}
              variant="muted"
            />
            {Boolean(onCancel) && (
              <Button
                disabled={loading}
                onClick={onCancel!}
                testID={`${testID}-cancel`}
                text={cancelText}
                variant="muted"
              />
            )}
          </Box>
        </Box>
      </Box>
    </Page>
  );
};
