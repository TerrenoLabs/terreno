/**
 * Reads and changes one user's sign-in security through Better Auth's internal adapter, so the
 * same code works whatever collection names a consumer configures. Never returns secrets: no
 * TOTP secret, no backup codes, no session or OAuth tokens.
 */

import {generateRandomString} from "better-auth/crypto";
import {DateTime} from "luxon";
import mongoose from "mongoose";

import type {User, UserModel} from "../auth";
import {readBetterAuthMethods} from "../betterAuthMethods";
import {type BetterAuthInstance, betterAuthResetPasswordUrl} from "../betterAuthSetup";
import {NotFoundError} from "../errors";
import {logger} from "../logger";
import {findOneOrNoneFor} from "../plugins";

/** Which features this server has on. The Better Auth ones are all `false` without Better Auth. */
export interface AccountSecurityFeatures {
  betterAuth: boolean;
  /** Whether the app User model has `disabled` (`isDisabledPlugin`), so accounts can be disabled. */
  disableAccount: boolean;
  multiSession: boolean;
  passkey: boolean;
  twoFactor: boolean;
}

export interface AccountSecurityProvider {
  /** ISO time the provider was linked, when known. */
  linkedAt: string | null;
  /** Better Auth provider id, such as `github`, `google`, or `mock-oidc`. */
  providerId: string;
}

export interface AccountSecurityPasskey {
  createdAt: string | null;
  id: string;
  name: string | null;
}

export interface AccountSecurityActionSummary {
  destructive: boolean;
  id: string;
  label: string;
  /** HTTP method of the action's route, such as `POST` or `DELETE`. */
  method: "DELETE" | "POST";
  /**
   * Route path relative to the user's security base (`.../:userId/security`), with `:param`
   * placeholders for values the caller fills from the summary, such as `/passkeys/:passkeyId`.
   */
  path: string;
}

/** The body of `GET /users/:id/security`. */
export interface AccountSecuritySummary {
  /** Recovery actions available for this user on this server. */
  actions: AccountSecurityActionSummary[];
  /** Whether the app User is linked to a Better Auth user (`betterAuthId`). */
  betterAuthLinked: boolean;
  /** `User.disabled`. */
  disabled: boolean;
  /** Better Auth `emailVerified` (`false` without a Better Auth link). */
  emailVerified: boolean;
  /**
   * Whether the app User has a legacy JWT (passport-local-mongoose) password hash. A user with
   * neither this nor a Better Auth link (a GitHub-JWT user) needs an admin-issued sign-in link.
   */
  legacyPassword: boolean;
  lastSignIn: {
    /** ISO time of the most recent session start, when known. */
    at: string | null;
    /** Better Auth `lastLoginMethod` (`email`, `github`, `passkey`, ...), when stored. */
    method: string | null;
  };
  passkeys: {count: number; items: AccountSecurityPasskey[]};
  /** Whether the user has a Better Auth email and password credential. */
  password: boolean;
  /** Linked OAuth providers (the password credential is reported as `password`). */
  providers: AccountSecurityProvider[];
  sessions: {active: number};
  twoFactor: {
    /** Unused backup codes, or `null` when 2FA is off or the count cannot be read. */
    backupCodesRemaining: number | null;
    enabled: boolean;
  };
  userId: string;
}

/** The user-facing state the security actions read to decide whether they apply. */
export type AccountSecurityState = Omit<AccountSecuritySummary, "actions">;

interface AdapterWhere {
  field: string;
  operator?: "starts_with";
  value: string;
}

interface BetterAuthAdapterLike {
  create: <T>(args: {data: Record<string, unknown>; model: string}) => Promise<T>;
  delete: (args: {model: string; where: AdapterWhere[]}) => Promise<void>;
  deleteMany: (args: {model: string; where: AdapterWhere[]}) => Promise<number>;
  findMany: <T>(args: {model: string; where: AdapterWhere[]}) => Promise<T[]>;
}

interface BetterAuthUserRow {
  email: string;
  emailVerified?: boolean | null;
  id: string;
  lastLoginMethod?: string | null;
  twoFactorEnabled?: boolean | null;
}

interface BetterAuthAccountRow {
  createdAt?: Date;
  id: string;
  providerId: string;
}

interface BetterAuthSessionRow {
  createdAt?: Date;
}

interface BetterAuthPasskeyRow {
  createdAt?: Date;
  id: string;
  name?: string | null;
}

export type VerificationStorageOption =
  | "plain"
  | "hashed"
  | {hash: (identifier: string) => unknown};

export type VerificationStoreIdentifier =
  | VerificationStorageOption
  | {default: VerificationStorageOption; overrides?: Record<string, VerificationStorageOption>};

/** The parts of Better Auth's context this service uses. */
interface BetterAuthSecurityContext {
  adapter: BetterAuthAdapterLike;
  baseURL: string;
  internalAdapter: {
    createVerificationValue: (data: {
      expiresAt: Date;
      identifier: string;
      value: string;
    }) => Promise<unknown>;
    deleteUserSessions: (userId: string) => Promise<void>;
    findAccounts: (userId: string) => Promise<BetterAuthAccountRow[]>;
    findUserByEmail: (email: string) => Promise<{user: BetterAuthUserRow} | null>;
    findUserById: (userId: string) => Promise<BetterAuthUserRow | null>;
    listSessions: (
      userId: string,
      options?: {onlyActiveSessions?: boolean}
    ) => Promise<BetterAuthSessionRow[]>;
    updateUser: (userId: string, data: Record<string, unknown>) => Promise<unknown>;
  };
  options: Parameters<typeof readBetterAuthMethods>[0]["options"] & {
    emailAndPassword?: {
      resetPasswordTokenExpiresIn?: number;
      sendResetPassword?: (data: {
        token: string;
        url: string;
        user: BetterAuthUserRow;
      }) => Promise<void>;
    };
    verification?: {storeIdentifier?: VerificationStoreIdentifier};
  };
  socialProviders: Parameters<typeof readBetterAuthMethods>[0]["socialProviders"];
}

interface ViewBackupCodesApi {
  viewBackupCodes: (args: {body: {userId: string}}) => Promise<{backupCodes?: unknown}>;
}

/** Better Auth's provider id for the email and password credential. */
export const PASSWORD_PROVIDER_ID = "credential";

/** Better Auth's default reset-link lifetime, used when `resetPasswordTokenExpiresIn` is unset. */
const DEFAULT_RESET_TOKEN_SECONDS = 3600;

const NO_BETTER_AUTH_FEATURES: Omit<AccountSecurityFeatures, "disableAccount"> = {
  betterAuth: false,
  multiSession: false,
  passkey: false,
  twoFactor: false,
};

const toIso = (value: Date | undefined): string | null => {
  if (!value) {
    return null;
  }
  return DateTime.fromJSDate(value).toUTC().toISO();
};

const isCanonicalObjectId = (id: string): boolean => {
  if (!mongoose.isValidObjectId(id)) {
    return false;
  }
  return new mongoose.Types.ObjectId(id).toString() === id;
};

/** The app User id as a string. */
export const userIdOf = (user: User): string => (user._id ? String(user._id) : user.id);

const betterAuthIdOf = (user: User): string | undefined => {
  const value = (user as User & {betterAuthId?: unknown}).betterAuthId;
  return typeof value === "string" && value.length > 0 ? value : undefined;
};

const latestIso = (sessions: BetterAuthSessionRow[]): string | null => {
  const times = sessions
    .map((session) => session.createdAt)
    .filter((createdAt): createdAt is Date => createdAt instanceof Date)
    .map((createdAt) => DateTime.fromJSDate(createdAt));
  if (times.length === 0) {
    return null;
  }
  return (
    DateTime.max(...times)
      ?.toUTC()
      .toISO() ?? null
  );
};

/** Better Auth's prefix for trusted-device verification identifiers (two-factor plugin). */
const TRUST_DEVICE_IDENTIFIER_PREFIX = "trust-device-";

/**
 * Whether Better Auth stores trusted-device identifiers as written (the default). With a hashed
 * `verification.storeIdentifier` the prefix is gone, so rows can only be matched by user id.
 */
export const storesTrustDeviceIdentifiersPlain = (
  storeIdentifier: VerificationStoreIdentifier | undefined
): boolean => storesIdentifiersPlain(storeIdentifier, TRUST_DEVICE_IDENTIFIER_PREFIX);

/** Whether Better Auth stores verification identifiers starting with `identifierPrefix` as written. */
const storesIdentifiersPlain = (
  storeIdentifier: VerificationStoreIdentifier | undefined,
  identifierPrefix: string
): boolean => {
  if (!storeIdentifier) {
    return true;
  }
  if (typeof storeIdentifier === "object" && "default" in storeIdentifier) {
    for (const [prefix, option] of Object.entries(storeIdentifier.overrides ?? {})) {
      if (identifierPrefix.startsWith(prefix)) {
        return option === "plain";
      }
    }
    return storeIdentifier.default === "plain";
  }
  return storeIdentifier === "plain";
};

/** Better Auth's prefix for password-reset verification identifiers. */
const RESET_PASSWORD_IDENTIFIER_PREFIX = "reset-password:";

/**
 * Deletes the user's trusted-device rows (`verification` rows whose value is the Better Auth user
 * id). Returns how many were removed. Rows kept only in Better Auth `secondaryStorage` are not
 * reachable here.
 */
const deleteTrustedDevices = async (
  context: BetterAuthSecurityContext,
  betterAuthId: string
): Promise<number> => {
  const where: AdapterWhere[] = [{field: "value", value: betterAuthId}];
  if (storesTrustDeviceIdentifiersPlain(context.options.verification?.storeIdentifier)) {
    where.push({
      field: "identifier",
      operator: "starts_with",
      value: TRUST_DEVICE_IDENTIFIER_PREFIX,
    });
  } else {
    logger.warn(
      "Better Auth hashes verification identifiers; resetting two-factor removes every verification row for the user"
    );
  }
  return context.adapter.deleteMany({model: "verification", where});
};

/** One user's sign-in methods as stored by Better Auth. Holds ids only, never key material. */
export interface AccountSecurityCredentials {
  /** Account rows: one per linked provider account, plus `credential` for the password. */
  accounts: {id: string; providerId: string}[];
  betterAuthId: string;
  /** Better Auth `emailVerified`. */
  emailVerified: boolean;
  /** Passkeys; always empty when the `passkey` feature is off. */
  passkeys: {id: string; name: string | null}[];
}

/** Why a password reset was not sent. */
export type PasswordResetSkipReason = "not-configured" | "not-linked";

export type PasswordResetResult = {sent: true} | {reason: PasswordResetSkipReason; sent: false};

/** Why a sign-in link was not issued. */
export type SignInLinkRefusal =
  /** Better Auth is not running, or `publicAppUrl` is unset so there is no page to link to. */
  | "not-configured"
  /** The User is linked to a Better Auth user that has a sign-in method or a verified email. */
  | "linked"
  /** The User has a legacy password; they can sign up with it instead (T3 migration). */
  | "has-password"
  /** The User has no email to create the Better Auth user with. */
  | "no-email"
  /** Another Better Auth user already uses the email. */
  | "email-taken";

export type SignInLinkResult =
  | {betterAuthId: string; expiresAt: string; issued: true; url: string}
  | {issued: false; reason: SignInLinkRefusal};

export interface AccountSecurityServiceOptions {
  getAuth: () => BetterAuthInstance | undefined;
  /** The app page base for set-password links (`BetterAuthConfig.publicAppUrl`). */
  getPublicAppUrl?: () => string | undefined;
  getUserModel: () => UserModel;
}

export interface AccountSecurityService {
  /** Deletes the user's account rows for `providerId`. Returns how many were removed. */
  deleteAccounts: (args: {betterAuthId: string; providerId: string}) => Promise<number>;
  /** Deletes one passkey, only when it belongs to `betterAuthId`. Returns whether it existed. */
  deletePasskey: (args: {betterAuthId: string; passkeyId: string}) => Promise<boolean>;
  /**
   * For a User with no Better Auth link and no legacy password: creates their Better Auth user
   * (email unverified), links it by `betterAuthId`, and returns a single-use set-password link.
   * A User whose link was never used (its Better Auth user still has no sign-in method and an
   * unverified email) gets a fresh link for the same Better Auth user; earlier links stop working.
   */
  issueSignInLink: (target: User) => Promise<SignInLinkResult>;
  /** The app User with this id, or 404 (an id that is not an ObjectId is also 404). */
  loadTarget: (userId: string) => Promise<User>;
  /** The user's sign-in methods, or `undefined` when the user has no Better Auth link. */
  readCredentials: (
    target: User,
    features: AccountSecurityFeatures
  ) => Promise<AccountSecurityCredentials | undefined>;
  readFeatures: () => Promise<AccountSecurityFeatures>;
  readState: (target: User, features: AccountSecurityFeatures) => Promise<AccountSecurityState>;
  /**
   * Removes the user's TOTP secret and backup codes and turns 2FA off. `changed` is false when
   * 2FA was already off (or the user has no Better Auth link).
   */
  resetTwoFactor: (target: User) => Promise<{changed: boolean}>;
  /**
   * Deletes every Better Auth session the user has (bearer tokens and cookie sessions alike) and,
   * when the User model has `tokenEpoch`, bumps it so legacy JWT refresh tokens stop working.
   * `revokedCount` is how many active sessions were deleted.
   */
  revokeSessions: (target: User) => Promise<{jwtRefreshRevoked: boolean; revokedCount: number}>;
  /** Sets `User.disabled`. `changed` is false when it already had that value. */
  setDisabled: (target: User, disabled: boolean) => Promise<{changed: boolean}>;
  /**
   * Mails the user a Better Auth password-reset link through the configured
   * `emailAndPassword.sendResetPassword` hook (Terreno's `sendMail` + `publicAppUrl`). The hook
   * is awaited, so a delivery failure (such as the hook's 501 for a missing `publicAppUrl`)
   * throws instead of being logged and dropped as Better Auth's own endpoint does.
   */
  sendPasswordReset: (target: User) => Promise<PasswordResetResult>;
}

// The raw collection and schema reads the service makes on the consumer's User model.
interface UserModelInternals {
  collection: {
    find: (
      filter: Record<string, unknown>,
      options?: {projection: Record<string, number>}
    ) => {limit: (count: number) => {next: () => Promise<Record<string, unknown> | null>}};
  };
  schema: {path: (name: string) => unknown};
  updateOne: (
    filter: Record<string, unknown>,
    update: Record<string, unknown>
  ) => Promise<{modifiedCount: number}>;
}

const appUserObjectId = (user: User): unknown => user._id ?? userIdOf(user);

export const createAccountSecurityService = ({
  getAuth,
  getPublicAppUrl,
  getUserModel,
}: AccountSecurityServiceOptions): AccountSecurityService => {
  const userModelInternals = (): UserModelInternals =>
    getUserModel() as unknown as UserModelInternals;

  const hasSchemaPath = (name: string): boolean => Boolean(userModelInternals().schema?.path(name));

  /** Whether the User has a passport-local-mongoose hash (stored with `select: false`). */
  const hasLegacyPassword = async (target: User): Promise<boolean> => {
    if (!hasSchemaPath("hash")) {
      return false;
    }
    const stored = await userModelInternals()
      .collection.find({_id: appUserObjectId(target)}, {projection: {hash: 1}})
      .limit(1)
      .next();
    return typeof stored?.hash === "string" && stored.hash.length > 0;
  };

  const getContext = async (): Promise<BetterAuthSecurityContext | undefined> => {
    const auth = getAuth();
    if (!auth) {
      return undefined;
    }
    return (await auth.$context) as unknown as BetterAuthSecurityContext;
  };

  const readFeatures = async (): Promise<AccountSecurityFeatures> => {
    const context = await getContext();
    const disableAccount = hasSchemaPath("disabled");
    if (!context) {
      return {...NO_BETTER_AUTH_FEATURES, disableAccount};
    }
    const methods = readBetterAuthMethods(context);
    return {
      betterAuth: true,
      disableAccount,
      multiSession: methods.multiSession,
      passkey: methods.passkey,
      twoFactor: methods.twoFactor,
    };
  };

  const loadTarget = async (userId: string): Promise<User> => {
    if (!isCanonicalObjectId(userId)) {
      throw new NotFoundError("User not found");
    }
    const user = await findOneOrNoneFor(
      getUserModel() as unknown as mongoose.Model<User>,
      {_id: userId} as never
    );
    if (!user) {
      throw new NotFoundError("User not found");
    }
    return user as unknown as User;
  };

  const countBackupCodes = async (betterAuthUserId: string): Promise<number | null> => {
    const api = getAuth()?.api as unknown as ViewBackupCodesApi;
    try {
      // Better Auth decrypts the codes with its own storage settings; only the count leaves here.
      const result = await api.viewBackupCodes({body: {userId: betterAuthUserId}});
      return Array.isArray(result.backupCodes) ? result.backupCodes.length : null;
    } catch (error: unknown) {
      logger.warn(`Could not count backup codes for Better Auth user ${betterAuthUserId}`, error);
      return null;
    }
  };

  const readState = async (
    target: User,
    features: AccountSecurityFeatures
  ): Promise<AccountSecurityState> => {
    const empty: AccountSecurityState = {
      betterAuthLinked: false,
      disabled: Boolean((target as User & {disabled?: boolean}).disabled),
      emailVerified: false,
      lastSignIn: {at: null, method: null},
      legacyPassword: await hasLegacyPassword(target),
      passkeys: {count: 0, items: []},
      password: false,
      providers: [],
      sessions: {active: 0},
      twoFactor: {backupCodesRemaining: null, enabled: false},
      userId: userIdOf(target),
    };
    const betterAuthId = betterAuthIdOf(target);
    const context = await getContext();
    if (!betterAuthId || !context) {
      return empty;
    }
    const betterAuthUser = await context.internalAdapter.findUserById(betterAuthId);
    if (!betterAuthUser) {
      return empty;
    }
    const [accounts, allSessions, activeSessions, passkeyRows] = await Promise.all([
      context.internalAdapter.findAccounts(betterAuthId),
      context.internalAdapter.listSessions(betterAuthId),
      context.internalAdapter.listSessions(betterAuthId, {onlyActiveSessions: true}),
      features.passkey
        ? context.adapter.findMany<BetterAuthPasskeyRow>({
            model: "passkey",
            where: [{field: "userId", value: betterAuthId}],
          })
        : Promise.resolve([] as BetterAuthPasskeyRow[]),
    ]);
    const twoFactorEnabled = features.twoFactor && betterAuthUser.twoFactorEnabled === true;
    return {
      ...empty,
      betterAuthLinked: true,
      emailVerified: betterAuthUser.emailVerified === true,
      lastSignIn: {
        at: latestIso(allSessions),
        method: betterAuthUser.lastLoginMethod ?? null,
      },
      passkeys: {
        count: passkeyRows.length,
        items: passkeyRows.map((row) => ({
          createdAt: toIso(row.createdAt),
          id: String(row.id),
          name: row.name ?? null,
        })),
      },
      password: accounts.some((account) => account.providerId === PASSWORD_PROVIDER_ID),
      providers: accounts
        .filter((account) => account.providerId !== PASSWORD_PROVIDER_ID)
        .map((account) => ({linkedAt: toIso(account.createdAt), providerId: account.providerId}))
        .sort((left, right) => left.providerId.localeCompare(right.providerId)),
      sessions: {active: activeSessions.length},
      twoFactor: {
        backupCodesRemaining: twoFactorEnabled ? await countBackupCodes(betterAuthId) : null,
        enabled: twoFactorEnabled,
      },
    };
  };

  const resetTwoFactor = async (target: User): Promise<{changed: boolean}> => {
    const betterAuthId = betterAuthIdOf(target);
    const context = await getContext();
    if (!betterAuthId || !context) {
      return {changed: false};
    }
    const betterAuthUser = await context.internalAdapter.findUserById(betterAuthId);
    if (!betterAuthUser) {
      return {changed: false};
    }
    const where = [{field: "userId", value: betterAuthId}];
    const rows = await context.adapter.findMany<{id: string}>({model: "twoFactor", where});
    const wasEnrolled = betterAuthUser.twoFactorEnabled === true || rows.length > 0;
    if (wasEnrolled) {
      await context.adapter.deleteMany({model: "twoFactor", where});
      await context.internalAdapter.updateUser(betterAuthId, {twoFactorEnabled: false});
    }
    // A trusted browser skips the 2FA challenge for its whole trust period, even after the
    // user enrolls again, so every trusted device goes with the reset.
    const trustedDevicesRemoved = await deleteTrustedDevices(context, betterAuthId);
    return {changed: wasEnrolled || trustedDevicesRemoved > 0};
  };

  const readCredentials = async (
    target: User,
    features: AccountSecurityFeatures
  ): Promise<AccountSecurityCredentials | undefined> => {
    const betterAuthId = betterAuthIdOf(target);
    const context = await getContext();
    if (!betterAuthId || !context) {
      return undefined;
    }
    const betterAuthUser = await context.internalAdapter.findUserById(betterAuthId);
    if (!betterAuthUser) {
      return undefined;
    }
    const [accounts, passkeyRows] = await Promise.all([
      context.internalAdapter.findAccounts(betterAuthId),
      features.passkey
        ? context.adapter.findMany<BetterAuthPasskeyRow>({
            model: "passkey",
            where: [{field: "userId", value: betterAuthId}],
          })
        : Promise.resolve([] as BetterAuthPasskeyRow[]),
    ]);
    return {
      accounts: accounts.map((account) => ({
        id: String(account.id),
        providerId: account.providerId,
      })),
      betterAuthId,
      emailVerified: betterAuthUser.emailVerified === true,
      passkeys: passkeyRows.map((row) => ({id: String(row.id), name: row.name ?? null})),
    };
  };

  const deletePasskey = async ({
    betterAuthId,
    passkeyId,
  }: {
    betterAuthId: string;
    passkeyId: string;
  }): Promise<boolean> => {
    const context = await getContext();
    if (!context) {
      return false;
    }
    // Matching on both id and owner means another user's passkey id never deletes anything.
    const where: AdapterWhere[] = [
      {field: "id", value: passkeyId},
      {field: "userId", value: betterAuthId},
    ];
    const removed = await context.adapter.deleteMany({model: "passkey", where});
    return removed > 0;
  };

  const deleteAccounts = async ({
    betterAuthId,
    providerId,
  }: {
    betterAuthId: string;
    providerId: string;
  }): Promise<number> => {
    const context = await getContext();
    if (!context) {
      return 0;
    }
    return context.adapter.deleteMany({
      model: "account",
      where: [
        {field: "userId", value: betterAuthId},
        {field: "providerId", value: providerId},
      ],
    });
  };

  /**
   * Writes the same token, identifier, and lifetime Better Auth's /request-password-reset issues,
   * so its /reset-password endpoint accepts the token, and consumes it there (single use).
   */
  const createResetToken = async (
    context: BetterAuthSecurityContext,
    betterAuthId: string
  ): Promise<{expiresAt: DateTime; token: string}> => {
    // Better Auth's generateId(24): 24 characters from a-z, A-Z, 0-9.
    const token = generateRandomString(24, "a-z", "A-Z", "0-9");
    const expiresInSeconds =
      context.options.emailAndPassword?.resetPasswordTokenExpiresIn || DEFAULT_RESET_TOKEN_SECONDS;
    const expiresAt = DateTime.now().plus({seconds: expiresInSeconds});
    await context.internalAdapter.createVerificationValue({
      expiresAt: expiresAt.toJSDate(),
      identifier: `${RESET_PASSWORD_IDENTIFIER_PREFIX}${token}`,
      value: betterAuthId,
    });
    return {expiresAt, token};
  };

  /**
   * Whether a Better Auth user looks like one `issueSignInLink` created and nobody has used yet:
   * no account rows (no password, no provider), no passkey, and an unverified email. Only such a
   * user may get a new link, so a reissue never hands over an account someone signs in to.
   */
  const isUnusedSignInLinkUser = async (
    context: BetterAuthSecurityContext,
    betterAuthUser: BetterAuthUserRow
  ): Promise<boolean> => {
    if (betterAuthUser.emailVerified === true) {
      return false;
    }
    const accounts = await context.internalAdapter.findAccounts(betterAuthUser.id);
    if (accounts.length > 0) {
      return false;
    }
    const features = await readFeatures();
    if (!features.passkey) {
      return true;
    }
    const passkeys = await context.adapter.findMany<BetterAuthPasskeyRow>({
      model: "passkey",
      where: [{field: "userId", value: betterAuthUser.id}],
    });
    return passkeys.length === 0;
  };

  /** Deletes the user's outstanding password-reset tokens, so only the newest link works. */
  const deleteResetTokens = async (
    context: BetterAuthSecurityContext,
    betterAuthId: string
  ): Promise<void> => {
    if (
      !storesIdentifiersPlain(
        context.options.verification?.storeIdentifier,
        RESET_PASSWORD_IDENTIFIER_PREFIX
      )
    ) {
      logger.warn(
        "Better Auth hashes verification identifiers; earlier sign-in links stay valid until they expire"
      );
      return;
    }
    await context.adapter.deleteMany({
      model: "verification",
      where: [
        {field: "value", value: betterAuthId},
        {field: "identifier", operator: "starts_with", value: RESET_PASSWORD_IDENTIFIER_PREFIX},
      ],
    });
  };

  const sendPasswordReset = async (target: User): Promise<PasswordResetResult> => {
    const betterAuthId = betterAuthIdOf(target);
    const context = await getContext();
    if (!betterAuthId || !context) {
      return {reason: "not-linked", sent: false};
    }
    const sendResetPassword = context.options.emailAndPassword?.sendResetPassword;
    if (!sendResetPassword) {
      return {reason: "not-configured", sent: false};
    }
    const betterAuthUser = await context.internalAdapter.findUserById(betterAuthId);
    if (!betterAuthUser) {
      return {reason: "not-linked", sent: false};
    }
    const {token} = await createResetToken(context, betterAuthId);
    await sendResetPassword({
      token,
      url: `${context.baseURL}/reset-password/${token}?callbackURL=`,
      user: betterAuthUser,
    });
    return {sent: true};
  };

  const revokeSessions = async (
    target: User
  ): Promise<{jwtRefreshRevoked: boolean; revokedCount: number}> => {
    const betterAuthId = betterAuthIdOf(target);
    const context = await getContext();
    let revokedCount = 0;
    if (betterAuthId && context) {
      const active = await context.internalAdapter.listSessions(betterAuthId, {
        onlyActiveSessions: true,
      });
      revokedCount = active.length;
      await context.internalAdapter.deleteUserSessions(betterAuthId);
    }
    const jwtRefreshRevoked = hasSchemaPath("tokenEpoch");
    if (jwtRefreshRevoked) {
      await userModelInternals().updateOne({_id: appUserObjectId(target)}, {$inc: {tokenEpoch: 1}});
    }
    return {jwtRefreshRevoked, revokedCount};
  };

  const setDisabled = async (target: User, disabled: boolean): Promise<{changed: boolean}> => {
    const result = await userModelInternals().updateOne(
      {_id: appUserObjectId(target), disabled: {$ne: disabled}},
      {$set: {disabled}}
    );
    return {changed: result.modifiedCount > 0};
  };

  const issueSignInLink = async (target: User): Promise<SignInLinkResult> => {
    const context = await getContext();
    const publicAppUrl = getPublicAppUrl?.();
    if (!context || !publicAppUrl) {
      return {issued: false, reason: "not-configured"};
    }
    const previousBetterAuthId = betterAuthIdOf(target);
    const linkedUser = previousBetterAuthId
      ? await context.internalAdapter.findUserById(previousBetterAuthId)
      : null;
    if (linkedUser && !(await isUnusedSignInLinkUser(context, linkedUser))) {
      return {issued: false, reason: "linked"};
    }
    if (await hasLegacyPassword(target)) {
      return {issued: false, reason: "has-password"};
    }
    if (linkedUser) {
      await deleteResetTokens(context, linkedUser.id);
      const {expiresAt, token} = await createResetToken(context, linkedUser.id);
      return {
        betterAuthId: linkedUser.id,
        expiresAt: expiresAt.toUTC().toISO() ?? "",
        issued: true,
        url: betterAuthResetPasswordUrl(publicAppUrl, token),
      };
    }
    const email = typeof target.email === "string" ? target.email.trim().toLowerCase() : "";
    if (!email) {
      return {issued: false, reason: "no-email"};
    }
    if (await context.internalAdapter.findUserByEmail(email)) {
      return {issued: false, reason: "email-taken"};
    }
    const name = (target as User & {name?: unknown}).name;
    const now = DateTime.now().toJSDate();
    // The adapter call skips Better Auth's user.create hooks on purpose: Terreno's guard there
    // refuses an unverified user whose email matches an unclaimed app User, which is exactly the
    // User an administrator is vouching for here. The email stays unverified: the administrator
    // hands the link over themselves, so nothing proves the user controls the inbox.
    const created = await context.adapter.create<{id: string}>({
      data: {
        createdAt: now,
        email,
        emailVerified: false,
        name: typeof name === "string" && name.length > 0 ? name : email.split("@")[0],
        updatedAt: now,
      },
      model: "user",
    });
    const betterAuthId = String(created.id);
    // Link only if nobody linked the User in the meantime (a concurrent link or sign-up).
    const linked = await userModelInternals().updateOne(
      {
        _id: appUserObjectId(target),
        betterAuthId: previousBetterAuthId ?? {$in: [null, ""]},
      },
      {$set: {betterAuthId}}
    );
    if (linked.modifiedCount === 0) {
      await context.adapter.delete({model: "user", where: [{field: "id", value: betterAuthId}]});
      return {issued: false, reason: "linked"};
    }
    const {expiresAt, token} = await createResetToken(context, betterAuthId);
    return {
      betterAuthId,
      expiresAt: expiresAt.toUTC().toISO() ?? "",
      issued: true,
      url: betterAuthResetPasswordUrl(publicAppUrl, token),
    };
  };

  return {
    deleteAccounts,
    deletePasskey,
    issueSignInLink,
    loadTarget,
    readCredentials,
    readFeatures,
    readState,
    resetTwoFactor,
    revokeSessions,
    sendPasswordReset,
    setDisabled,
  };
};
