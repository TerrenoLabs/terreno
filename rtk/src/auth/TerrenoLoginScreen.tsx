/**
 * A drop-in login screen connected to a Better Auth client: `@terreno/ui`'s `LoginScreen` driven
 * by `useLoginController`, with the two-factor challenge inline unless the app routes to its own.
 */
import type {LoginFieldConfig, LoginScreenProps} from "@terreno/ui";
import {Box, LoginScreen, Spinner, TwoFactorChallengeScreen} from "@terreno/ui";
import {type FC, type ReactNode, useEffect, useRef} from "react";

import {
  type LoginControllerStep,
  type UseLoginControllerOptions,
  useLoginController,
} from "./useLoginController";

/** The email and password fields the screen shows unless `fields` is passed. */
export const DEFAULT_LOGIN_FIELDS: LoginFieldConfig[] = [
  {autoComplete: "username", label: "Email", name: "email", required: true, type: "email"},
  {label: "Password", name: "password", required: true, type: "password"},
];

export interface TerrenoLoginScreenProps extends UseLoginControllerOptions {
  /**
   * Form fields; their values reach `signIn.email` as `email` and `password`. Left out when the
   * server has email and password sign-in off.
   */
  fields?: LoginFieldConfig[];
  /** Heading of the login form. */
  title?: string;
  /** Logo shown above the login form and the two-factor challenge. */
  logo?: ReactNode;
  signUpLinkText?: LoginScreenProps["signUpLinkText"];
  forgotPasswordText?: LoginScreenProps["forgotPasswordText"];
  passkeyButtonText?: LoginScreenProps["passkeyButtonText"];
  lastUsedLabel?: LoginScreenProps["lastUsedLabel"];
  /**
   * Shows "Don't ask again on this device for N days" on the inline two-factor challenge. Match
   * the server's `twoFactor.trustDeviceDays`; leave unset to hide it.
   */
  trustDeviceDays?: number;
  /**
   * Called with each step the screen moves to (`checking`, `login`, `twoFactor`, `signedIn`).
   * An app that already holds a session can use `login` to leave the route, for example when
   * the live-session check failed.
   */
  onStepChange?: (step: LoginControllerStep) => void;
  /**
   * Root testID of the login screen. The checking spinner is `${testID}-checking`; the inline
   * challenge keeps `TwoFactorChallengeScreen`'s own `two-factor-challenge`.
   * @default "login-screen"
   */
  testID?: string;
}

/**
 * Renders the right step: a spinner while a live session is checked (a valid one calls
 * `onSignedIn` and never shows the form), the login screen, or the inline two-factor challenge.
 * See "Drop-in login screen" in docs/how-to/configure-better-auth.md.
 *
 * @example
 * ```tsx
 * <TerrenoLoginScreen
 *   client={authClient}
 *   error={useLocalSearchParams<{error?: string}>().error}
 *   onSignUpPress={() => router.push("/signup")}
 *   onSignedIn={async () => {
 *     await betterAuth.syncSession(store.dispatch);
 *     router.replace("/");
 *   }}
 *   rememberedAccounts={rememberedAccounts}
 * />
 * ```
 */
export const TerrenoLoginScreen: FC<TerrenoLoginScreenProps> = ({
  fields = DEFAULT_LOGIN_FIELDS,
  title,
  logo,
  signUpLinkText,
  forgotPasswordText,
  passkeyButtonText,
  lastUsedLabel,
  trustDeviceDays,
  onStepChange,
  testID = "login-screen",
  ...options
}) => {
  const controller = useLoginController(options);

  // Reports each new step; the latest callback is read so a new function does not re-report.
  const onStepChangeRef = useRef(onStepChange);
  onStepChangeRef.current = onStepChange;
  useEffect(() => {
    onStepChangeRef.current?.(controller.step);
  }, [controller.step]);

  if (controller.step === "checking" || controller.step === "signedIn") {
    return (
      <Box alignItems="center" flex="grow" justifyContent="center" testID={`${testID}-checking`}>
        <Spinner />
      </Box>
    );
  }

  if (controller.step === "twoFactor") {
    return (
      <TwoFactorChallengeScreen
        error={controller.twoFactor.error}
        loading={controller.twoFactor.loading}
        logo={logo}
        onCancel={controller.twoFactor.onCancel}
        onSubmit={controller.twoFactor.onSubmit}
        trustDeviceDays={trustDeviceDays}
      />
    );
  }

  return (
    <LoginScreen
      fields={controller.isEmailPasswordEnabled ? fields : []}
      forgotPasswordText={forgotPasswordText}
      lastUsedLabel={lastUsedLabel}
      logo={logo}
      passkeyButtonText={passkeyButtonText}
      signUpLinkText={signUpLinkText}
      testID={testID}
      title={title}
      {...controller.screenProps}
    />
  );
};
