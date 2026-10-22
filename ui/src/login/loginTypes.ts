import type {ReactNode} from "react";

import type {GenericOAuthProviderConfig, OAuthProviderConfig} from "../signUp/signUpTypes";

/**
 * Configuration for a login form field.
 */
export interface LoginFieldConfig {
  /** Unique field name used as the key in form state. */
  name: string;
  /** Display label for the field. */
  label: string;
  /** Placeholder text shown when the field is empty. */
  placeholder?: string;
  /** Input type for the field. */
  type?: "text" | "email" | "password";
  /** Whether the field is required. */
  required?: boolean;
  /** Auto-complete hint for the field. */
  autoComplete?: "current-password" | "email" | "new-password" | "on" | "off" | "username";
}

/**
 * An account the login screen can offer as a one-tap "Continue" card: a session already signed
 * in on this device, or an account remembered from an earlier sign-in. Identity fields are
 * optional because apps remember only the method by default.
 */
export interface LoginAccountOption {
  /** Stable id: the session token or user id for a session, the remembered entry id otherwise. */
  id: string;
  /** Display name, when known. */
  name?: string;
  /** Email address, when known. */
  email?: string;
  /** Avatar image URL, when known. */
  image?: string;
  /** How the account signs in: a provider id, `"email"`, or `"passkey"`. */
  method: string;
}

/** Where a "Continue" card came from: a signed-in device session or a remembered account. */
export type LoginAccountSource = "session" | "remembered";

/**
 * A message shown above the login form, such as guidance after an `account_not_linked` error.
 */
export interface LoginNotice {
  /** Visual tone of the notice. */
  tone: "info" | "warning";
  /** Message text. */
  text: string;
  /** Label for an optional action button. Renders only with `onAction`. */
  actionLabel?: string;
  /** Callback for the action button. */
  onAction?: () => void | Promise<void>;
}

/**
 * Props for the LoginScreen component.
 */
export interface LoginScreenProps {
  /** Form field configurations. */
  fields: LoginFieldConfig[];
  /** Callback triggered on form submission. Receives field values as a record. */
  onSubmit: (values: Record<string, string>) => Promise<void>;
  /** Optional OAuth provider configurations for social login buttons. */
  oauthProviders?: OAuthProviderConfig[];
  /** Custom logo or banner to display above the form. */
  logo?: ReactNode;
  /** Title text for the login form. */
  title?: string;
  /** Whether the form is in a loading state. */
  loading?: boolean;
  /** Error message to display. */
  error?: string;
  /** Text for the link to navigate to sign up. */
  signUpLinkText?: string;
  /** Callback triggered when the sign-up link is pressed. */
  onSignUpPress?: () => void;
  /** Text for the forgot password link. */
  forgotPasswordText?: string;
  /** Callback triggered when the forgot password link is pressed. */
  onForgotPasswordPress?: () => void;
  /** Alias for `onForgotPasswordPress`. */
  onForgotPassword?: () => void;
  /**
   * Sign-in providers without a branded button (for example a generic OIDC provider). They
   * render after `oauthProviders` with the testID `${testID}-oauth-${id}`.
   */
  genericProviders?: GenericOAuthProviderConfig[];
  /**
   * The method this device signed in with last: a provider id (`"google"`, `"github"`,
   * `"mock-oidc"`, ...), `"email"`, or `"passkey"`. That method gets a "Last used" badge
   * (testID `${testID}-last-used-${method}`). A provider or passkey moves above the form, and a
   * provider moves to the front of the provider list. A method the screen does not offer is
   * ignored.
   */
  lastUsedMethod?: string;
  /** Text of the last-used badge. Defaults to "Last used". */
  lastUsedLabel?: string;
  /**
   * Sessions already signed in on this device. Each renders a "Continue" card that switches to
   * it in one tap. Requires `onContinue`.
   */
  currentSessions?: LoginAccountOption[];
  /**
   * Accounts remembered on this device. Each renders a "Continue" card that re-authenticates
   * with the remembered method, plus a forget button when `onForget` is set. Requires
   * `onContinue`.
   */
  rememberedAccounts?: LoginAccountOption[];
  /**
   * Called when a "Continue" card is pressed. Cards are numbered sessions first, then remembered
   * accounts (testID `${testID}-continue-${index}`).
   */
  onContinue?: (account: LoginAccountOption, source: LoginAccountSource) => void | Promise<void>;
  /**
   * Called when a remembered account's forget button is pressed
   * (testID `${testID}-forget-${index}`). Sessions are never forgettable here.
   */
  onForget?: (account: LoginAccountOption) => void | Promise<void>;
  /**
   * Shows a "Sign in with a passkey" button (testID `${testID}-passkey-button`) that calls this.
   */
  onPasskeyPress?: () => void | Promise<void>;
  /** Text of the passkey button. Defaults to "Sign in with a passkey". */
  passkeyButtonText?: string;
  /**
   * On web, sets the email field's `autocomplete` to `"username webauthn"` so the browser offers
   * saved passkeys in the field's autofill (conditional mediation). Ignored on native.
   */
  passkeyAutofill?: boolean;
  /** A message shown above the form (testID `${testID}-notice`). */
  notice?: LoginNotice;
  /** Test ID for the root element. */
  testID?: string;
}

/** Which kind of second factor a two-factor challenge submits. */
export type TwoFactorCodeKind = "totp" | "backup";

/** What {@link TwoFactorChallengeScreenProps.onSubmit} receives. */
export interface TwoFactorChallengeSubmission {
  /** The code as entered: six digits for `totp`, a trimmed backup code for `backup`. */
  code: string;
  /** `totp` for an authenticator app code, `backup` for a one-time backup code. */
  kind: TwoFactorCodeKind;
  /** True when the user checked "Don't ask again on this device". Always false without `trustDeviceDays`. */
  trustDevice: boolean;
}

/**
 * Props for the TwoFactorChallengeScreen component.
 */
export interface TwoFactorChallengeScreenProps {
  /** Called with the code, its kind, and the trust-device choice. A TOTP code submits itself once complete. */
  onSubmit: (values: TwoFactorChallengeSubmission) => void | Promise<void>;
  /** Disables the form and shows a spinner on the submit button. */
  loading?: boolean;
  /** Error text, such as an invalid code, shown with `role="alert"`. A new error clears the entered code. */
  error?: string;
  /**
   * Shows a "Don't ask again on this device for N days" checkbox. Leave unset to hide it. Better
   * Auth trusts a device for 30 days by default.
   */
  trustDeviceDays?: number;
  /** Shows a "Use another method" link (text via `cancelText`), for example back to sign-in. */
  onCancel?: () => void;
  /**
   * Text for the cancel link.
   * @default "Use another method"
   */
  cancelText?: string;
  /**
   * Heading text.
   * @default "Two-factor authentication"
   */
  title?: string;
  /** Optional logo above the heading. */
  logo?: ReactNode;
  /**
   * Digits in an authenticator code.
   * @default 6
   */
  codeLength?: number;
  /**
   * The mode the screen opens in.
   * @default "totp"
   */
  initialKind?: TwoFactorCodeKind;
  /**
   * Root testID; child testIDs are derived from it.
   * @default "two-factor-challenge"
   */
  testID?: string;
}
