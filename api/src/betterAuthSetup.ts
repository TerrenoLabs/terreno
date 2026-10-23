/**
 * Better Auth setup and initialization for @terreno/api.
 *
 * This module provides functions to initialize Better Auth with MongoDB,
 * create session middleware, and sync users with the application User model.
 */

import {type BetterAuthOptions, betterAuth} from "better-auth";
import {mongodbAdapter} from "better-auth/adapters/mongodb";
import {toNodeHandler} from "better-auth/node";
import {bearer} from "better-auth/plugins";
import type {Application, NextFunction, Request, Response} from "express";
import mergeWith from "lodash/mergeWith";
import type {Db} from "mongodb";
import mongoose from "mongoose";
import {type HasSetPassword, setPasswordForUser, type UserModel} from "./auth";
import type {BetterAuthConfig, BetterAuthSessionData, BetterAuthUser} from "./betterAuth";
import {createOAuthHandoffPlugins} from "./betterAuthOAuthHandoff";
import {APIError, isAPIError} from "./errors";
import type {AuthRecoveryMail} from "./expressServer";
import {logger} from "./logger";
import {findOneOrNoneFor} from "./plugins";
import {updateRequestContextFromRequest} from "./requestContext";

/**
 * The Better Auth instance type.
 */
export type BetterAuthInstance = ReturnType<typeof betterAuth>;

/**
 * Options for creating a Better Auth instance.
 */
// Minimal shape we use from the MongoDB native client returned by mongoose connection
export interface MongoClientLike {
  db: () => Db;
}

export interface CreateBetterAuthOptions {
  config: BetterAuthConfig;
  mongoClient: MongoClientLike;
  userModel?: UserModel;
}

const FALLBACK_AUTH_MAIL = {
  resetPassword: {
    html: '<p><a href="{{resetUrl}}">Reset your password</a></p>',
    subject: "Reset your password",
    text: "Reset your password using this link: {{resetUrl}}",
  },
  verifyEmail: {
    html: '<p><a href="{{verifyUrl}}">Verify your email</a></p>',
    subject: "Verify your email",
    text: "Verify your email using this link: {{verifyUrl}}",
  },
} as const;

const interpolateMail = (value: string, data: Record<string, string>): string =>
  value.replace(/{{\s*([A-Za-z0-9_]+)\s*}}/g, (_match: string, key: string): string => {
    return data[key] ?? "";
  });

const fallbackRenderAuthMail = ({
  publicAppUrl,
  templateId,
  token,
  templates,
}: {
  publicAppUrl: string;
  templateId: "resetPassword" | "verifyEmail";
  token: string;
  templates?: BetterAuthConfig["authMailTemplates"];
}): {html?: string; subject: string; text?: string} => {
  const template = templates?.[templateId] ?? FALLBACK_AUTH_MAIL[templateId];
  const base = publicAppUrl.replace(/\/$/, "");
  const resetUrl = `${base}/resetPassword?token=${encodeURIComponent(token)}`;
  const verifyUrl = `${base}/verifyEmail?token=${encodeURIComponent(token)}`;
  const data = {publicAppUrl: base, resetUrl, token, verifyUrl};
  return {
    html: template.html === undefined ? undefined : interpolateMail(template.html, data),
    subject: interpolateMail(template.subject, data),
    text: template.text === undefined ? undefined : interpolateMail(template.text, data),
  };
};

export const createBetterAuthEmailHooks = (config: BetterAuthConfig) => {
  if (!config.sendMail) {
    return undefined;
  }
  const sendMail = config.sendMail;
  const deliver = async (
    templateId: "resetPassword" | "verifyEmail",
    user: {email: string},
    token: string
  ): Promise<void> => {
    const publicAppUrl = config.publicAppUrl ?? "";
    if (!publicAppUrl) {
      logger.error("[auth] publicAppUrl is required to send Better Auth recovery mail");
      throw new APIError({
        status: 501,
        title: "publicAppUrl is required to send recovery mail",
      });
    }
    const rendered = (config.renderAuthMail ?? fallbackRenderAuthMail)({
      publicAppUrl,
      templateId,
      templates: config.authMailTemplates,
      token,
    });
    const message: AuthRecoveryMail = {
      html: rendered.html,
      subject: rendered.subject,
      text: rendered.text ?? "",
      to: user.email,
    };
    await sendMail(message);
  };
  return {
    sendResetPassword: async ({
      token,
      user,
    }: {
      token: string;
      url: string;
      user: {email: string};
    }): Promise<void> => {
      await deliver("resetPassword", user, token);
    },
    sendVerificationEmail: async ({
      token,
      user,
    }: {
      token: string;
      url: string;
      user: {email: string};
    }): Promise<void> => {
      await deliver("verifyEmail", user, token);
    },
  };
};

// The API's own origin, which the OAuth handoff never sends a token to.
const apiOriginOf = (url: string): string => {
  let origin: string;
  try {
    origin = new URL(url).origin;
  } catch {
    origin = "null";
  }
  if (origin === "null") {
    throw new APIError({
      detail: `"${url}" is not an absolute http(s) URL`,
      status: 500,
      title: "BETTER_AUTH_URL must be an absolute URL",
    });
  }
  return origin;
};

/**
 * Creates a Better Auth instance with MongoDB adapter.
 */
export const createBetterAuth = (options: CreateBetterAuthOptions): BetterAuthInstance => {
  const {config, mongoClient} = options;

  const secret = config.secret || process.env.BETTER_AUTH_SECRET;
  if (!secret) {
    throw new APIError({
      status: 500,
      title: "BETTER_AUTH_SECRET must be set in env or config.secret must be provided.",
    });
  }

  const baseURL = config.baseURL || process.env.BETTER_AUTH_URL;
  if (!baseURL) {
    throw new APIError({
      status: 500,
      title: "BETTER_AUTH_URL must be set in env or config.baseURL must be provided.",
    });
  }

  const basePath = config.basePath ?? "/api/auth";

  const socialProviders: Record<string, {clientId: string; clientSecret: string}> = {};

  if (config.googleOAuth) {
    socialProviders.google = {
      clientId: config.googleOAuth.clientId,
      clientSecret: config.googleOAuth.clientSecret,
    };
  }

  if (config.appleOAuth) {
    socialProviders.apple = {
      clientId: config.appleOAuth.clientId,
      clientSecret: config.appleOAuth.clientSecret,
    };
  }

  if (config.githubOAuth) {
    socialProviders.github = {
      clientId: config.githubOAuth.clientId,
      clientSecret: config.githubOAuth.clientSecret,
    };
  }

  const emailHooks = createBetterAuthEmailHooks(config);
  const userModel = options.userModel;

  const defaults: BetterAuthOptions = {
    advanced: config.crossDomainCookies
      ? {
          defaultCookieAttributes: {
            httpOnly: true,
            sameSite: "none",
            secure: true,
          },
        }
      : undefined,
    basePath,
    baseURL,
    database: mongodbAdapter(mongoClient.db()),
    emailAndPassword: {
      enabled: true,
      revokeSessionsOnPasswordReset: true,
      ...(emailHooks ? {sendResetPassword: emailHooks.sendResetPassword} : {}),
      ...(userModel
        ? {
            onPasswordReset: async (
              {user}: {user: {email?: string; id?: string}},
              request?: PasswordResetRequestLike
            ): Promise<void> => {
              await applyBetterAuthPasswordResetToJwt(userModel, user, request);
            },
          }
        : {}),
    },
    ...(emailHooks
      ? {
          emailVerification: {
            sendOnSignUp: true,
            sendVerificationEmail: emailHooks.sendVerificationEmail,
          },
        }
      : {}),
    rateLimit: config.disableRateLimit ? {enabled: false} : undefined,
    secret,
    session: {
      cookieCache: {
        enabled: true,
        maxAge: 5 * 60, // 5 minutes
      },
    },
    socialProviders: Object.keys(socialProviders).length > 0 ? socialProviders : undefined,
    trustedOrigins: config.trustedOrigins ?? [],
  };

  // Arrays from `options` replace Terreno's; lodash would otherwise merge them by index.
  const replaceArrays = (_target: unknown, source: unknown): unknown =>
    Array.isArray(source) ? source : undefined;
  const merged: BetterAuthOptions = mergeWith({}, defaults, config.options, replaceArrays);

  // The handoff hook mints tokens through `auth.api`, which exists only once betterAuth() returns.
  let auth: BetterAuthInstance | undefined;
  const handoffPlugins = config.oauthHandoff
    ? createOAuthHandoffPlugins({
        apiOrigin: apiOriginOf(typeof merged.baseURL === "string" ? merged.baseURL : baseURL),
        config: config.oauthHandoff,
        getAuth: () => auth,
      })
    : [];

  const created = betterAuth({
    ...merged,
    // The bearer plugin lets clients authenticate with `Authorization: Bearer <sessionToken>`
    // instead of the signed session cookie. Required for cross-origin/native clients and for
    // websocket handshakes (RealtimeApp's Better Auth socket validator forwards the handshake
    // token as a bearer header) — without it, a raw session token cannot be validated and
    // socket auth silently fails (the sync client shows perpetually "offline").
    // The handoff plugins come last so their callback hook sees the final redirect.
    plugins: [bearer(), ...(config.plugins ?? []), ...handoffPlugins],
  });

  // Cast through unknown: enabling the bearer plugin narrows betterAuth()'s inferred
  // return type to a plugin-specific tuple that no longer matches the plugin-agnostic
  // BetterAuthInstance alias, though the runtime instance is a valid better-auth instance.
  auth = created as unknown as BetterAuthInstance;
  return auth;
};

interface BetterAuthCredentialAccount {
  providerId?: string;
}

interface BetterAuthUserLookup {
  user?: {id?: string};
}

interface BetterAuthPasswordResetContext {
  internalAdapter: {
    createAccount: (account: {
      accountId: string;
      password: string;
      providerId: string;
      userId: string;
    }) => Promise<unknown>;
    deleteUserSessions: (userId: string) => Promise<unknown>;
    findAccounts: (userId: string) => Promise<BetterAuthCredentialAccount[]>;
    findUserByEmail: (email: string) => Promise<BetterAuthUserLookup | null>;
    findUserById: (userId: string) => Promise<{id?: string} | null>;
    updatePassword: (userId: string, password: string) => Promise<unknown>;
  };
  password: {hash: (password: string) => Promise<string>};
}

/**
 * After JWT `POST /auth/resetPassword`, update the Better Auth credential hash
 * (when that user exists) and delete Better Auth sessions so a dual-enrolled
 * account cannot keep the old password or stolen sessions.
 */
export const applyJwtPasswordResetToBetterAuth = async (
  auth: BetterAuthInstance,
  user: {betterAuthId?: string; email?: string},
  password: string
): Promise<void> => {
  const ctx = (await auth.$context) as BetterAuthPasswordResetContext;
  let betterAuthUserId = typeof user.betterAuthId === "string" ? user.betterAuthId : "";
  if (!betterAuthUserId && typeof user.email === "string" && user.email.length > 0) {
    const found = await ctx.internalAdapter.findUserByEmail(user.email);
    betterAuthUserId = found?.user?.id ?? "";
  }
  if (!betterAuthUserId) {
    const byId = user.betterAuthId
      ? await ctx.internalAdapter.findUserById(user.betterAuthId)
      : null;
    betterAuthUserId = byId?.id ?? "";
  }
  if (!betterAuthUserId) {
    return;
  }
  const hashedPassword = await ctx.password.hash(password);
  const accounts = await ctx.internalAdapter.findAccounts(betterAuthUserId);
  const hasCredential = accounts.some((account) => account.providerId === "credential");
  if (hasCredential) {
    await ctx.internalAdapter.updatePassword(betterAuthUserId, hashedPassword);
  } else {
    await ctx.internalAdapter.createAccount({
      accountId: betterAuthUserId,
      password: hashedPassword,
      providerId: "credential",
      userId: betterAuthUserId,
    });
  }
  await ctx.internalAdapter.deleteUserSessions(betterAuthUserId);
};

interface PasswordResetRequestLike {
  body?: unknown;
  clone?: () => {json: () => Promise<unknown>};
}

const passwordFromUnknown = (value: unknown): string => {
  if (!value || typeof value !== "object") {
    return "";
  }
  const record = value as Record<string, unknown>;
  const candidate = record.newPassword ?? record.password;
  if (typeof candidate !== "string") {
    return "";
  }
  return candidate;
};

export const readPasswordFromBetterAuthResetRequest = async (
  request: PasswordResetRequestLike | undefined
): Promise<string> => {
  if (!request) {
    return "";
  }
  const attached = passwordFromUnknown(request.body);
  if (attached.length > 0) {
    return attached;
  }
  if (typeof request.clone !== "function") {
    return "";
  }
  try {
    return passwordFromUnknown(await request.clone().json());
  } catch {
    return "";
  }
};

/**
 * After Better Auth password reset, update the JWT/passport hash and bump
 * `tokenEpoch` so a dual-enrolled account cannot keep the old password or
 * outstanding refresh tokens.
 */
export const applyBetterAuthPasswordResetToJwt = async (
  userModel: UserModel,
  betterAuthUser: {email?: string; id?: string},
  request: PasswordResetRequestLike | undefined
): Promise<void> => {
  const betterAuthId = typeof betterAuthUser.id === "string" ? betterAuthUser.id : "";
  const email = typeof betterAuthUser.email === "string" ? betterAuthUser.email : "";
  let appUser = betterAuthId ? await findOneOrNoneFor(userModel, {betterAuthId} as never) : null;
  if (!appUser && email.length > 0) {
    appUser = await findOneOrNoneFor(userModel, {email} as never);
  }
  if (!appUser) {
    return;
  }
  const password = await readPasswordFromBetterAuthResetRequest(request);
  if (!password) {
    logger.error("[auth] Better Auth password reset did not include a password to sync to JWT");
    throw new APIError({
      status: 500,
      title: "Password reset could not sync to JWT credentials",
    });
  }
  await setPasswordForUser(appUser as unknown as HasSetPassword, password);
  appUser.tokenEpoch = (appUser.tokenEpoch ?? 0) + 1;
  await appUser.save();
};

/**
 * Creates Express middleware that extracts the Better Auth session
 * and populates req.user with the application User model.
 */
export const createBetterAuthSessionMiddleware = (
  auth: BetterAuthInstance,
  userModel?: UserModel
) => {
  return async (req: Request, _res: Response, next: NextFunction): Promise<void> => {
    try {
      const session = await auth.api.getSession({
        headers: req.headers as Record<string, string>,
      });

      if (session?.user && session?.session) {
        const betterAuthUser = session.user as BetterAuthUser;

        const reqWithSession = req as Request & {
          user?: Request["user"];
          betterAuthSession?: BetterAuthSessionData;
        };
        if (userModel) {
          const {isDisabled, user} = await resolveBetterAuthAppUser({betterAuthUser, userModel});
          if (isDisabled) {
            // A disabled account's live sessions stop authenticating. Falling through as
            // anonymous, rather than answering 401 here, keeps Better Auth's own routes
            // (sign-out, signing in as someone else) reachable, since TerrenoApp mounts this
            // middleware before them.
            logger.debug(`[better-auth] User ${user.id} is disabled, ignoring their session`);
          } else {
            reqWithSession.user = user as unknown as Request["user"];
            reqWithSession.betterAuthSession = session as unknown as BetterAuthSessionData;
            updateRequestContextFromRequest(req);
          }
        } else {
          // No user model - just attach the Better Auth user directly
          reqWithSession.user = {
            _id: betterAuthUser.id,
            admin: false,
            betterAuthId: betterAuthUser.id,
            email: betterAuthUser.email,
            id: betterAuthUser.id,
            name: betterAuthUser.name,
          } as unknown as Request["user"];
          reqWithSession.betterAuthSession = session as unknown as BetterAuthSessionData;
          updateRequestContextFromRequest(req);
        }
      }

      next();
    } catch (error) {
      logger.debug(`Better Auth session extraction error: ${error}`);
      next();
    }
  };
};

/**
 * Syncs a Better Auth user to the application User model.
 * Creates or updates the user as needed.
 */
// Loose shape used when mutating Mongoose user documents during Better Auth sync.
// The fields are added by the consumer's user schema (via baseUserPlugin or similar).
interface MutableUserDoc {
  _id?: unknown;
  admin?: boolean;
  email?: string;
  emailVerified?: boolean;
  name?: string;
  betterAuthId?: string;
  oauthProvider?: string | null;
  id?: string;
  save: () => Promise<unknown>;
}

export interface SyncBetterAuthUserOptions {
  /**
   * Link an existing app user by email even when Better Auth has not verified the address or
   * the row is bound to another Better Auth id. Only for operator-run seeds that create the
   * Better Auth account themselves; never set it for a request-driven sync.
   */
  trustEmail?: boolean;
}

/**
 * An email alone does not prove the caller owns an existing app user. Link by email only when
 * Better Auth verified the address and the row is not bound to another Better Auth account.
 */
const assertEmailLinkAllowed = (
  userByEmail: MutableUserDoc,
  betterAuthUser: BetterAuthUser
): void => {
  if (betterAuthUser.emailVerified === true && !userByEmail.betterAuthId) {
    return;
  }
  throw new APIError({
    detail: "Verify the email address before signing in to the existing account.",
    disableExternalErrorTracking: true,
    status: 409,
    title: "An account with this email already exists",
  });
};

/**
 * A legacy password on a row whose email was never verified may have been set by someone who
 * does not own the mailbox. Once the verified owner links the row, that password and the
 * refresh tokens issued from it stop working.
 */
const revokeUnprovenLegacyPassword = async (
  userModel: UserModel,
  userByEmail: MutableUserDoc
): Promise<void> => {
  if (userByEmail.emailVerified === true || userModel.schema.path("hash") === undefined) {
    return;
  }
  const hasLegacyPassword = await userModel.exists({
    _id: userByEmail._id,
    hash: {$exists: true, $ne: null},
  } as never);
  if (!hasLegacyPassword) {
    return;
  }
  const bumpEpoch = userModel.schema.path("tokenEpoch") !== undefined;
  await userModel.updateOne(
    {_id: userByEmail._id} as never,
    {
      $unset: {hash: 1, salt: 1},
      ...(bumpEpoch ? {$inc: {tokenEpoch: 1}} : {}),
    } as never
  );
  logger.info(
    `Revoked an unverified legacy password while linking Better Auth user ${userByEmail.id}`
  );
};

export const syncBetterAuthUser = async (
  userModel: UserModel,
  betterAuthUser: BetterAuthUser,
  oauthProvider?: string,
  options: SyncBetterAuthUserOptions = {}
): Promise<MutableUserDoc> => {
  try {
    const existingUser = (await findOneOrNoneFor(userModel, {
      betterAuthId: betterAuthUser.id,
    })) as unknown as MutableUserDoc | null;

    if (existingUser) {
      // Update existing user if needed
      existingUser.email = betterAuthUser.email;
      if (betterAuthUser.name) {
        existingUser.name = betterAuthUser.name;
      }
      await existingUser.save();
      return existingUser;
    }

    // Check if user exists by email (migration case)
    const userByEmail = (await findOneOrNoneFor(userModel, {
      email: betterAuthUser.email,
    })) as unknown as MutableUserDoc | null;
    if (userByEmail?.betterAuthId === betterAuthUser.id) {
      // A concurrent first contact created this row between the two lookups.
      return userByEmail;
    }
    if (userByEmail) {
      if (!options.trustEmail) {
        assertEmailLinkAllowed(userByEmail, betterAuthUser);
        await revokeUnprovenLegacyPassword(userModel, userByEmail);
      }
      // Link existing user to Better Auth
      userByEmail.betterAuthId = betterAuthUser.id;
      if (oauthProvider) {
        userByEmail.oauthProvider = oauthProvider;
      }
      await userByEmail.save();
      return userByEmail;
    }

    // Use Better Auth ID as _id when it's a valid ObjectId (MongoDB adapter) so frontend IDs match
    const useAsId = mongoose.isValidObjectId(betterAuthUser.id) ? {_id: betterAuthUser.id} : {};
    const UserDocumentConstructor = userModel as unknown as new (
      doc: Record<string, unknown>
    ) => MutableUserDoc;
    const newUser = new UserDocumentConstructor({
      ...useAsId,
      admin: false,
      betterAuthId: betterAuthUser.id,
      email: betterAuthUser.email,
      name: betterAuthUser.name || betterAuthUser.email.split("@")[0],
      ...(oauthProvider ? {oauthProvider} : {}),
    });
    await newUser.save();
    logger.info(`Created new user from Better Auth: ${newUser.id}`);
    return newUser;
  } catch (error) {
    // A duplicate key means a concurrent request created the user first; callers such as
    // resolveBetterAuthAppUser recover from it, so it is not an error worth alerting on.
    if ((error as {code?: number}).code === 11000) {
      logger.debug(`Better Auth user was created concurrently: ${error}`);
    } else if (isAPIError(error) && error.status === 409) {
      logger.warn(`Refused to link Better Auth user ${betterAuthUser.id} by email: ${error.title}`);
    } else {
      logger.error(`Error syncing Better Auth user: ${error}`);
    }
    throw error;
  }
};

export interface ResolveBetterAuthAppUserOptions {
  userModel: UserModel;
  betterAuthUser: BetterAuthUser;
}

export interface ResolvedBetterAuthAppUser {
  user: MutableUserDoc & {disabled?: boolean};
  isDisabled: boolean;
}

/**
 * Finds the application user for a Better Auth session user, creating it on first contact,
 * and reports whether the account is disabled. Every Better Auth entry point (REST session
 * middleware, socket handshake) goes through this so they accept and refuse the same users.
 */
export const resolveBetterAuthAppUser = async ({
  userModel,
  betterAuthUser,
}: ResolveBetterAuthAppUserOptions): Promise<ResolvedBetterAuthAppUser> => {
  const findByBetterAuthId = async (): Promise<ResolvedBetterAuthAppUser["user"] | null> =>
    (await findOneOrNoneFor(userModel, {
      betterAuthId: betterAuthUser.id,
    })) as unknown as ResolvedBetterAuthAppUser["user"] | null;

  let user = await findByBetterAuthId();
  if (!user) {
    try {
      user = (await syncBetterAuthUser(
        userModel,
        betterAuthUser
      )) as ResolvedBetterAuthAppUser["user"];
    } catch (error) {
      // Right after sign-up the socket handshake and the first REST calls race to create the
      // same user; the loser's insert hits the unique `_id` (or `betterAuthId`) index.
      const isDuplicateKey = (error as {code?: number}).code === 11000;
      const createdConcurrently = isDuplicateKey ? await findByBetterAuthId() : null;
      if (!createdConcurrently) {
        throw error;
      }
      user = createdConcurrently;
    }
  }
  return {isDisabled: Boolean(user.disabled), user};
};

/**
 * Mounts Better Auth routes on the Express app.
 */
export const mountBetterAuthRoutes = (
  app: Application,
  auth: BetterAuthInstance,
  basePath = "/api/auth"
): void => {
  const handler = toNodeHandler(auth);

  // Mount at the base path with wildcard
  app.all(`${basePath}/*path`, (req, res) => {
    return handler(req, res);
  });

  logger.info(`Better Auth routes mounted at ${basePath}/*`);
};

/**
 * Gets the MongoDB client from the mongoose connection.
 */
export const getMongoClientFromMongoose = (): MongoClientLike => {
  const connection = mongoose.connection;
  const client = (connection as unknown as {client?: MongoClientLike}).client;
  if (!client) {
    throw new APIError({
      status: 500,
      title: "Mongoose is not connected. Ensure MongoDB connection is established first.",
    });
  }
  return client;
};

/**
 * Sets up Better Auth user sync hooks.
 * This ensures users created/updated in Better Auth are synced to the application User model.
 *
 * Note: Better Auth doesn't have built-in event hooks, so we rely on the session middleware
 * to create users on first session access.
 */
export const setupBetterAuthUserSync = (_auth: BetterAuthInstance, _userModel: UserModel): void => {
  // Better Auth v1.x doesn't expose event hooks for user creation.
  // User sync is handled in createBetterAuthSessionMiddleware when a session is accessed.
  // This function is a placeholder for future versions that may support hooks.
  logger.debug("Better Auth user sync configured (via session middleware)");
};

/**
 * Extracts Better Auth session data from the request.
 */
export const getBetterAuthSession = (req: Request): BetterAuthSessionData | null => {
  return (req as Request & {betterAuthSession?: BetterAuthSessionData}).betterAuthSession ?? null;
};

/**
 * Checks if the request has a valid Better Auth session.
 */
export const hasBetterAuthSession = (req: Request): boolean => {
  return Boolean((req as Request & {betterAuthSession?: BetterAuthSessionData}).betterAuthSession);
};
