import type {ReactNode} from "react";

import type {IconName} from "../Common";

/**
 * A sign-in account linked to the user, built from a Better Auth `listAccounts` entry. A password
 * is an account too, with `providerId` `"credential"`. Better Auth returns no email per account,
 * so `email` comes from elsewhere (the session user, or a per-account info call) when shown.
 */
export interface LinkedAccount {
  /**
   * Better Auth's own account row id (`listAccounts()[i].id`). This is what `unlinkAccount`
   * takes as `accountId`; it also keys the card's rows.
   */
  id: string;
  /** Provider id: `"google"`, `"github"`, `"apple"`, a generic provider id, or `"credential"`. */
  providerId: string;
  /** The account's id at the provider (Better Auth's `accountId`). Display only. */
  accountId?: string;
  /** Email address on the provider account, when known. */
  email?: string;
  /**
   * When the account was linked: Better Auth's `createdAt`, as a `Date` (the Better Auth client
   * parses dates) or an ISO 8601 string.
   */
  linkedAt?: string | Date;
}

/** A provider the app lets users link: a branded provider or a generic OAuth/OIDC provider. */
export interface LinkableProvider {
  /** Provider id, matching `LinkedAccount.providerId` and the id passed to `linkSocial`. */
  id: string;
  /** Display name. Defaults to the branded name ("Google", "GitHub", "Apple") or the id. */
  label?: string;
  /** FontAwesome icon. Branded providers default to their brand icon; others to a key. */
  iconName?: IconName;
}

/**
 * Props for the LinkedAccountsCard component.
 */
export interface LinkedAccountsCardProps {
  /**
   * Every account linked to the user, including the `"credential"` password account. The
   * password is not listed as a row (PasswordCard covers it) but counts as a sign-in method.
   */
  accounts: LinkedAccount[];
  /**
   * Providers the app offers. Each renders a row, linked or not. A linked account whose
   * provider is not in this list still renders as a linked row after them.
   */
  providers: LinkableProvider[];
  /**
   * Called when Link is pressed. The row shows a spinner until the returned promise settles. A
   * rejection shows its message as the card error.
   */
  onLink?: (providerId: string) => void | Promise<void>;
  /**
   * Called after the user confirms Unlink, with the row's account. Pass `account.id` to Better
   * Auth's `unlinkAccount({accountId})`, and throw when it resolves an `error` (the client
   * resolves `{data, error}` instead of rejecting). The row shows a spinner until the returned promise
   * settles. A rejection shows its message as the card error.
   */
  onUnlink?: (providerId: string, account: LinkedAccount) => void | Promise<void>;
  /**
   * Sign-in methods that are not accounts, such as passkeys. They count toward the last-method
   * rule, so a user with a passkey can unlink their only provider. Better Auth itself refuses to
   * unlink a user's last account unless `account.accountLinking.allowUnlinkingAll` is set, so
   * pass 0 unless the server allows unlinking every account.
   * @default 0
   */
  otherMethodCount?: number;
  /**
   * Allows unlinking the only remaining sign-in method. Leave false unless the app has another
   * way back in (for example, a verified email for password reset).
   * @default false
   */
  canUnlinkLast?: boolean;
  /** Error text shown with `role="alert"`, for example from a failed link redirect. */
  error?: string;
  /** Disables every row, for example while accounts load. */
  disabled?: boolean;
  /**
   * Heading text.
   * @default "Linked accounts"
   */
  title?: string;
  /**
   * Text under the heading.
   * @default "Sign in with any account linked here."
   */
  description?: string;
  /**
   * Root testID; child testIDs are derived from it.
   * @default "linked-accounts-card"
   */
  testID?: string;
}

/** Whether a PasswordCard submission changes an existing password or sets a first one. */
export type PasswordCardMode = "change" | "set";

/** What {@link PasswordCardProps.onSubmit} receives. */
export interface PasswordCardSubmission {
  /** `change` when the user has a password, `set` for an OAuth-only user. */
  mode: PasswordCardMode;
  /** The current password. Present only in `change` mode. */
  currentPassword?: string;
  /** The new password, already checked against `minLength` and the confirmation. */
  newPassword: string;
  /** True when the user checked "Sign out of other devices". Always false in `set` mode. */
  revokeOtherSessions: boolean;
}

/**
 * Props for the PasswordCard component.
 */
export interface PasswordCardProps {
  /**
   * Whether the user has a password (a `"credential"` account). True shows "Change password";
   * false shows "Set a password".
   */
  hasPassword: boolean;
  /**
   * Called with valid values. Resolve to show the success message and clear the form; reject to
   * show the error's message under the form.
   */
  onSubmit: (values: PasswordCardSubmission) => Promise<void>;
  /**
   * Shows the "Sign out of other devices" checkbox in change mode.
   * @default true
   */
  showRevokeOtherSessions?: boolean;
  /**
   * Minimum new-password length. Better Auth's default is 8.
   * @default 8
   */
  minLength?: number;
  /** Error text shown with `role="alert"`, for example a wrong current password. */
  error?: string;
  /** Disables the form and shows a spinner on the submit button. */
  loading?: boolean;
  /**
   * Root testID; child testIDs are derived from it.
   * @default "password-card"
   */
  testID?: string;
}

/**
 * A passkey registered to the user. The shape is a subset of `@better-auth/passkey`'s `Passkey`,
 * so `authClient.passkey.listUserPasskeys()` data can be passed as is.
 */
export interface AccountPasskey {
  /** Better Auth's passkey id: what `deletePasskey({id})` and `updatePasskey({id, name})` take. */
  id: string;
  /** The user's label for the passkey. Takes precedence over `authenticatorName`. */
  name?: string;
  /**
   * A fallback label for an unnamed passkey, such as the authenticator model a connected screen
   * looks up with `getAuthenticatorName(aaguid)` from `@better-auth/passkey` ("iCloud Keychain").
   * With neither `name` nor this, the row shows "Unnamed passkey".
   */
  authenticatorName?: string;
  /** When the passkey was added, as a `Date` (the Better Auth client parses dates) or ISO string. */
  createdAt?: string | Date;
  /**
   * When the passkey was last used to sign in. Better Auth does not store this; pass it when the
   * app tracks it.
   */
  lastUsedAt?: string | Date;
  /** Whether the credential is backed up (synced) by its provider, such as iCloud Keychain. */
  backedUp?: boolean;
}

/**
 * Props for the PasskeysCard component.
 */
export interface PasskeysCardProps {
  /** The user's passkeys, one row each, keyed by `id`. */
  passkeys: AccountPasskey[];
  /**
   * Called when the user confirms the Add dialog, with the name they typed (trimmed), or
   * undefined when they left it blank. Pass it to `authClient.passkey.addPasskey({name})`. The
   * Add button shows a spinner until the returned promise settles. A rejection (for example, the
   * user cancelling the browser prompt) shows its message as the card error. The Better Auth
   * client resolves `{data, error}` instead of rejecting, so throw when `error` is set; the same
   * applies to every callback below.
   */
  onAdd?: (name?: string) => void | Promise<void>;
  /**
   * Called when the user saves a new name in the Rename dialog, with the trimmed name. Pass it to
   * `authClient.passkey.updatePasskey({id, name})`. Same spinner and error handling as `onAdd`.
   */
  onRename?: (id: string, name: string) => void | Promise<void>;
  /**
   * Called after the user confirms Remove, with the row's passkey. Pass `passkey.id` to
   * `authClient.passkey.deletePasskey({id})`. Same spinner and error handling as `onAdd`.
   */
  onRemove?: (passkey: AccountPasskey) => void | Promise<void>;
  /**
   * Whether this device and browser can create passkeys (for example, WebAuthn is available).
   * False hides Add and explains why; existing passkeys can still be renamed and removed.
   * @default true
   */
  supported?: boolean;
  /** Error text shown with `role="alert"`; overrides a rejection message. */
  error?: string;
  /** Disables every button, for example while passkeys load. */
  disabled?: boolean;
  /**
   * Heading text.
   * @default "Passkeys"
   */
  title?: string;
  /**
   * Text under the heading.
   * @default "Sign in with your fingerprint, face, or screen lock instead of a password."
   */
  description?: string;
  /**
   * Root testID; child testIDs are derived from it.
   * @default "passkeys-card"
   */
  testID?: string;
}

/**
 * A signed-in session. The shape is a subset of Better Auth's session, so `listSessions()` data
 * can be passed as is.
 */
export interface AccountSession {
  /** Better Auth's session id. Keys the row. */
  id: string;
  /** The session token: what `revokeSession({token})` takes. */
  token?: string;
  /** The user agent that created the session. The row shows the browser and OS parsed from it. */
  userAgent?: string | null;
  /** The IP address that created the session. */
  ipAddress?: string | null;
  /** A place name for the session ("Denver, US"), when the app looks one up. */
  location?: string;
  /** When the session signed in, as a `Date` or ISO string: the row's "Signed in" time. */
  createdAt?: string | Date;
  /**
   * When the session was last refreshed: the row's "Last refreshed" time. Better Auth moves it
   * only once per `session.updateAge` (a day by default), so it is not a live activity time.
   */
  updatedAt?: string | Date;
  /** When the session expires. */
  expiresAt?: string | Date;
}

/**
 * Props for the SessionsCard component.
 */
export interface SessionsCardProps {
  /** The user's active sessions, one row each, keyed by `id`. The current session is listed first. */
  sessions: AccountSession[];
  /**
   * The current session's id (`useSession().data.session.id`). The matching row is marked "This
   * device" and cannot be revoked on its own. Pass this or `currentSessionToken`.
   */
  currentSessionId?: string;
  /** The current session's token, matched against each session's `token`. */
  currentSessionToken?: string;
  /**
   * Called when the user signs out another session, with that session. Pass `session.token` to
   * `authClient.revokeSession({token})` and throw when it resolves an `error` (the Better Auth
   * client resolves `{data, error}` instead of rejecting). Not offered for the current session. The row shows a
   * spinner until the returned promise settles; a rejection shows its message as the card error.
   */
  onRevoke?: (session: AccountSession) => void | Promise<void>;
  /**
   * Called after the user confirms "Sign out everywhere else". Call
   * `authClient.revokeOtherSessions()` and throw when it resolves an `error`. Disabled when there
   * are no other sessions.
   */
  onRevokeOthers?: () => void | Promise<void>;
  /**
   * The time relative times ("Signed in 5 minutes ago") are measured from. When omitted, the card
   * uses the current time and recomputes it every minute; pass it to make the output
   * deterministic (tests, screenshots).
   */
  now?: Date;
  /** Error text shown with `role="alert"`; overrides a rejection message. */
  error?: string;
  /** Disables every button, for example while sessions load. */
  disabled?: boolean;
  /**
   * Heading text.
   * @default "Where you're signed in"
   */
  title?: string;
  /**
   * Text under the heading.
   * @default "Sign out of any device you don't recognize."
   */
  description?: string;
  /**
   * Root testID; child testIDs are derived from it.
   * @default "sessions-card"
   */
  testID?: string;
}

/**
 * What {@link TwoFactorSettingsCardProps.onStartEnroll} resolves: the TOTP branch of Better
 * Auth's `twoFactor.enable()` data. `enable()` resolves `{method: "otp"}` or
 * `{method: "totp", totpURI, backupCodes}`, so narrow it with `"totpURI" in data` first.
 */
export interface TwoFactorEnrollment {
  /**
   * The `otpauth://totp/...` URI the authenticator app scans. The card draws it as a QR code and
   * shows its `secret` parameter for manual entry.
   */
  totpURI: string;
  /** The single-use backup codes generated with the secret. */
  backupCodes: string[];
}

/**
 * Props for the TwoFactorSettingsCard component.
 */
export interface TwoFactorSettingsCardProps {
  /**
   * Whether two-factor authentication is on (Better Auth's `user.twoFactorEnabled`). False offers
   * "Turn on"; true offers new backup codes and "Turn off". An enrollment or new-codes flow in
   * progress keeps showing until the user finishes it, even after this flips.
   */
  enabled: boolean;
  /**
   * How many unused backup codes the user has left. Shown when given, with a warning below 3.
   * Better Auth does not report this on the session; pass it when the app knows it.
   */
  backupCodesRemaining?: number;
  /**
   * Called after the password step (or at once when `requirePassword` is false) to start
   * enrollment. Call `authClient.twoFactor.enable({password})`; throw when it resolves an `error`
   * (the Better Auth client resolves `{data, error}` instead of rejecting) or data without a
   * `totpURI` (the `{method: "otp"}` branch), else return `{totpURI, backupCodes}` from it.
   * The same applies to every callback below. A rejection shows its message on the step.
   */
  onStartEnroll: (password?: string) => Promise<TwoFactorEnrollment>;
  /**
   * Called with the code the user typed from their authenticator app. Call
   * `authClient.twoFactor.verifyTotp({code})`, which turns two-factor on once it succeeds. A
   * rejection clears the code and shows its message.
   */
  onVerify: (code: string) => Promise<void>;
  /**
   * Called after the password step to replace the backup codes. Call
   * `authClient.twoFactor.generateBackupCodes({password})` and return `data.backupCodes`. Hidden
   * when not passed.
   */
  onRegenerateBackupCodes?: (password?: string) => Promise<string[]>;
  /**
   * Called after the password step and a destructive confirm. Call
   * `authClient.twoFactor.disable({password})`. Hidden when not passed.
   */
  onDisable?: (password?: string) => Promise<void>;
  /**
   * Asks for the password before enrolling, replacing backup codes, and turning off. Better Auth
   * requires it unless its two-factor plugin sets `allowPasswordless` (Terreno's `twoFactor`
   * config does not), and even then for users who have a password; with `allowPasswordless`,
   * pass `requirePassword={hasPassword}`. When false, callbacks get `undefined`.
   * @default true
   */
  requirePassword?: boolean;
  /**
   * Whether the user has a password (a `"credential"` account; see `hasPasswordCredential`).
   * With `requirePassword`, a user without one can't confirm, so Turn on, Get new backup codes
   * and Turn off are disabled and the card asks them to set a password first.
   * @default true
   */
  hasPassword?: boolean;
  /**
   * Digits in an authenticator code: Better Auth's `totpOptions.digits`. Defaults to the
   * `digits` parameter of the enrollment's `totpURI`, else 6.
   */
  digits?: number;
  /** Error text shown with `role="alert"`; overrides a rejection message. */
  error?: string;
  /**
   * Disables Turn on, Get new backup codes, Turn off and the password step, for example while
   * the user loads.
   */
  disabled?: boolean;
  /**
   * Heading text.
   * @default "Two-factor authentication"
   */
  title?: string;
  /**
   * Text under the heading.
   * @default "Sign in with a code from an authenticator app as well as your password."
   */
  description?: string;
  /**
   * Root testID; child testIDs are derived from it.
   * @default "two-factor-settings-card"
   */
  testID?: string;
}

/**
 * Props for the AccountSecurityScreen component. Each card renders only when its props are given,
 * so leave out the props of a feature the app has turned off (for example, `passkeys` when the
 * server has no passkey plugin) and its card disappears.
 */
export interface AccountSecurityScreenProps {
  /**
   * Props for the LinkedAccountsCard, shown first under "Sign-in methods". Omit to hide the card.
   */
  linkedAccounts?: LinkedAccountsCardProps;
  /** Props for the PasswordCard, shown after linked accounts. Omit to hide the card. */
  password?: PasswordCardProps;
  /** Props for the PasskeysCard. Omit to hide the card, for example when passkeys are off. */
  passkeys?: PasskeysCardProps;
  /** Props for the TwoFactorSettingsCard. Omit to hide the card, for example when 2FA is off. */
  twoFactor?: TwoFactorSettingsCardProps;
  /** Props for the SessionsCard, shown last. Omit to hide the card. */
  sessions?: SessionsCardProps;
  /**
   * Page heading.
   * @default "Security"
   */
  title?: string;
  /** Text under the heading. */
  description?: string;
  /**
   * Content under the heading and description and above the cards, such as the signed-in
   * user's name and email or a notice. Shown in every state.
   */
  header?: ReactNode;
  /**
   * Extra content after the cards, such as an app-specific card. Hidden with the cards while
   * loading or showing `error`.
   */
  children?: ReactNode;
  /**
   * Shows a spinner instead of the cards, for example while the session, accounts, passkeys and
   * sessions load. Takes precedence over `error`, so a retry in flight shows as loading.
   */
  isLoading?: boolean;
  /**
   * A page-level error, for example when the data the cards need failed to load. Shown with
   * `role="alert"` instead of the cards. Errors from a card's own action belong in that card's
   * `error` prop.
   */
  error?: string;
  /** Called by the Try again button under `error`. Without it the button is hidden. */
  onRetry?: () => void;
  /**
   * Wraps the screen in a scrolling ui `Page`. Pass false when the screen sits inside your own
   * `Page`, `ScrollView` or tab layout, so scroll views do not nest.
   * @default true
   */
  withPage?: boolean;
  /**
   * The widest the content grows, in pixels. Cards stack in one column at any width.
   * @default 720
   */
  maxWidth?: number;
  /**
   * Root testID; child testIDs are derived from it.
   * @default "account-security-screen"
   */
  testID?: string;
}
