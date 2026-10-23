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
import type {BetterAuthInstance} from "../betterAuthSetup";
import {NotFoundError} from "../errors";
import {logger} from "../logger";
import {findOneOrNoneFor} from "../plugins";

/** Which Better Auth features this server has on. All `false` without Better Auth. */
export interface AccountSecurityFeatures {
  betterAuth: boolean;
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
}

/** The body of `GET /users/:id/security`. */
export interface AccountSecuritySummary {
  /** Recovery actions available for this user on this server. */
  actions: AccountSecurityActionSummary[];
  /** Whether the app User is linked to a Better Auth user (`betterAuthId`). */
  betterAuthLinked: boolean;
  /** `User.disabled`. */
  disabled: boolean;
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
    findAccounts: (userId: string) => Promise<BetterAuthAccountRow[]>;
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

const NO_FEATURES: AccountSecurityFeatures = {
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
): boolean => {
  if (!storeIdentifier) {
    return true;
  }
  if (typeof storeIdentifier === "object" && "default" in storeIdentifier) {
    for (const [prefix, option] of Object.entries(storeIdentifier.overrides ?? {})) {
      if (TRUST_DEVICE_IDENTIFIER_PREFIX.startsWith(prefix)) {
        return option === "plain";
      }
    }
    return storeIdentifier.default === "plain";
  }
  return storeIdentifier === "plain";
};

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

export interface AccountSecurityServiceOptions {
  getAuth: () => BetterAuthInstance | undefined;
  getUserModel: () => UserModel;
}

export interface AccountSecurityService {
  /** Deletes the user's account rows for `providerId`. Returns how many were removed. */
  deleteAccounts: (args: {betterAuthId: string; providerId: string}) => Promise<number>;
  /** Deletes one passkey, only when it belongs to `betterAuthId`. Returns whether it existed. */
  deletePasskey: (args: {betterAuthId: string; passkeyId: string}) => Promise<boolean>;
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
   * Mails the user a Better Auth password-reset link through the configured
   * `emailAndPassword.sendResetPassword` hook (Terreno's `sendMail` + `publicAppUrl`). The hook
   * is awaited, so a delivery failure (such as the hook's 501 for a missing `publicAppUrl`)
   * throws instead of being logged and dropped as Better Auth's own endpoint does.
   */
  sendPasswordReset: (target: User) => Promise<PasswordResetResult>;
}

export const createAccountSecurityService = ({
  getAuth,
  getUserModel,
}: AccountSecurityServiceOptions): AccountSecurityService => {
  const getContext = async (): Promise<BetterAuthSecurityContext | undefined> => {
    const auth = getAuth();
    if (!auth) {
      return undefined;
    }
    return (await auth.$context) as unknown as BetterAuthSecurityContext;
  };

  const readFeatures = async (): Promise<AccountSecurityFeatures> => {
    const context = await getContext();
    if (!context) {
      return NO_FEATURES;
    }
    const methods = readBetterAuthMethods(context);
    return {
      betterAuth: true,
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
      lastSignIn: {at: null, method: null},
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
    // The same token, identifier, and lifetime Better Auth's /request-password-reset issues, so
    // its /reset-password endpoint accepts the link.
    // Better Auth's generateId(24): 24 characters from a-z, A-Z, 0-9.
    const token = generateRandomString(24, "a-z", "A-Z", "0-9");
    const expiresInSeconds =
      context.options.emailAndPassword?.resetPasswordTokenExpiresIn || DEFAULT_RESET_TOKEN_SECONDS;
    await context.internalAdapter.createVerificationValue({
      expiresAt: DateTime.now().plus({seconds: expiresInSeconds}).toJSDate(),
      identifier: `reset-password:${token}`,
      value: betterAuthId,
    });
    await sendResetPassword({
      token,
      url: `${context.baseURL}/reset-password/${token}?callbackURL=`,
      user: betterAuthUser,
    });
    return {sent: true};
  };

  return {
    deleteAccounts,
    deletePasskey,
    loadTarget,
    readCredentials,
    readFeatures,
    readState,
    resetTwoFactor,
    sendPasswordReset,
  };
};
