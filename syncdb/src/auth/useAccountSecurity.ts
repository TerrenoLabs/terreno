/**
 * Everything an account security screen needs from a Better Auth client, in one hook: linked
 * providers (link and unlink), the password (change, or set a first one), passkeys, two-factor
 * authentication, and signed-in sessions. It loads each section, builds the props of each
 * `@terreno/ui` security card, unwraps every Better Auth `{data, error}` result into a thrown
 * `Error` (so the card that called shows its message), and after each change refetches only the
 * section that changed. `TerrenoAccountSecurityScreen` renders `@terreno/ui`'s
 * `AccountSecurityScreen` from it; apps with their own screen can spread `screenProps` into theirs.
 */
import type {
  AccountPasskey,
  AccountSecurityScreenProps,
  AccountSession,
  LinkedAccount,
  LinkedAccountsCardProps,
  PasskeysCardProps,
  PasswordCardProps,
  PasswordCardSubmission,
  SessionsCardProps,
  TwoFactorEnrollment,
  TwoFactorSettingsCardProps,
} from "@terreno/ui";
import {useCallback, useEffect, useMemo, useRef, useState} from "react";

import {
  type BetterAuthClient,
  type BetterAuthLinkClient,
  linkSocialWithHandoff,
} from "./betterAuthClient";
import {getOwnEntry} from "./ownEntry";
import {IsWeb} from "./platform";
import {type AuthMethodsClient, type BetterAuthMethods, useAuthMethods} from "./useAuthMethods";

/** A Better Auth error as the client returns it. */
export interface AccountSecurityClientError {
  code?: string;
  message?: string;
  status?: number;
  statusText?: string;
}

/** Better Auth client calls resolve `{data, error}` instead of throwing. */
export interface AccountSecurityClientResult<Data> {
  data?: Data | null;
  error?: AccountSecurityClientError | null;
}

/** The session user fields the hook reads. */
export interface AccountSecurityUser {
  id: string;
  email?: string | null;
  name?: string | null;
  /** Set by the server's `twoFactor` feature. */
  twoFactorEnabled?: boolean | null;
}

/** The current session, from `getSession`. */
export interface AccountSecuritySessionData {
  session: {id: string; token?: string};
  user: AccountSecurityUser;
}

/** One `listAccounts` entry. */
export interface AccountSecurityAccountRow {
  id: string;
  providerId: string;
  accountId?: string;
  createdAt?: Date | string;
}

/**
 * The part of a Better Auth client the hook calls. A client from `createBetterAuthClient`
 * satisfies it; `passkey` and `twoFactor` exist when those `features` are on, and the hook leaves
 * out the card of a namespace that is missing.
 */
export interface AccountSecurityClient extends AuthMethodsClient {
  $fetch(
    path: string,
    options?: {method?: "GET" | "POST"; body?: Record<string, unknown>}
  ): Promise<{data: unknown; error: unknown}>;
  getSession(options?: {
    query?: {disableCookieCache?: boolean};
  }): Promise<AccountSecurityClientResult<AccountSecuritySessionData | null>>;
  listAccounts(): Promise<AccountSecurityClientResult<AccountSecurityAccountRow[]>>;
  unlinkAccount(body: {accountId: string}): Promise<AccountSecurityClientResult<unknown>>;
  linkSocial(body: {
    callbackURL: string;
    errorCallbackURL?: string;
    provider: string;
  }): Promise<{error: {code?: string; message?: string; status: number} | null}>;
  changePassword(body: {
    currentPassword: string;
    newPassword: string;
    revokeOtherSessions?: boolean;
  }): Promise<AccountSecurityClientResult<unknown>>;
  listSessions(): Promise<AccountSecurityClientResult<AccountSession[]>>;
  revokeSession(body: {token: string}): Promise<AccountSecurityClientResult<unknown>>;
  revokeOtherSessions(): Promise<AccountSecurityClientResult<unknown>>;
  passkey?: {
    listUserPasskeys(): Promise<AccountSecurityClientResult<AccountPasskey[]>>;
    addPasskey(options?: {
      name?: string;
    }): Promise<AccountSecurityClientResult<unknown> | undefined>;
    updatePasskey(body: {id: string; name: string}): Promise<AccountSecurityClientResult<unknown>>;
    deletePasskey(body: {id: string}): Promise<AccountSecurityClientResult<unknown>>;
  };
  twoFactor?: {
    enable(body: {password: string}): Promise<AccountSecurityClientResult<object>>;
    verifyTotp(body: {code: string}): Promise<AccountSecurityClientResult<unknown>>;
    generateBackupCodes(body: {
      password: string;
    }): Promise<AccountSecurityClientResult<{backupCodes: string[]}>>;
    disable(body: {password: string}): Promise<AccountSecurityClientResult<unknown>>;
  };
}

/**
 * Any client `createBetterAuthClient` returns. One made without `features` is typed loosely, so
 * it is listed on its own.
 */
export type AccountSecurityClientInput = AccountSecurityClient | BetterAuthClient;

export interface UseAccountSecurityOptions {
  /** A client from `createBetterAuthClient`, with the `passkey` and `twoFactor` features on. */
  client: AccountSecurityClientInput;
  /**
   * The server's methods, when the app already loaded them with `useAuthMethods`. Otherwise the
   * hook loads them. They decide which cards show.
   */
  methods?: BetterAuthMethods;
  /**
   * Where linking a provider returns: this security screen's route. In bearer mode it may be any
   * page on one of the server's `oauthHandoff.webOrigins`.
   */
  callbackURL: string;
  /** Where a failed link returns with `?error=`. Defaults to `callbackURL`. */
  errorCallbackURL?: string;
  /** The `?error=` this page was opened with after a link returned. Never displayed as is. */
  linkError?: string | string[] | null;
  /** Labels for providers without a brand, such as `{"mock-oidc": "Mock OIDC"}`. */
  providerLabels?: Record<string, string>;
  /**
   * Whether this device can create passkeys. Defaults to whether WebAuthn is available on web.
   */
  passkeySupported?: boolean;
  /** Minimum new-password length: the server's `minPasswordLength`. Defaults to Better Auth's 8. */
  minPasswordLength?: number;
}

/** The `AccountSecurityScreen` props the hook fills in. */
export type AccountSecurityControllerScreenProps = Required<
  Pick<AccountSecurityScreenProps, "isLoading" | "onRetry">
> &
  Pick<
    AccountSecurityScreenProps,
    "error" | "linkedAccounts" | "password" | "passkeys" | "twoFactor" | "sessions"
  >;

export interface AccountSecurity {
  /** Spread into `AccountSecurityScreen`. A card's props are undefined when it is hidden. */
  screenProps: AccountSecurityControllerScreenProps;
  /** The server's methods; undefined while they load or after an error. */
  methods: BetterAuthMethods | undefined;
  /** The signed-in user, once the session loads. */
  user: AccountSecurityUser | undefined;
  /** Reloads every section. */
  refetch: () => Promise<void>;
}

interface Section<Data> {
  data: Data;
  error?: string;
}

/** Shown when unlinking would leave the user without a way to sign in. */
export const LAST_SIGN_IN_METHOD_MESSAGE =
  "You can't remove your only sign-in method. Add another one first.";

/** Shown when Better Auth needs a recent sign-in (`SESSION_NOT_FRESH`) for an action. */
export const SIGN_IN_AGAIN_MESSAGE = "Sign in again to manage this.";

/** Shown when the user has a credential row without a password and tries to change it. */
export const NO_PASSWORD_YET_MESSAGE = "You don't have a password yet. Set one below.";

const SESSION_NOT_FRESH_CODE = "SESSION_NOT_FRESH";
const CREDENTIAL_ACCOUNT_NOT_FOUND_CODE = "CREDENTIAL_ACCOUNT_NOT_FOUND";

const SIGNED_OUT_MESSAGE = "Sign in to manage your security settings.";
const LINK_FAILED_MESSAGE = "Couldn't link that account. Please try again.";

// What the security screen shows for a link's `?error=` return. URL text is never shown as is,
// because anyone can craft a link.
const LINK_ERROR_MESSAGES: Record<string, string> = {
  account_already_linked_to_different_user: "That account is already linked to another user.",
  email_does_not_match: "That account's email doesn't match the email on this account.",
  LINKING_DISABLED: "This app does not link sign-in methods.",
};

/** The readable message of a `?error=` a link returned with. */
export const getLinkErrorMessage = (
  code: string | string[] | null | undefined
): string | undefined => {
  const value = Array.isArray(code) ? code[0] : code;
  if (!value) {
    return undefined;
  }
  return getOwnEntry(LINK_ERROR_MESSAGES, value) ?? LINK_FAILED_MESSAGE;
};

/** Throws the Better Auth error, so the card that called shows its message. */
const unwrap = <Data>(
  result: AccountSecurityClientResult<Data> | undefined,
  fallback: string
): Data | null | undefined => {
  if (result?.error) {
    // Better Auth asks for a recent sign-in before listing sessions, unlinking, or setting a
    // password; its own message ("Session is not fresh") does not say what to do.
    if (result.error.code === SESSION_NOT_FRESH_CODE) {
      throw new Error(SIGN_IN_AGAIN_MESSAGE);
    }
    throw new Error(result.error.message || result.error.statusText || fallback);
  }
  return result?.data;
};

const messageOf = (error: unknown, fallback: string): string => {
  if (error instanceof Error && error.message) {
    return error.message;
  }
  return fallback;
};

const isWebAuthnAvailable = (): boolean => {
  return (
    IsWeb &&
    typeof window !== "undefined" &&
    typeof (window as {PublicKeyCredential?: unknown}).PublicKeyCredential !== "undefined"
  );
};

const toLinkedAccount = (row: AccountSecurityAccountRow): LinkedAccount => ({
  accountId: row.accountId,
  id: row.id,
  linkedAt: row.createdAt,
  providerId: row.providerId,
});

const hasCredential = (accounts: LinkedAccount[]): boolean => {
  return accounts.some((account) => account.providerId === "credential");
};

/**
 * Drives an account security screen from a Better Auth client. See "Drop-in security screen" in
 * docs/how-to/configure-better-auth.md.
 *
 * @example
 * ```tsx
 * const security = useAccountSecurity({client: authClient, callbackURL: "/security"});
 * return <AccountSecurityScreen {...security.screenProps} />;
 * ```
 */
export const useAccountSecurity = ({
  client: clientInput,
  methods: methodsOption,
  callbackURL,
  errorCallbackURL,
  linkError,
  providerLabels,
  passkeySupported,
  minPasswordLength,
}: UseAccountSecurityOptions): AccountSecurity => {
  const client = clientInput as AccountSecurityClient;
  const loaded = useAuthMethods(client, {skip: Boolean(methodsOption)});
  const methods = methodsOption ?? loaded.methods;

  const [session, setSession] = useState<Section<AccountSecuritySessionData | undefined>>({
    data: undefined,
  });
  const [accounts, setAccounts] = useState<Section<LinkedAccount[]>>({data: []});
  const [passkeys, setPasskeys] = useState<Section<AccountPasskey[]>>({data: []});
  const [sessions, setSessions] = useState<Section<AccountSession[]>>({data: []});
  // False until the first load settles, so the cards never flash empty.
  const [hasLoaded, setHasLoaded] = useState(false);
  const [isCredentialWithoutPassword, setIsCredentialWithoutPassword] = useState(false);

  const isPasskeyOn = Boolean(methods?.passkey && client.passkey && IsWeb);
  const isTwoFactorOn = Boolean(methods?.twoFactor && client.twoFactor);

  // Dropped once the screen unmounts, so a late response never sets state.
  const isMounted = useRef(true);
  // Mark the hook unmounted so late responses are ignored.
  useEffect(() => {
    isMounted.current = true;
    return (): void => {
      isMounted.current = false;
    };
  }, []);

  // Each loader catches its own failure into its section, so one failed section never hides
  // the others, and a refetch after a successful change never reports the change as failed.
  const loadSession = useCallback(async (): Promise<void> => {
    let next: Section<AccountSecuritySessionData | undefined>;
    try {
      // Read past the session cookie cache, which keeps a stale `twoFactorEnabled` for minutes.
      const result = await client.getSession({query: {disableCookieCache: true}});
      const data = unwrap(result, "Couldn't load your session.");
      next = data?.session ? {data} : {data: undefined, error: SIGNED_OUT_MESSAGE};
    } catch (error) {
      next = {data: undefined, error: messageOf(error, "Couldn't load your session.")};
    }
    if (isMounted.current) {
      setSession(next);
    }
  }, [client]);

  const loadAccounts = useCallback(async (): Promise<void> => {
    let next: Section<LinkedAccount[]>;
    try {
      const data = unwrap(await client.listAccounts(), "Couldn't load your sign-in methods.");
      next = {data: (data ?? []).map(toLinkedAccount)};
    } catch (error) {
      next = {data: [], error: messageOf(error, "Couldn't load your sign-in methods.")};
    }
    if (isMounted.current) {
      setAccounts((previous) => (next.error ? {...previous, error: next.error} : next));
    }
  }, [client]);

  const loadPasskeys = useCallback(async (): Promise<void> => {
    const passkey = client.passkey;
    if (!passkey) {
      return;
    }
    let next: Section<AccountPasskey[]>;
    try {
      const data = unwrap(await passkey.listUserPasskeys(), "Couldn't load your passkeys.");
      next = {data: data ?? []};
    } catch (error) {
      next = {data: [], error: messageOf(error, "Couldn't load your passkeys.")};
    }
    if (isMounted.current) {
      setPasskeys((previous) => (next.error ? {...previous, error: next.error} : next));
    }
  }, [client]);

  const loadSessions = useCallback(async (): Promise<void> => {
    let next: Section<AccountSession[]>;
    try {
      const data = unwrap(await client.listSessions(), "Couldn't load your sessions.");
      next = {data: data ?? []};
    } catch (error) {
      next = {data: [], error: messageOf(error, "Couldn't load your sessions.")};
    }
    if (isMounted.current) {
      setSessions((previous) => (next.error ? {...previous, error: next.error} : next));
    }
  }, [client]);

  const loadAll = useCallback(async (): Promise<void> => {
    setHasLoaded(false);
    await Promise.all([
      loadSession(),
      loadAccounts(),
      isPasskeyOn ? loadPasskeys() : null,
      loadSessions(),
    ]);
    if (isMounted.current) {
      setHasLoaded(true);
    }
  }, [isPasskeyOn, loadAccounts, loadPasskeys, loadSession, loadSessions]);

  // Load every section once the server says which features are on.
  useEffect(() => {
    if (methods) {
      void loadAll();
    }
  }, [loadAll, methods]);

  const onRetry = useCallback((): void => {
    if (!methods) {
      loaded.refetch();
      return;
    }
    void loadAll();
  }, [loadAll, loaded, methods]);

  const accountRows = accounts.data;
  const passkeyRows = passkeys.data;
  // Better Auth's account list does not say whether the credential row holds a password; a
  // refused change (`CREDENTIAL_ACCOUNT_NOT_FOUND`) shows it does not.
  const hasPassword = hasCredential(accountRows) && !isCredentialWithoutPassword;
  const user = session.data?.user;

  const onLink = useCallback(
    async (provider: string): Promise<void> => {
      const {error} = await linkSocialWithHandoff({
        callbackURL,
        // The client's $fetch is typed loosely here; linking calls only $fetch and linkSocial.
        client: client as unknown as BetterAuthLinkClient,
        provider,
        ...(errorCallbackURL !== undefined ? {errorCallbackURL} : {}),
      });
      if (error) {
        throw new Error(
          (error.code ? getOwnEntry(LINK_ERROR_MESSAGES, error.code) : undefined) ??
            error.message ??
            LINK_FAILED_MESSAGE
        );
      }
      // On web the page is on its way to the provider; on native the link has finished.
      await loadAccounts();
    },
    [callbackURL, client, errorCallbackURL, loadAccounts]
  );

  const onUnlink = useCallback(
    async (_providerId: string, account: LinkedAccount): Promise<void> => {
      // Better Auth refuses to unlink the last account, and passkeys need an account to sign in
      // again after a reset, so the only account is never sent to the server.
      if (accountRows.length <= 1) {
        throw new Error(LAST_SIGN_IN_METHOD_MESSAGE);
      }
      unwrap(await client.unlinkAccount({accountId: account.id}), "Couldn't unlink that account.");
      await loadAccounts();
    },
    [accountRows.length, client, loadAccounts]
  );

  const onPasswordSubmit = useCallback(
    async ({
      mode,
      currentPassword,
      newPassword,
      revokeOtherSessions,
    }: PasswordCardSubmission): Promise<void> => {
      if (mode === "change") {
        const result = await client.changePassword({
          currentPassword: currentPassword ?? "",
          newPassword,
          revokeOtherSessions,
        });
        if (result.error?.code === CREDENTIAL_ACCOUNT_NOT_FOUND_CODE) {
          // The credential row has no password: switch the card to "Set a password".
          setIsCredentialWithoutPassword(true);
          throw new Error(NO_PASSWORD_YET_MESSAGE);
        }
        unwrap(result, "Couldn't change your password.");
        // Revoking other sessions replaces the current one too.
        if (revokeOtherSessions) {
          await Promise.all([loadSession(), loadSessions()]);
        }
        return;
      }
      // Better Auth's own setPassword is server-only; Terreno's endpoint wraps it.
      const result = await client.$fetch("/terreno/set-password", {
        body: {newPassword},
        method: "POST",
      });
      unwrap(result as AccountSecurityClientResult<unknown>, "Couldn't set your password.");
      setIsCredentialWithoutPassword(false);
      await loadAccounts();
    },
    [client, loadAccounts, loadSession, loadSessions]
  );

  const onAddPasskey = useCallback(
    async (name?: string): Promise<void> => {
      unwrap(
        await client.passkey?.addPasskey(name ? {name} : undefined),
        "Couldn't add a passkey."
      );
      await loadPasskeys();
    },
    [client, loadPasskeys]
  );

  const onRenamePasskey = useCallback(
    async (id: string, name: string): Promise<void> => {
      unwrap(await client.passkey?.updatePasskey({id, name}), "Couldn't rename that passkey.");
      await loadPasskeys();
    },
    [client, loadPasskeys]
  );

  const onRemovePasskey = useCallback(
    async (passkey: AccountPasskey): Promise<void> => {
      if (accountRows.length + passkeyRows.length <= 1) {
        throw new Error(LAST_SIGN_IN_METHOD_MESSAGE);
      }
      unwrap(
        await client.passkey?.deletePasskey({id: passkey.id}),
        "Couldn't remove that passkey."
      );
      await loadPasskeys();
    },
    [accountRows.length, client, loadPasskeys, passkeyRows.length]
  );

  const onStartEnroll = useCallback(
    async (password?: string): Promise<TwoFactorEnrollment> => {
      const data = unwrap(
        await client.twoFactor?.enable({password: password ?? ""}),
        "Couldn't start two-factor setup."
      );
      // `enable()` resolves `{method: "otp"}` or `{method: "totp", totpURI, backupCodes}`.
      if (!data || !("totpURI" in data)) {
        throw new Error("Couldn't start two-factor setup.");
      }
      const {backupCodes, totpURI} = data as {backupCodes?: string[]; totpURI: string};
      return {backupCodes: backupCodes ?? [], totpURI};
    },
    [client]
  );

  const onVerifyTwoFactor = useCallback(
    async (code: string): Promise<void> => {
      unwrap(await client.twoFactor?.verifyTotp({code}), "That code didn't work.");
      // Turning two-factor on replaces the current session.
      await Promise.all([loadSession(), loadSessions()]);
    },
    [client, loadSession, loadSessions]
  );

  const onRegenerateBackupCodes = useCallback(
    async (password?: string): Promise<string[]> => {
      const data = unwrap(
        await client.twoFactor?.generateBackupCodes({password: password ?? ""}),
        "Couldn't create new backup codes."
      );
      return data?.backupCodes ?? [];
    },
    [client]
  );

  const onDisableTwoFactor = useCallback(
    async (password?: string): Promise<void> => {
      unwrap(
        await client.twoFactor?.disable({password: password ?? ""}),
        "Couldn't turn off two-factor authentication."
      );
      // Turning two-factor off replaces the current session.
      await Promise.all([loadSession(), loadSessions()]);
    },
    [client, loadSession, loadSessions]
  );

  const onRevokeSession = useCallback(
    async (revoked: AccountSession): Promise<void> => {
      if (!revoked.token) {
        throw new Error("Couldn't sign out that session.");
      }
      unwrap(await client.revokeSession({token: revoked.token}), "Couldn't sign out that session.");
      await loadSessions();
    },
    [client, loadSessions]
  );

  const onRevokeOtherSessions = useCallback(async (): Promise<void> => {
    unwrap(await client.revokeOtherSessions(), "Couldn't sign out your other sessions.");
    await loadSessions();
  }, [client, loadSessions]);

  const linkErrorMessage = getLinkErrorMessage(linkError);

  const linkedAccountsProps = useMemo((): LinkedAccountsCardProps | undefined => {
    if (!methods || methods.providers.length === 0) {
      return undefined;
    }
    return {
      accounts: accountRows,
      error: accounts.error ?? linkErrorMessage,
      // With linking off, the card lists linked providers but offers no Link button.
      ...(methods.accountLinking.mode === "never" ? {} : {onLink}),
      onUnlink,
      providers: methods.providers.map((id) => {
        const label = getOwnEntry(providerLabels, id);
        return {id, ...(label ? {label} : {})};
      }),
    };
  }, [accountRows, accounts.error, linkErrorMessage, methods, onLink, onUnlink, providerLabels]);

  const passwordProps = useMemo((): PasswordCardProps | undefined => {
    if (!methods?.emailPassword) {
      return undefined;
    }
    return {
      hasPassword,
      onSubmit: onPasswordSubmit,
      ...(minPasswordLength !== undefined ? {minLength: minPasswordLength} : {}),
      ...(user?.email ? {username: user.email} : {}),
    };
  }, [hasPassword, methods?.emailPassword, minPasswordLength, onPasswordSubmit, user?.email]);

  const passkeysProps = useMemo((): PasskeysCardProps | undefined => {
    if (!isPasskeyOn) {
      return undefined;
    }
    return {
      error: passkeys.error,
      onAdd: onAddPasskey,
      onRemove: onRemovePasskey,
      onRename: onRenamePasskey,
      passkeys: passkeyRows,
      supported: passkeySupported ?? isWebAuthnAvailable(),
    };
  }, [
    isPasskeyOn,
    onAddPasskey,
    onRemovePasskey,
    onRenamePasskey,
    passkeyRows,
    passkeySupported,
    passkeys.error,
  ]);

  const twoFactorProps = useMemo((): TwoFactorSettingsCardProps | undefined => {
    if (!isTwoFactorOn) {
      return undefined;
    }
    return {
      enabled: Boolean(user?.twoFactorEnabled),
      hasPassword,
      onDisable: onDisableTwoFactor,
      onRegenerateBackupCodes,
      onStartEnroll,
      onVerify: onVerifyTwoFactor,
      ...(user?.email ? {username: user.email} : {}),
    };
  }, [
    hasPassword,
    isTwoFactorOn,
    onDisableTwoFactor,
    onRegenerateBackupCodes,
    onStartEnroll,
    onVerifyTwoFactor,
    user?.email,
    user?.twoFactorEnabled,
  ]);

  const sessionsProps = useMemo((): SessionsCardProps | undefined => {
    if (!methods) {
      return undefined;
    }
    return {
      currentSessionId: session.data?.session.id,
      error: sessions.error,
      onRevoke: onRevokeSession,
      onRevokeOthers: onRevokeOtherSessions,
      sessions: sessions.data,
    };
  }, [
    methods,
    onRevokeOtherSessions,
    onRevokeSession,
    session.data?.session.id,
    sessions.data,
    sessions.error,
  ]);

  const isLoading = loaded.isLoading || (Boolean(methods) && !hasLoaded);
  const error = methods ? session.error : loaded.error;

  return {
    methods,
    refetch: loadAll,
    screenProps: {
      error,
      isLoading,
      linkedAccounts: linkedAccountsProps,
      onRetry,
      passkeys: passkeysProps,
      password: passwordProps,
      sessions: sessionsProps,
      twoFactor: twoFactorProps,
    },
    user,
  };
};
