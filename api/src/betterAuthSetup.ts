/**
 * Better Auth setup and initialization for @terreno/api.
 *
 * This module provides functions to initialize Better Auth with MongoDB,
 * create session middleware, and sync users with the application User model.
 */

import {type BetterAuthOptions, type BetterAuthPlugin, betterAuth} from "better-auth";
import {mongodbAdapter} from "better-auth/adapters/mongodb";
import {APIError as BetterAuthAPIError} from "better-auth/api";
import {toNodeHandler} from "better-auth/node";
import {bearer} from "better-auth/plugins";
import type {Application, NextFunction, Request, Response} from "express";
import mergeWith from "lodash/mergeWith";
import type {Db} from "mongodb";
import mongoose from "mongoose";
import {
  createSecurityEventsPlugin,
  recordSelfSecurityAction,
} from "./accountSecurity/securityEventHooks";
import {type HasSetPassword, setPasswordForUser, type UserModel} from "./auth";
import type {BetterAuthConfig, BetterAuthSessionData, BetterAuthUser} from "./betterAuth";
import {
  buildFeatureOptions,
  buildFeaturePlugins,
  createLinkingDisabledPlugin,
  createSignUpClosedPlugin,
  isSignUpClosed,
  resolveAppleProvider,
} from "./betterAuthFeatures";
import {createMethodsPlugin} from "./betterAuthMethods";
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

// One entry of Better Auth's `socialProviders` as Terreno builds it.
interface SocialProviderConfig {
  appBundleIdentifier?: string;
  clientId: string;
  clientSecret: string;
  disableImplicitSignUp?: boolean;
  disableSignUp?: boolean;
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

/**
 * The app page that finishes a Better Auth password reset: `{publicAppUrl}/resetPassword?token=`.
 * The built-in reset mail and the admin sign-in link both point here.
 */
export const betterAuthResetPasswordUrl = (publicAppUrl: string, token: string): string =>
  `${publicAppUrl.replace(/\/$/, "")}/resetPassword?token=${encodeURIComponent(token)}`;

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
  const resetUrl = betterAuthResetPasswordUrl(base, token);
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

  const isClosed = isSignUpClosed(config);
  const socialProviders: Record<string, SocialProviderConfig> = {};
  const addSocialProvider = (id: string, provider: SocialProviderConfig): void => {
    socialProviders[id] = isClosed
      ? {...provider, disableImplicitSignUp: true, disableSignUp: true}
      : provider;
  };

  if (config.googleOAuth) {
    addSocialProvider("google", {
      clientId: config.googleOAuth.clientId,
      clientSecret: config.googleOAuth.clientSecret,
    });
  }

  if (config.appleOAuth) {
    addSocialProvider("apple", resolveAppleProvider(config.appleOAuth));
  }

  if (config.githubOAuth) {
    addSocialProvider("github", {
      clientId: config.githubOAuth.clientId,
      clientSecret: config.githubOAuth.clientSecret,
    });
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
              await applyBetterAuthPasswordResetToJwt(
                userModel,
                user,
                request,
                passwordFromUnknown(currentBetterAuthEndpointBody())
              );
              await recordSelfSecurityAction({
                action: "password-reset",
                betterAuthUserId: user.id,
                userModel,
              });
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
  // Feature options (account linking, closed sign-up) sit between Terreno's defaults and
  // `config.options`, so an explicit option still wins.
  const merged: BetterAuthOptions = mergeWith(
    {},
    defaults,
    buildFeatureOptions(config),
    config.options,
    replaceArrays
  );

  // `never` linking (or `options` turning linking off) refuses `/link-social` up front.
  const isLinkingDisabled = merged.account?.accountLinking?.enabled === false;

  // The handoff hook mints tokens through `auth.api`, which exists only once betterAuth() returns.
  let auth: BetterAuthInstance | undefined;
  const handoffPlugins = config.oauthHandoff
    ? createOAuthHandoffPlugins({
        apiOrigin: apiOriginOf(typeof merged.baseURL === "string" ? merged.baseURL : baseURL),
        config: config.oauthHandoff,
        getAuth: () => auth,
        isLinkingDisabled,
      })
    : [];

  const created = betterAuth({
    ...merged,
    // The bearer plugin lets clients authenticate with `Authorization: Bearer <sessionToken>`
    // instead of the signed session cookie. Required for cross-origin/native clients and for
    // websocket handshakes (RealtimeApp's Better Auth socket validator forwards the handshake
    // token as a bearer header) — without it, a raw session token cannot be validated and
    // socket auth silently fails (the sync client shows perpetually "offline").
    // The methods plugin serves `GET {basePath}/terreno/methods` for login screens.
    // With a user model, the app user sync plugin links or creates the app User as each session
    // is created (see createAppUserSyncPlugin), and the security events plugin records the
    // user's own security changes (see createSecurityEventsPlugin).
    // Feature plugins (two-factor, passkey, ...) come before `config.plugins`, so a consumer
    // plugin can still hook around them. The closed sign-up plugin follows `config.plugins` so
    // its init reaches the providers `genericOAuth` registers.
    // The handoff plugins come last so their callback hook sees the final redirect.
    plugins: [
      bearer(),
      createMethodsPlugin(),
      ...buildFeaturePlugins(config),
      ...(isLinkingDisabled ? [createLinkingDisabledPlugin()] : []),
      ...(userModel
        ? [createAppUserSyncPlugin(userModel), createSecurityEventsPlugin(userModel)]
        : []),
      ...(config.plugins ?? []),
      ...(isClosed ? [createSignUpClosedPlugin()] : []),
      ...handoffPlugins,
    ],
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

// Better Auth keeps the AsyncLocalStorage of the endpoint being served on this global; the
// store holds the endpoint's context, including its parsed body. `tryGetCurrentAuthEndpointContext`
// in `@better-auth/core/context` reads the same store, but that package is not a direct
// dependency of @terreno/api and `better-auth` does not re-export it.
const BETTER_AUTH_GLOBAL = Symbol.for("better-auth:global");

interface BetterAuthGlobalLike {
  context?: {endpointContextAsyncStorage?: {getStore: () => unknown}};
}

/**
 * The parsed body of the Better Auth endpoint now being served (HTTP or a direct `auth.api`
 * call), or `undefined` outside one. Better Auth reads an HTTP body before its handler runs, so a
 * hook such as `onPasswordReset` can no longer read it from the request.
 */
export const currentBetterAuthEndpointBody = (): unknown => {
  const betterAuthGlobal = (globalThis as Record<symbol, BetterAuthGlobalLike | undefined>)[
    BETTER_AUTH_GLOBAL
  ];
  const store = betterAuthGlobal?.context?.endpointContextAsyncStorage?.getStore();
  if (!store || typeof store !== "object") {
    return undefined;
  }
  return (store as {body?: unknown}).body;
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
 *
 * `capturedPassword` is the new password from the parsed body of the reset endpoint being served
 * (`newPassword`, or `password` for the email-OTP and phone-number resets). Without it the
 * password is read from `request`, which works only while the request body is unread.
 */
export const applyBetterAuthPasswordResetToJwt = async (
  userModel: UserModel,
  betterAuthUser: {email?: string; id?: string},
  request: PasswordResetRequestLike | undefined,
  capturedPassword?: string
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
  const password = capturedPassword || (await readPasswordFromBetterAuthResetRequest(request));
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
 * The stable title (and Better Auth error message) for a sign-in whose unverified email matches
 * an app User it cannot prove it owns.
 */
export const VERIFY_EMAIL_TO_USE_ACCOUNT = "Verify your email to use this account";

/** The Better Auth error code (JSON `code`, OAuth redirect `error`) for the same refusal. */
const VERIFY_EMAIL_ERROR_CODE = "VERIFY_EMAIL_TO_USE_ACCOUNT";

/**
 * Syncs a Better Auth user to the application User model.
 * Creates or updates the user as needed.
 */
// Loose shape used when mutating Mongoose user documents during Better Auth sync.
// The fields are added by the consumer's user schema (via baseUserPlugin or similar).
interface MutableUserDoc {
  admin?: boolean;
  email?: string;
  name?: string;
  betterAuthId?: string;
  oauthProvider?: string | null;
  id?: string;
  save: () => Promise<unknown>;
}

export interface SyncBetterAuthUserOptions {
  /**
   * The plaintext password from the sign-up or sign-in request being served. When an app User
   * with the same email is not linked yet and the Better Auth email is unverified, the user is
   * linked only if this password verifies against that User's passport-local-mongoose hash.
   * Never stored or logged.
   */
  password?: string;
}

// passport-local-mongoose's instance method (v8+ returns a promise).
type PassportAuthenticate = (
  password: string
) => Promise<{error?: unknown; user?: unknown}> | undefined;

// The parts of a Mongoose model the legacy password check needs beyond `UserModel`.
interface HydratingUserModel {
  collection?: {
    find: (filter: Record<string, unknown>) => {
      limit: (count: number) => {next: () => Promise<Record<string, unknown> | null>};
    };
  };
  hydrate?: (doc: Record<string, unknown>) => unknown;
}

/**
 * Whether `password` verifies against the passport-local-mongoose hash of a legacy app User.
 * Users without a hash (GitHub-JWT users) and models without the plugin never match.
 *
 * The check runs on a detached copy of the stored document whose `save` does nothing, so
 * passport's `limitAttempts` bookkeeping never counts a Better Auth sign-up against the user's
 * JWT login: a stranger signing up with the victim's email cannot lock the victim out.
 */
const legacyPasswordMatches = async (
  userModel: UserModel,
  user: MutableUserDoc,
  password?: string
): Promise<boolean> => {
  const model = userModel as unknown as HydratingUserModel;
  const id = (user as unknown as {_id?: unknown})._id;
  if (!password || id === undefined || !model.collection || !model.hydrate) {
    return false;
  }
  try {
    // The raw driver read includes the `select: false` hash and salt fields.
    const stored = await model.collection.find({_id: id}).limit(1).next();
    if (!stored) {
      return false;
    }
    const probe = model.hydrate(stored) as {authenticate?: PassportAuthenticate; save?: unknown};
    if (typeof probe.authenticate !== "function") {
      return false;
    }
    probe.save = async (): Promise<unknown> => probe;
    const result = await probe.authenticate(password);
    return Boolean(result?.user);
  } catch (error) {
    logger.debug(`[better-auth] Legacy password check failed: ${error}`);
    return false;
  }
};

interface AppUserClaim {
  betterAuthId?: string;
  emailVerified: boolean;
  password?: string;
}

/**
 * Whether a Better Auth user may claim the app User that has its email: the User already
 * carries its id (a concurrent request linked it), the email is verified, or the password
 * verifies against the User's legacy passport hash. Anyone can sign up unverified with someone
 * else's email, so nothing weaker counts.
 */
const mayClaimAppUser = async (
  userModel: UserModel,
  user: MutableUserDoc,
  claim: AppUserClaim
): Promise<boolean> =>
  (claim.betterAuthId !== undefined && user.betterAuthId === claim.betterAuthId) ||
  claim.emailVerified ||
  (await legacyPasswordMatches(userModel, user, claim.password));

const verifyEmailRefusal = (): APIError =>
  new APIError({
    code: "verify-email-to-use-account",
    disableExternalErrorTracking: true,
    status: 409,
    title: VERIFY_EMAIL_TO_USE_ACCOUNT,
  });

const escapeRegExp = (value: string): string => value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

/**
 * The app User with this email, ignoring case. Better Auth lowercases emails, while legacy
 * Users may have been stored as typed ("Jane@Example.com"); an exact match would miss them,
 * skip the claim guard, and insert a second User.
 */
const findAppUserByEmail = async (
  userModel: UserModel,
  email: string
): Promise<MutableUserDoc | null> =>
  (await findOneOrNoneFor(userModel, {
    email: {$options: "i", $regex: `^${escapeRegExp(email)}$`},
  } as never)) as unknown as MutableUserDoc | null;

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
    const userByEmail = await findAppUserByEmail(userModel, betterAuthUser.email);
    if (userByEmail) {
      const mayLink = await mayClaimAppUser(userModel, userByEmail, {
        betterAuthId: betterAuthUser.id,
        emailVerified: betterAuthUser.emailVerified === true,
        password: options.password,
      });
      if (!mayLink) {
        throw verifyEmailRefusal();
      }
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
    // resolveBetterAuthAppUser recover from it, so it is not an error worth alerting on. An
    // unverified email that matches an existing User is an expected refusal.
    if ((error as {code?: number}).code === 11000) {
      logger.debug(`Better Auth user was created concurrently: ${error}`);
    } else if (isVerifyEmailRefusal(error)) {
      logger.info(`[better-auth] Refused to link unverified Better Auth user ${betterAuthUser.id}`);
    } else {
      logger.error(`Error syncing Better Auth user: ${error}`);
    }
    throw error;
  }
};

const isVerifyEmailRefusal = (error: unknown): boolean =>
  isAPIError(error) && error.status === 409 && error.message === VERIFY_EMAIL_TO_USE_ACCOUNT;

// The parts of Better Auth's endpoint context the session hook reads.
interface SessionHookContext {
  body?: unknown;
  params?: Record<string, string | undefined>;
  path?: string;
}

const bodyString = (body: unknown, key: string): string | undefined => {
  if (!body || typeof body !== "object") {
    return undefined;
  }
  const value = (body as Record<string, unknown>)[key];
  return typeof value === "string" && value.length > 0 ? value : undefined;
};

// The social or generic OAuth provider a session is being created for, if any.
const oauthProviderFromContext = (context: SessionHookContext | null): string | undefined => {
  const path = context?.path ?? "";
  if (path.startsWith("/callback/")) {
    return context?.params?.id;
  }
  if (path === "/sign-in/social") {
    return bodyString(context?.body, "provider");
  }
  return undefined;
};

// The plaintext password, only on the email requests that carry one.
const passwordFromContext = (context: SessionHookContext | null): string | undefined => {
  if (context?.path !== "/sign-up/email" && context?.path !== "/sign-in/email") {
    return undefined;
  }
  return bodyString(context.body, "password");
};

interface SessionHookAdapter {
  internalAdapter: {findUserById: (userId: string) => Promise<BetterAuthUser | null>};
}

const verifyEmailConflict = (): BetterAuthAPIError =>
  new BetterAuthAPIError("CONFLICT", {
    code: VERIFY_EMAIL_ERROR_CODE,
    message: VERIFY_EMAIL_TO_USE_ACCOUNT,
  });

// The app User with this email that no Better Auth user has claimed yet (or another one has).
const findUnclaimedAppUser = async (
  userModel: UserModel,
  email: string,
  betterAuthId?: string
): Promise<MutableUserDoc | null> => {
  const appUser = await findAppUserByEmail(userModel, email);
  if (!appUser || (betterAuthId !== undefined && appUser.betterAuthId === betterAuthId)) {
    return null;
  }
  return appUser;
};

/**
 * The plugin that guards and syncs the app User while the request that proves who the user is
 * (its password, its provider) is still in hand. Session middleware only sees later requests,
 * which carry neither.
 *
 * - Before a Better Auth user is created: when an app User already has the email, creation is
 *   refused with 409 `VERIFY_EMAIL_TO_USE_ACCOUNT` (an OAuth callback redirects with that
 *   `error`) unless the provider verified the email or the sign-up password verifies against
 *   that User's passport hash. Nothing is left behind (no user, account, or verification mail),
 *   so a later verification cannot hand an attacker's password the victim's User.
 * - Before a session is created, the app User is synced: the OAuth provider id fills
 *   `oauthProvider`, and on `/sign-up/email` and `/sign-in/email` the plaintext password lets an
 *   unverified user claim a legacy User. A refusal fails the sign-in with the same 409.
 * - A failed link that a password was proving fails the sign-in (500 `APP_USER_LINK_FAILED`), so
 *   no session exists that would be refused on every request. Any other sync failure is logged
 *   and the session proceeds; the session middleware retries the sync on the next request.
 */
export const createAppUserSyncPlugin = (userModel: UserModel): BetterAuthPlugin => {
  return {
    id: "terreno-app-user-sync",
    init: (authContext) => {
      const {internalAdapter} = authContext as unknown as SessionHookAdapter;
      return {
        options: {
          databaseHooks: {
            session: {
              create: {
                before: async (session, rawContext): Promise<void> => {
                  const context = rawContext as SessionHookContext | null;
                  const betterAuthUser = await internalAdapter.findUserById(session.userId);
                  if (!betterAuthUser) {
                    return;
                  }
                  const password = passwordFromContext(context);
                  try {
                    await syncBetterAuthUser(
                      userModel,
                      betterAuthUser,
                      oauthProviderFromContext(context),
                      {password}
                    );
                  } catch (error) {
                    if (isVerifyEmailRefusal(error)) {
                      throw verifyEmailConflict();
                    }
                    if ((error as {code?: number}).code === 11000) {
                      return;
                    }
                    logger.error(`[better-auth] App user sync on sign-in failed: ${error}`);
                    const isPasswordLink =
                      password !== undefined &&
                      (await findUnclaimedAppUser(
                        userModel,
                        betterAuthUser.email,
                        betterAuthUser.id
                      )) !== null;
                    if (isPasswordLink) {
                      throw new BetterAuthAPIError("INTERNAL_SERVER_ERROR", {
                        code: "APP_USER_LINK_FAILED",
                        message: "Could not link your account. Try again.",
                      });
                    }
                  }
                },
              },
            },
            user: {
              create: {
                before: async (user, rawContext): Promise<void> => {
                  const email = typeof user.email === "string" ? user.email : "";
                  const appUser = email ? await findUnclaimedAppUser(userModel, email) : null;
                  if (!appUser) {
                    return;
                  }
                  const mayClaim = await mayClaimAppUser(userModel, appUser, {
                    emailVerified: user.emailVerified === true,
                    password: passwordFromContext(rawContext as SessionHookContext | null),
                  });
                  if (!mayClaim) {
                    logger.info("[better-auth] Refused a sign-up for an existing app user's email");
                    throw verifyEmailConflict();
                  }
                },
              },
            },
          },
        },
      };
    },
  } satisfies BetterAuthPlugin;
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
 * Kept for compatibility; it does nothing. `createBetterAuth` wires the app User sync itself
 * when given a `userModel`: the `terreno-app-user-sync` plugin guards Better Auth user creation
 * and syncs the app User as each session is created (see `createAppUserSyncPlugin`), and
 * `createBetterAuthSessionMiddleware` retries the sync on later requests.
 */
export const setupBetterAuthUserSync = (_auth: BetterAuthInstance, _userModel: UserModel): void => {
  logger.debug("Better Auth user sync configured (via the terreno-app-user-sync plugin)");
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
