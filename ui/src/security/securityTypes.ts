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
   * Auth's `unlinkAccount({accountId})`. The row shows a spinner until the returned promise
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
