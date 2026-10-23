import * as Clipboard from "expo-clipboard";
import {type FC, type ReactElement, useCallback, useEffect, useRef, useState} from "react";
import {AccessibilityInfo, Platform, Share, type TextInput, View} from "react-native";
import QRCode from "react-native-qrcode-svg";

import {Box} from "../Box";
import {Button} from "../Button";
import {Card} from "../Card";
import {Heading} from "../Heading";
import {LabeledCheckBox} from "../LabeledCheckBox";
import {Modal} from "../Modal";
import {OtpField} from "../OtpField";
import {Text} from "../Text";
import {TextField} from "../TextField";
import {getRejectionMessage} from "./securityMethods";
import type {TwoFactorEnrollment, TwoFactorSettingsCardProps} from "./securityTypes";

const DEFAULT_DIGITS = 6;
/** Fewer unused backup codes than this shows a warning. */
const LOW_BACKUP_CODES = 3;
const QR_SIZE = 176;
const COPY_STATUS_MS = 2000;
const BACKUP_CODES_FILE_NAME = "two-factor-backup-codes.txt";
const BACKUP_CODES_FILE_HEADER =
  "Backup codes for two-factor authentication. Each code signs you in once.";
/**
 * How long a downloaded file's object URL lives. Some browsers start reading the blob after
 * `click()` returns, so revoking it at once can cancel the download.
 */
const OBJECT_URL_LIFETIME_MS = 30000;

/** Why the card is asking for the password. */
type PasswordPurpose = "enroll" | "regenerate" | "disable";

/** Which step of which flow the card is showing. */
type TwoFactorFlow =
  | {kind: "idle"; announcement?: string}
  | {kind: "password"; purpose: PasswordPurpose}
  | {kind: "scan"; enrollment: TwoFactorEnrollment}
  | {kind: "verify"; enrollment: TwoFactorEnrollment}
  | {kind: "codes"; codes: string[]; purpose: "enroll" | "regenerate"};

/** The callback in flight, for per-action spinners. */
type PendingAction = "enroll" | "regenerate" | "disable" | "verify";

/** What was copied, and whether the copy worked. */
interface CopyFeedback {
  target: "secret" | "codes";
  status: "copied" | "failed";
}

const IDLE: TwoFactorFlow = {kind: "idle"};

const PASSWORD_COPY: Record<PasswordPurpose, {prompt: string; submit: string}> = {
  disable: {
    prompt: "Enter your password to turn off two-factor authentication.",
    submit: "Turn off",
  },
  enroll: {
    prompt: "Enter your password to turn on two-factor authentication.",
    submit: "Continue",
  },
  regenerate: {
    prompt: "Enter your password to get new backup codes. Your current codes will stop working.",
    submit: "Get new codes",
  },
};

const SCAN_TEXT =
  "Scan this QR code with an authenticator app, such as Google Authenticator, Microsoft Authenticator, or 1Password.";

const getVerifyText = (codeLength: number): string =>
  `Enter the ${codeLength}-digit code your authenticator app shows.`;

const CODES_TITLE: Record<"enroll" | "regenerate", string> = {
  enroll: "Two-factor authentication is on. Save your backup codes.",
  regenerate: "Here are your new backup codes. Your old codes no longer work.",
};

/** Announced when Finish returns to the card. */
const FINISH_ANNOUNCEMENT: Record<"enroll" | "regenerate", string> = {
  enroll: "Two-factor authentication is on.",
  regenerate: "Your backup codes are updated.",
};

const COPY_STATUS_TEXT: Record<CopyFeedback["status"], string> = {
  copied: "Copied",
  failed: "Couldn't copy",
};

const REJECTION_FALLBACK: Record<PendingAction, string> = {
  disable: "Couldn't turn off two-factor authentication. Try again.",
  enroll: "Couldn't start two-factor setup. Try again.",
  regenerate: "Couldn't create new backup codes. Try again.",
  verify: "That code didn't work. Check your app and try again.",
};

/**
 * Reads a query parameter from an `otpauth://` URI, or undefined when it has none. Parsed by hand
 * because React Native's `URL` has no `searchParams` on every platform.
 */
const getOtpauthParam = (totpURI: string, name: string): string | undefined => {
  const match = new RegExp(`[?&]${name}=([^&#]+)`, "i").exec(totpURI);
  if (!match) {
    return undefined;
  }
  try {
    return decodeURIComponent(match[1]);
  } catch {
    return match[1];
  }
};

/** Reads the base32 `secret` parameter from an `otpauth://` URI, or undefined when it has none. */
export const parseTotpSecret = (totpURI: string): string | undefined => {
  return getOtpauthParam(totpURI, "secret");
};

/** Reads the `digits` parameter from an `otpauth://` URI, or undefined when missing or invalid. */
export const parseTotpDigits = (totpURI: string): number | undefined => {
  const value = getOtpauthParam(totpURI, "digits");
  if (!value || !/^\d+$/.test(value)) {
    return undefined;
  }
  const parsed = Number(value);
  return parsed >= 4 && parsed <= 10 ? parsed : undefined;
};

/** Splits a secret into groups of four ("JBSW Y3DP ...") so it is easier to type. */
const formatSecret = (secret: string): string => {
  return secret.match(/.{1,4}/g)?.join(" ") ?? secret;
};

/** The text written to the backup codes file or share sheet. */
const formatBackupCodesFile = (codes: string[]): string => {
  return `${BACKUP_CODES_FILE_HEADER}\n\n${codes.join("\n")}\n`;
};

/** Saves text as a file through a temporary download link. Web only. */
const downloadTextFile = ({fileName, text}: {fileName: string; text: string}): void => {
  const url = URL.createObjectURL(new Blob([text], {type: "text/plain;charset=utf-8"}));
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = fileName;
  anchor.style.display = "none";
  document.body.appendChild(anchor);
  anchor.click();
  anchor.remove();
  setTimeout(() => URL.revokeObjectURL(url), OBJECT_URL_LIFETIME_MS);
};

/**
 * Turns two-factor authentication (an authenticator app, TOTP) on and off and manages backup
 * codes. Turning on walks through four steps: confirm the password, scan a QR code (or type the
 * secret shown under it), enter a code from the app, then save the backup codes, with Finish
 * gated on "I saved these backup codes". Once on, the card offers new backup codes (password,
 * then the new codes with the same gate) and Turn off (password, then a destructive confirm).
 * Presentational: it reports each step through callbacks and never calls an auth client.
 *
 * @example
 * ```tsx
 * // The Better Auth client resolves {data, error} rather than throwing; throw so the card
 * // shows the error.
 * <TwoFactorSettingsCard
 *   enabled={Boolean(session.data?.user.twoFactorEnabled)}
 *   hasPassword={hasPasswordCredential(accounts)}
 *   onStartEnroll={async (password) => {
 *     const {data, error} = await authClient.twoFactor.enable({password: password ?? ""});
 *     // enable() resolves {method: "otp"} for the email/SMS OTP method; only TOTP has a URI.
 *     if (error || !data || !("totpURI" in data)) {
 *       throw new Error(error?.message ?? "Couldn't start two-factor setup.");
 *     }
 *     return {backupCodes: data.backupCodes, totpURI: data.totpURI};
 *   }}
 *   onVerify={async (code) => {
 *     const {error} = await authClient.twoFactor.verifyTotp({code});
 *     if (error) {
 *       throw new Error(error.message ?? "That code didn't work.");
 *     }
 *   }}
 *   onRegenerateBackupCodes={async (password) => {
 *     const {data, error} = await authClient.twoFactor.generateBackupCodes({
 *       password: password ?? "",
 *     });
 *     if (error || !data) {
 *       throw new Error(error?.message ?? "Couldn't create new backup codes.");
 *     }
 *     return data.backupCodes;
 *   }}
 *   onDisable={async (password) => {
 *     const {error} = await authClient.twoFactor.disable({password: password ?? ""});
 *     if (error) {
 *       throw new Error(error.message ?? "Couldn't turn off two-factor authentication.");
 *     }
 *   }}
 * />
 * ```
 */
export const TwoFactorSettingsCard: FC<TwoFactorSettingsCardProps> = ({
  enabled,
  backupCodesRemaining,
  onStartEnroll,
  onVerify,
  onRegenerateBackupCodes,
  onDisable,
  requirePassword = true,
  hasPassword = true,
  digits,
  error,
  disabled = false,
  title = "Two-factor authentication",
  description = "Sign in with a code from an authenticator app as well as your password.",
  testID = "two-factor-settings-card",
}) => {
  const [flow, setFlow] = useState<TwoFactorFlow>(IDLE);
  const [password, setPassword] = useState("");
  const [passwordError, setPasswordError] = useState<string | undefined>(undefined);
  const [code, setCode] = useState("");
  const [hasSavedCodes, setHasSavedCodes] = useState(false);
  const [isConfirmingDisable, setIsConfirmingDisable] = useState(false);
  const [pendingAction, setPendingAction] = useState<PendingAction | undefined>(undefined);
  const [actionError, setActionError] = useState<string | undefined>(undefined);
  const [copyFeedback, setCopyFeedback] = useState<CopyFeedback | undefined>(undefined);
  const passwordInputRef = useRef<TextInput | null>(null);
  const stepHeadingRef = useRef<View | null>(null);
  const isFirstRenderRef = useRef(true);

  const isBusy = disabled || pendingAction !== undefined;
  const shownError = error ?? actionError;
  const cannotConfirmPassword = requirePassword && !hasPassword;
  const enrollStepOffset = requirePassword ? 1 : 0;
  const enrollStepCount = 3 + enrollStepOffset;
  const enrollmentDigits =
    flow.kind === "scan" || flow.kind === "verify"
      ? parseTotpDigits(flow.enrollment.totpURI)
      : undefined;
  const codeLength = digits ?? enrollmentDigits ?? DEFAULT_DIGITS;

  /** What a screen reader hears when the flow moves to its current step. */
  const getStepAnnouncement = (): string | undefined => {
    switch (flow.kind) {
      case "password": {
        const prompt = PASSWORD_COPY[flow.purpose].prompt;
        return flow.purpose === "enroll" ? `Step 1 of ${enrollStepCount}. ${prompt}` : prompt;
      }
      case "scan":
        return `Step ${1 + enrollStepOffset} of ${enrollStepCount}. ${SCAN_TEXT}`;
      case "verify":
        return `Step ${2 + enrollStepOffset} of ${enrollStepCount}. ${getVerifyText(codeLength)}`;
      case "codes":
        return CODES_TITLE[flow.purpose];
      default:
        return flow.announcement;
    }
  };
  const stepAnnouncement = getStepAnnouncement();

  // Each step replaces the content that had focus, so move focus to the new step: on web to the
  // step's heading (or the field on the password and code steps), and on native announce the step,
  // since a native View can't take focus.
  // biome-ignore lint/correctness/useExhaustiveDependencies: runs once per step change.
  useEffect(() => {
    if (isFirstRenderRef.current) {
      isFirstRenderRef.current = false;
      return;
    }
    if (flow.kind === "password") {
      passwordInputRef.current?.focus();
    }
    if (Platform.OS === "web") {
      // The password and code steps focus their field instead, so the user can type at once.
      if (flow.kind !== "password" && flow.kind !== "verify") {
        (stepHeadingRef.current as unknown as HTMLElement | null)?.focus?.({preventScroll: true});
      }
      return;
    }
    if (stepAnnouncement) {
      AccessibilityInfo.announceForAccessibility(stepAnnouncement);
    }
  }, [flow]);

  // Clears the copy status 2 s after each copy; a new copy or unmounting cancels the pending clear.
  useEffect(() => {
    if (copyFeedback === undefined) {
      return;
    }
    const timer = setTimeout(() => setCopyFeedback(undefined), COPY_STATUS_MS);
    return (): void => clearTimeout(timer);
  }, [copyFeedback]);

  const goTo = useCallback((next: TwoFactorFlow): void => {
    setFlow(next);
    setActionError(undefined);
    setCopyFeedback(undefined);
  }, []);

  /** Returns to the card, announcing what just happened when there is something to say. */
  const reset = useCallback(
    (announcement?: string): void => {
      goTo(announcement ? {announcement, kind: "idle"} : IDLE);
      setPassword("");
      setPasswordError(undefined);
      setCode("");
      setHasSavedCodes(false);
      setIsConfirmingDisable(false);
    },
    [goTo]
  );

  /** Runs a callback with a spinner; resolves its value, or undefined after showing the error. */
  const runAction = useCallback(
    async <T,>({
      action,
      run,
    }: {
      action: PendingAction;
      run: () => Promise<T>;
    }): Promise<{value: T} | undefined> => {
      setActionError(undefined);
      setPendingAction(action);
      try {
        return {value: await run()};
      } catch (rejection: unknown) {
        console.warn(`TwoFactorSettingsCard: ${action} rejected`, rejection);
        setActionError(
          getRejectionMessage({error: rejection, fallback: REJECTION_FALLBACK[action]})
        );
        return undefined;
      } finally {
        setPendingAction(undefined);
      }
    },
    []
  );

  const startEnroll = useCallback(
    async (confirmedPassword?: string): Promise<void> => {
      const result = await runAction({
        action: "enroll",
        run: () => onStartEnroll(confirmedPassword),
      });
      if (!result) {
        return;
      }
      // The password has done its job; don't keep it in memory through the rest of the flow.
      setPassword("");
      setCode("");
      goTo({enrollment: result.value, kind: "scan"});
    },
    [goTo, onStartEnroll, runAction]
  );

  const regenerate = useCallback(
    async (confirmedPassword?: string): Promise<void> => {
      if (!onRegenerateBackupCodes) {
        return;
      }
      const result = await runAction({
        action: "regenerate",
        run: () => onRegenerateBackupCodes(confirmedPassword),
      });
      if (!result) {
        return;
      }
      setPassword("");
      setHasSavedCodes(false);
      goTo({codes: result.value, kind: "codes", purpose: "regenerate"});
    },
    [goTo, onRegenerateBackupCodes, runAction]
  );

  const handleEnable = useCallback(async (): Promise<void> => {
    if (requirePassword) {
      goTo({kind: "password", purpose: "enroll"});
      return;
    }
    await startEnroll(undefined);
  }, [goTo, requirePassword, startEnroll]);

  const handleRegenerate = useCallback(async (): Promise<void> => {
    if (requirePassword) {
      goTo({kind: "password", purpose: "regenerate"});
      return;
    }
    await regenerate(undefined);
  }, [goTo, regenerate, requirePassword]);

  const handleDisable = useCallback((): void => {
    if (requirePassword) {
      goTo({kind: "password", purpose: "disable"});
      return;
    }
    setActionError(undefined);
    setIsConfirmingDisable(true);
  }, [goTo, requirePassword]);

  const handlePasswordChange = useCallback((value: string): void => {
    setPassword(value);
    setPasswordError(undefined);
  }, []);

  const handlePasswordSubmit = useCallback(async (): Promise<void> => {
    if (flow.kind !== "password" || isBusy) {
      return;
    }
    if (!password) {
      setPasswordError("Enter your password.");
      passwordInputRef.current?.focus();
      return;
    }
    if (flow.purpose === "enroll") {
      await startEnroll(password);
    } else if (flow.purpose === "regenerate") {
      await regenerate(password);
    } else {
      setActionError(undefined);
      setIsConfirmingDisable(true);
    }
  }, [flow, isBusy, password, regenerate, startEnroll]);

  const handleConfirmDisable = useCallback(async (): Promise<void> => {
    setIsConfirmingDisable(false);
    if (!onDisable) {
      return;
    }
    const confirmedPassword = requirePassword ? password : undefined;
    const result = await runAction({action: "disable", run: () => onDisable(confirmedPassword)});
    if (result) {
      reset("Two-factor authentication is off.");
    }
  }, [onDisable, password, requirePassword, reset, runAction]);

  const handleDismissDisable = useCallback((): void => {
    setIsConfirmingDisable(false);
  }, []);

  const verify = useCallback(
    async (submitted: string): Promise<void> => {
      if (
        flow.kind !== "verify" ||
        pendingAction !== undefined ||
        submitted.length !== codeLength
      ) {
        return;
      }
      const {enrollment} = flow;
      const result = await runAction({action: "verify", run: () => onVerify(submitted)});
      if (!result) {
        setCode("");
        return;
      }
      setHasSavedCodes(false);
      goTo({codes: enrollment.backupCodes, kind: "codes", purpose: "enroll"});
    },
    [codeLength, flow, goTo, onVerify, pendingAction, runAction]
  );

  const handleVerifyPress = useCallback(async (): Promise<void> => {
    await verify(code);
  }, [code, verify]);

  const copyText = useCallback(
    async (target: CopyFeedback["target"], text: string): Promise<void> => {
      let status: CopyFeedback["status"] = "copied";
      try {
        await Clipboard.setStringAsync(text);
      } catch (rejection: unknown) {
        console.warn("TwoFactorSettingsCard: copy failed", rejection);
        status = "failed";
      }
      setCopyFeedback({status, target});
      // VoiceOver ignores live regions, so iOS announces the result itself.
      if (Platform.OS === "ios") {
        AccessibilityInfo.announceForAccessibility(COPY_STATUS_TEXT[status]);
      }
    },
    []
  );

  const handleSaveCodes = useCallback(async (codes: string[]): Promise<void> => {
    const text = formatBackupCodesFile(codes);
    if (Platform.OS === "web") {
      downloadTextFile({fileName: BACKUP_CODES_FILE_NAME, text});
      return;
    }
    try {
      await Share.share({message: text, title: "Backup codes"});
    } catch (rejection: unknown) {
      console.warn("TwoFactorSettingsCard: share failed", rejection);
    }
  }, []);

  const renderCopyStatus = (target: CopyFeedback["target"]): ReactElement => {
    const feedback = copyFeedback?.target === target ? copyFeedback : undefined;
    return (
      <View
        accessibilityLiveRegion="polite"
        aria-live="polite"
        role="status"
        testID={`${testID}-copy-${target}-status`}
      >
        {feedback ? (
          <Text color={feedback.status === "failed" ? "error" : "secondaryLight"} size="sm">
            {COPY_STATUS_TEXT[feedback.status]}
          </Text>
        ) : null}
      </View>
    );
  };

  /**
   * The step's step counter and lead text, as the element focus moves to on web when the step
   * opens. Only one step renders at a time, so they share one ref.
   */
  const renderStepHeading = ({
    step,
    children,
  }: {
    step?: number;
    children: ReactElement;
  }): ReactElement => (
    <View ref={stepHeadingRef} style={{gap: 4}} tabIndex={-1} testID={`${testID}-step-heading`}>
      {step !== undefined && (
        <Text color="secondaryLight" size="sm" testID={`${testID}-step`}>
          {`Step ${step} of ${enrollStepCount}`}
        </Text>
      )}
      {children}
    </View>
  );

  const renderCancel = (): ReactElement => (
    <Button
      disabled={pendingAction !== undefined}
      onClick={() => reset()}
      testID={`${testID}-cancel`}
      text="Cancel"
      variant="muted"
    />
  );

  const renderIdle = (): ReactElement => {
    const isLow = backupCodesRemaining !== undefined && backupCodesRemaining < LOW_BACKUP_CODES;
    return (
      <Box gap={3}>
        {renderStepHeading({
          children: (
            <Text>
              {"Status: "}
              <Text bold color={enabled ? "success" : "secondaryLight"} testID={`${testID}-status`}>
                {enabled ? "On" : "Off"}
              </Text>
            </Text>
          ),
        })}

        {enabled && backupCodesRemaining !== undefined && (
          <Box gap={1}>
            <Text testID={`${testID}-backup-codes-remaining`}>
              {`${backupCodesRemaining} backup ${backupCodesRemaining === 1 ? "code" : "codes"} left`}
            </Text>
            {isLow && (
              <Text color="warning" testID={`${testID}-backup-codes-low`}>
                You're running low on backup codes. Get new ones so you don't get locked out.
              </Text>
            )}
          </Box>
        )}

        {cannotConfirmPassword && (
          <Text color="secondaryLight" testID={`${testID}-needs-password`}>
            {enabled
              ? "Set a password first. You'll confirm it to get new backup codes or turn off two-factor authentication."
              : "Set a password first. You'll confirm it to turn on two-factor authentication."}
          </Text>
        )}

        <Box direction="row" gap={2} wrap>
          {!enabled && (
            <Button
              disabled={isBusy || cannotConfirmPassword}
              iconName="shield-halved"
              loading={pendingAction === "enroll"}
              onClick={handleEnable}
              testID={`${testID}-enable`}
              text="Turn on"
            />
          )}
          {enabled && Boolean(onRegenerateBackupCodes) && (
            <Button
              disabled={isBusy || cannotConfirmPassword}
              loading={pendingAction === "regenerate"}
              onClick={handleRegenerate}
              testID={`${testID}-regenerate`}
              text="Get new backup codes"
              variant="secondary"
            />
          )}
          {enabled && Boolean(onDisable) && (
            <Button
              disabled={isBusy || cannotConfirmPassword}
              loading={pendingAction === "disable"}
              onClick={handleDisable}
              testID={`${testID}-disable`}
              text="Turn off"
              variant="outline"
            />
          )}
        </Box>
      </Box>
    );
  };

  const renderPassword = (purpose: PasswordPurpose): ReactElement => {
    const copy = PASSWORD_COPY[purpose];
    return (
      <Box gap={3}>
        {renderStepHeading({
          children: <Text testID={`${testID}-password-prompt`}>{copy.prompt}</Text>,
          step: purpose === "enroll" ? 1 : undefined,
        })}
        <TextField
          accessibilityLabel="Password"
          autoComplete="current-password"
          disabled={isBusy}
          errorText={passwordError}
          inputRef={(ref) => {
            passwordInputRef.current = ref;
          }}
          onChange={handlePasswordChange}
          onEnter={handlePasswordSubmit}
          testID={`${testID}-password`}
          title="Password"
          type="password"
          value={password}
        />
        <Box direction="row" gap={2} wrap>
          <Button
            disabled={isBusy}
            loading={pendingAction === purpose}
            onClick={handlePasswordSubmit}
            testID={`${testID}-password-submit`}
            text={copy.submit}
            variant={purpose === "disable" ? "destructive" : "primary"}
          />
          {renderCancel()}
        </Box>
      </Box>
    );
  };

  const renderScan = (enrollment: TwoFactorEnrollment): ReactElement => {
    const secret = parseTotpSecret(enrollment.totpURI);
    return (
      <Box gap={3}>
        {renderStepHeading({children: <Text>{SCAN_TEXT}</Text>, step: 1 + enrollStepOffset})}
        <Box alignItems="center">
          <View
            accessibilityLabel="QR code for your authenticator app"
            aria-label="QR code for your authenticator app"
            role="img"
            style={{backgroundColor: "#FFFFFF", borderRadius: 8, padding: 12}}
            testID={`${testID}-qr`}
          >
            <QRCode
              backgroundColor="#FFFFFF"
              color="#000000"
              size={QR_SIZE}
              value={enrollment.totpURI}
            />
          </View>
        </Box>
        {Boolean(secret) && (
          <Box gap={2}>
            <Text color="secondaryLight">Can't scan it? Enter this setup key in the app:</Text>
            <Text bold testID={`${testID}-secret`}>
              {formatSecret(secret!)}
            </Text>
            <Box alignItems="center" direction="row" gap={2}>
              <Button
                accessibilityLabel="Copy setup key"
                iconName="copy"
                onClick={() => copyText("secret", secret!)}
                size="sm"
                testID={`${testID}-copy-secret`}
                text="Copy key"
                variant="muted"
              />
              {renderCopyStatus("secret")}
            </Box>
          </Box>
        )}
        <Box direction="row" gap={2} wrap>
          <Button
            onClick={() => goTo({enrollment, kind: "verify"})}
            testID={`${testID}-next`}
            text="Next"
          />
          {renderCancel()}
        </Box>
      </Box>
    );
  };

  const renderVerify = (enrollment: TwoFactorEnrollment): ReactElement => (
    <Box gap={3}>
      {renderStepHeading({
        children: <Text>{getVerifyText(codeLength)}</Text>,
        step: 2 + enrollStepOffset,
      })}
      <OtpField
        accessibilityLabel="Authentication code"
        autoFocus
        disabled={pendingAction === "verify"}
        length={codeLength}
        onChange={setCode}
        onComplete={verify}
        testID={`${testID}-otp`}
        title="Code"
        value={code}
      />
      <Box direction="row" gap={2} wrap>
        <Button
          disabled={code.length !== codeLength || pendingAction !== undefined}
          loading={pendingAction === "verify"}
          onClick={handleVerifyPress}
          testID={`${testID}-verify`}
          text="Verify"
        />
        <Button
          disabled={pendingAction !== undefined}
          onClick={() => goTo({enrollment, kind: "scan"})}
          testID={`${testID}-back`}
          text="Back"
          variant="secondary"
        />
        {renderCancel()}
      </Box>
    </Box>
  );

  const renderCodes = (codes: string[], purpose: "enroll" | "regenerate"): ReactElement => (
    <Box gap={3}>
      {renderStepHeading({
        children: (
          <Text bold testID={`${testID}-codes-title`}>
            {CODES_TITLE[purpose]}
          </Text>
        ),
        step: purpose === "enroll" ? 3 + enrollStepOffset : undefined,
      })}
      <Text color="secondaryLight">
        Each code signs you in once if you lose your authenticator app. Keep them somewhere safe,
        like a password manager.
      </Text>
      <View
        aria-label="Backup codes"
        role="list"
        style={{columnGap: 16, flexDirection: "row", flexWrap: "wrap", rowGap: 8}}
        testID={`${testID}-backup-codes`}
      >
        {codes.map((backupCode, index) => (
          <View key={backupCode} role="listitem" style={{minWidth: 120}}>
            <Text testID={`${testID}-backup-code-${index + 1}`}>{backupCode}</Text>
          </View>
        ))}
      </View>
      <Box alignItems="center" direction="row" gap={2} wrap>
        <Button
          accessibilityLabel="Copy backup codes"
          iconName="copy"
          onClick={() => copyText("codes", codes.join("\n"))}
          size="sm"
          testID={`${testID}-copy-codes`}
          text="Copy"
          variant="muted"
        />
        <Button
          accessibilityLabel={
            Platform.OS === "web" ? "Download backup codes" : "Share backup codes"
          }
          iconName={Platform.OS === "web" ? "download" : "share"}
          onClick={() => handleSaveCodes(codes)}
          size="sm"
          testID={`${testID}-download-codes`}
          text={Platform.OS === "web" ? "Download" : "Share"}
          variant="muted"
        />
        {renderCopyStatus("codes")}
      </Box>
      <LabeledCheckBox
        checked={hasSavedCodes}
        label="I saved these backup codes"
        onChange={setHasSavedCodes}
        testID={`${testID}-saved`}
      />
      <Box alignItems="start">
        <Button
          disabled={!hasSavedCodes}
          onClick={() => reset(FINISH_ANNOUNCEMENT[purpose])}
          testID={`${testID}-finish`}
          text="Finish"
        />
      </Box>
    </Box>
  );

  const renderFlow = (): ReactElement => {
    switch (flow.kind) {
      case "password":
        return renderPassword(flow.purpose);
      case "scan":
        return renderScan(flow.enrollment);
      case "verify":
        return renderVerify(flow.enrollment);
      case "codes":
        return renderCodes(flow.codes, flow.purpose);
      default:
        return renderIdle();
    }
  };

  return (
    <Card testID={testID}>
      <Box gap={4}>
        <Box gap={1}>
          <Heading level={2} size="md" testID={`${testID}-title`}>
            {title}
          </Heading>
          <Text color="secondaryLight">{description}</Text>
        </Box>

        {renderFlow()}

        {Boolean(shownError) && (
          <View role="alert" testID={`${testID}-error`}>
            <Text color="error">{shownError}</Text>
          </View>
        )}
      </Box>

      {isConfirmingDisable && (
        <Modal
          onDismiss={handleDismissDisable}
          primaryButtonOnClick={handleConfirmDisable}
          primaryButtonText="Turn off"
          secondaryButtonOnClick={handleDismissDisable}
          secondaryButtonText="Cancel"
          testIDs={{
            dismiss: `${testID}-confirm-dismiss`,
            primaryButton: `${testID}-confirm-submit`,
            root: `${testID}-confirm`,
            secondaryButton: `${testID}-confirm-cancel`,
            title: `${testID}-confirm-title`,
          }}
          text="You'll sign in with just your password, and your backup codes will stop working. Your account will be easier to break into."
          title="Turn off two-factor authentication?"
          visible
        />
      )}
    </Card>
  );
};
