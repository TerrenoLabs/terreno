import {randomUUID} from "node:crypto";
import express from "express";
import jwt, {type JwtPayload} from "jsonwebtoken";
import {DateTime} from "luxon";
import type {Model, ObjectId, Query} from "mongoose";
import ms, {type StringValue} from "ms";
import passport from "passport";
import {Strategy as AnonymousStrategy} from "passport-anonymous";
import {
  type JwtFromRequestFunction,
  Strategy as JwtStrategy,
  type StrategyOptions,
} from "passport-jwt";
import {Strategy as LocalStrategy} from "passport-local";
import {addAuthRecoveryRoutes, sendVerificationEmail} from "./authRecovery";
import {AuthToken} from "./authTokens";
import {APIError, apiErrorMiddleware, errorMessage} from "./errors";
import type {AuthOptions} from "./expressServer";
import {logger} from "./logger";
import {isJwtCredentialExchangePath} from "./rateLimit/policies";
import {
  getSessionIdFromJwtPayload,
  type JwtSessionPayload,
  setRequestContext,
  updateRequestContextFromRequest,
} from "./requestContext";

export interface User {
  _id: ObjectId | string;
  id: string;
  // Whether the user should be treated as an admin or not.
  // Admins can have extra abilities in permissions declarations
  admin: boolean;
  /**
   * We support anonymous users, which do not yet have login information.
   * This can be helpful for pre-signup users.
   */
  isAnonymous?: boolean;
  /** Login identifier; present on passport-local and Better Auth app users. */
  email?: string;
  /** Incremented on password reset so outstanding refresh tokens fail. */
  tokenEpoch?: number;
  /** Set by emailVerificationPlugin; login may require this when requireEmailVerification is on. */
  emailVerified?: boolean;
}

export interface UserModel extends Model<User> {
  createAnonymousUser?: (id?: string) => Promise<User>;
  // Allows additional setup during signup. This will be passed the rest of req.body from the signup
  postCreate?: (body: Record<string, unknown>) => Promise<void>;

  // Provided by passport-local-mongoose:
  createStrategy(): passport.Strategy;
  serializeUser(): (user: User, cb: (err: unknown, id?: unknown) => void) => void;
  deserializeUser(): (username: string, cb: (err: unknown, user?: User | null) => void) => void;
  findByUsername(
    username: string,
    findOpts: boolean | {selectHashSaltFields?: boolean}
  ): Query<User | null, User>;
}

export interface GenerateTokensOptions {
  sessionId?: string;
}

export const authenticateMiddleware = (anonymous = false) => {
  const strategies = ["jwt"];
  if (anonymous) {
    strategies.push("anonymous");
  }
  return (req: express.Request, res: express.Response, next: express.NextFunction) => {
    if (req.user) {
      return next();
    }
    // Failures use a custom callback rather than passport's `failWithError`:
    // passport's internal AuthenticationError touches `arguments.callee`,
    // which throws a TypeError in strict-mode contexts — inside
    // `bun build --compile` binaries that turned every 401 into a 500. The
    // plain Error("Unauthorized") below is what apiUnauthorizedMiddleware
    // matches on, so the response contract is unchanged.
    // (The anonymous strategy calls pass(), which skips this callback and
    // continues the chain with no user — same as before.)
    return passport.authenticate(
      strategies,
      {session: false},
      (
        err: Error | null,
        user: NonNullable<express.Request["user"]> | false | null,
        info: unknown
      ) => {
        if (err) {
          return next(err);
        }
        if (!user) {
          return next(new Error("Unauthorized"));
        }
        req.user = user;
        // req.logIn used to populate authInfo; keep that passport-public API
        // intact for downstream consumers.
        req.authInfo = (info ?? {}) as Express.AuthInfo;
        return next();
      }
    )(req, res, next);
  };
};

/**
 * User fields that confer authority or skip security gates. Self-service requests
 * (anonymous signup, `PATCH /me`) must never set them, or any caller could grant
 * themselves admin, an RBAC role, a verified email, or a reset epoch. Elevate users
 * through the admin API or `access.roles.assign` instead.
 */
export const PRIVILEGED_USER_FIELDS = [
  "admin",
  "roles",
  "organizationIds",
  "emailVerified",
  "tokenEpoch",
] as const;

/**
 * Removes {@link PRIVILEGED_USER_FIELDS} from a self-service body. Fields are dropped rather
 * than rejected so clients that echo a whole user object back still succeed.
 */
export const stripPrivilegedUserFields = (
  body: Record<string, unknown>,
  context: string
): Record<string, unknown> => {
  const sanitized: Record<string, unknown> = {};
  const dropped: string[] = [];
  for (const [key, value] of Object.entries(body)) {
    if ((PRIVILEGED_USER_FIELDS as readonly string[]).includes(key)) {
      dropped.push(key);
      continue;
    }
    sanitized[key] = value;
  }
  if (dropped.length > 0) {
    logger.warn(`Ignored privileged user fields on ${context}: ${dropped.join(", ")}`);
  }
  return sanitized;
};

const isEmailUpdateChangingMailbox = (currentEmail: unknown, nextEmail: unknown): boolean => {
  if (typeof currentEmail !== "string" || typeof nextEmail !== "string") {
    return false;
  }
  return currentEmail.trim().toLowerCase() !== nextEmail.trim().toLowerCase();
};

const omitPrivilegedFieldsFromObject = (item: unknown, allowAdminWrite: boolean): unknown => {
  if (!item || typeof item !== "object" || Array.isArray(item)) {
    return item;
  }
  const record = item as Record<string, unknown>;
  const fieldsToDrop = PRIVILEGED_USER_FIELDS.filter(
    (field) => field in record && !(field === "admin" && allowAdminWrite)
  );
  if (fieldsToDrop.length === 0) {
    return item;
  }
  const next = {...record};
  for (const field of fieldsToDrop) {
    Reflect.deleteProperty(next, field);
  }
  logger.warn(`Ignored privileged User fields on a modelRouter write: ${fieldsToDrop.join(", ")}`);
  return next;
};

/**
 * When RBAC is enabled, authority-bearing User fields must not flow through ordinary mongoose
 * writes on `/users`, sync, or MCP. AdminApp captures role assignments before this runs and
 * explicitly marks authorized legacy-admin writes after its additional checks.
 */
export const omitUserRolesFromWriteBody = (
  modelName: string,
  accessControl: unknown,
  body: unknown,
  allowAdminWrite = false
): unknown => {
  if (modelName !== "User" || !accessControl || body == null) {
    return body;
  }
  if (Array.isArray(body)) {
    return body.map((item) => omitPrivilegedFieldsFromObject(item, allowAdminWrite));
  }
  return omitPrivilegedFieldsFromObject(body, allowAdminWrite);
};

export const signupUser = async (
  userModel: UserModel,
  email: string,
  password: string,
  body?: Record<string, unknown>
) => {
  // Strip email and password from the body. They can cause mongoose to throw an error if strict is
  // set.
  const {email: _email, password: _password, ...rawBody} = body ?? {};
  const bodyRest = stripPrivilegedUserFields(rawBody, "signup");

  try {
    const registrableModel = userModel as UserModel & {
      register(
        user: Record<string, unknown>,
        password: string
      ): Promise<
        User & {
          postCreate?: (body: Record<string, unknown>) => Promise<void>;
          save: () => Promise<unknown>;
        }
      >;
    };
    const user = await registrableModel.register({email, ...bodyRest}, password);

    if (user.postCreate) {
      try {
        await user.postCreate(bodyRest);
      } catch (error: unknown) {
        logger.error(`Error in user.postCreate: ${error}`);
        throw error;
      }
    }
    await user.save();
    return user;
  } catch (error: unknown) {
    const message = errorMessage(error);
    throw new APIError({title: message});
  }
};

/** A user document exposing passport-local-mongoose's `setPassword`. */
export interface HasSetPassword {
  _id?: unknown;
  id?: string;
  setPassword: (
    password: string,
    callback?: (error?: unknown) => void
  ) => Promise<unknown> | unknown;
}

/** Upper bound on password length accepted by {@link setPasswordForUser} (D5). */
export const MAX_PASSWORD_LENGTH = 256;

/** Optional audit context for {@link setPasswordForUser} — never includes the password itself. */
export interface SetPasswordAuditContext {
  /** The admin performing the change, when set via an admin-only route. */
  adminId?: unknown;
}

/**
 * Sets a password on a passport-local-mongoose user document, returning a Promise regardless of
 * whether the installed version of `setPassword` is callback- or promise-based. Newer versions
 * return a promise while older ones only invoke the callback; this helper normalizes both and
 * rejects after `timeoutMs` (default 15s) if neither settles. Call `user.save()` afterwards to
 * persist the new hash/salt.
 *
 * Rejects synchronously (before touching `setPassword`) when `password` exceeds
 * {@link MAX_PASSWORD_LENGTH} characters. When `audit.adminId` is provided (an admin-initiated
 * password change), logs a `logger.info` audit line with the admin id, target user id, and
 * timestamp — NEVER the password itself.
 */
export const setPasswordForUser = async (
  user: HasSetPassword,
  password: string,
  timeoutMs = 15_000,
  audit?: SetPasswordAuditContext
): Promise<void> => {
  if (password.length > MAX_PASSWORD_LENGTH) {
    throw new APIError({
      status: 400,
      title: `Password must be at most ${MAX_PASSWORD_LENGTH} characters`,
    });
  }
  if (audit?.adminId !== undefined) {
    const targetUserId = user._id ?? user.id ?? "unknown";
    logger.info(
      `[auth] Admin ${String(audit.adminId)} set password for user ${String(targetUserId)} ` +
        `at ${DateTime.now().toISO()}`
    );
  }
  await new Promise<void>((resolve, reject) => {
    let isSettled = false;
    const timeout = setTimeout(() => {
      if (isSettled) {
        return;
      }
      isSettled = true;
      reject(new Error("Timed out while setting password"));
    }, timeoutMs);

    const resolveOnce = (): void => {
      if (isSettled) {
        return;
      }
      isSettled = true;
      clearTimeout(timeout);
      resolve();
    };

    const rejectOnce = (error: unknown): void => {
      if (isSettled) {
        return;
      }
      isSettled = true;
      clearTimeout(timeout);
      reject(error);
    };

    try {
      const maybePromise = user.setPassword(password, (error?: unknown) => {
        if (error) {
          rejectOnce(error);
          return;
        }
        resolveOnce();
      });

      if (maybePromise && typeof (maybePromise as Promise<unknown>).then === "function") {
        (maybePromise as Promise<unknown>).then(resolveOnce).catch(rejectOnce);
      }
    } catch (error) {
      rejectOnce(error);
    }
  });
};

/**
 * Returns the duration when `ms` can parse it, otherwise logs and returns undefined so the caller
 * keeps its default. Signing a token with an unparseable duration throws instead.
 */
const validateDuration = (envName: string, value: string): StringValue | undefined => {
  if (ms(value as StringValue) === undefined) {
    logger.error(`${envName} is not a valid duration: "${value}". Using the default instead.`);
    return undefined;
  }
  return value as StringValue;
};

/**
 * Generates both an access token (JWT) and a refresh token for a given user.
 *
 * This function:
 * - Signs the user's `_id` into a short-lived JWT (`token`)
 *   and a long-lived refresh token (`refreshToken`).
 * - Supports custom expiration logic
 *   and payload customization via `AuthOptions`.
 * - Reads token secrets, issuer,
 *   and default expirations from environment variables.
 * - Returns `{ token, refreshToken }`,
 *   or `{ token: null, refreshToken: null }` if the user is missing.
 *
 * It is exported to allow external implementations (such as OAuth integrations or other
 * authentication providers) to reuse and customize the same token generation logic.
 * This ensures consistent and secure token issuance across different authentication flows.
 */
export const generateTokens = async (
  user: unknown,
  authOptions?: AuthOptions,
  options: GenerateTokensOptions = {}
) => {
  const tokenSecretOrKey = process.env.TOKEN_SECRET;
  if (!tokenSecretOrKey) {
    throw new APIError({status: 500, title: "TOKEN_SECRET must be set in env."});
  }
  const tokenUser = user as {_id?: ObjectId | string} | null | undefined;
  if (!tokenUser?._id) {
    logger.warn("No user found for token generation");
    return {refreshToken: null, token: null};
  }
  const sessionId = options.sessionId ?? randomUUID();
  const authUser = user as User;
  let payload: Record<string, unknown> = {
    id: String(tokenUser._id),
    sid: sessionId,
    te: authUser.tokenEpoch ?? 0,
  };
  if (authOptions?.generateJWTPayload) {
    payload = {...authOptions.generateJWTPayload(authUser), ...payload};
  }
  const tokenOptions: jwt.SignOptions = {
    expiresIn: "15m",
  };
  if (authOptions?.generateTokenExpiration) {
    tokenOptions.expiresIn = authOptions.generateTokenExpiration(authUser);
  } else if (process.env.TOKEN_EXPIRES_IN) {
    const expiresIn = validateDuration("TOKEN_EXPIRES_IN", process.env.TOKEN_EXPIRES_IN);
    if (expiresIn) {
      tokenOptions.expiresIn = expiresIn;
    }
  }
  if (process.env.TOKEN_ISSUER) {
    tokenOptions.issuer = process.env.TOKEN_ISSUER;
  }

  const token = jwt.sign(payload, tokenSecretOrKey, tokenOptions);
  const refreshTokenSecretOrKey = process.env.REFRESH_TOKEN_SECRET;
  let refreshToken: string | undefined;
  if (refreshTokenSecretOrKey) {
    const refreshTokenOptions: jwt.SignOptions = {
      expiresIn: "30d",
    };
    if (authOptions?.generateRefreshTokenExpiration) {
      refreshTokenOptions.expiresIn = authOptions.generateRefreshTokenExpiration(authUser);
    } else if (process.env.REFRESH_TOKEN_EXPIRES_IN) {
      const expiresIn = validateDuration(
        "REFRESH_TOKEN_EXPIRES_IN",
        process.env.REFRESH_TOKEN_EXPIRES_IN
      );
      if (expiresIn) {
        refreshTokenOptions.expiresIn = expiresIn;
      }
    }
    refreshToken = jwt.sign(payload, refreshTokenSecretOrKey, refreshTokenOptions);
  } else {
    logger.info("REFRESH_TOKEN_SECRET not set so refresh tokens will not be issued");
  }
  return {refreshToken, sessionId, token};
};

export const setupAuth = (app: express.Application, userModel: UserModel): void => {
  if (!userModel.createStrategy) {
    throw new APIError({status: 500, title: "setupAuth userModel must have .createStrategy()"});
  }

  passport.use(new AnonymousStrategy());
  passport.use(userModel.createStrategy());
  passport.use(
    "signup",
    new LocalStrategy(
      {
        passReqToCallback: true,
        passwordField: "password",
        usernameField: "email",
      },
      async (req, email, password, done) => {
        try {
          done(undefined, await signupUser(userModel, email, password, req.body));
        } catch (error) {
          return done(error);
        }
      }
    ) as passport.Strategy
  );

  const customTokenExtractor: JwtFromRequestFunction = (req) => {
    let token: string | null = null;
    if (req?.cookies?.jwt) {
      token = req.cookies.jwt;
    } else if (req?.headers?.authorization) {
      token = req?.headers?.authorization.split(" ")[1];
    }
    return token;
  };

  if (process.env.TOKEN_SECRET) {
    if (process.env.NODE_ENV !== "test") {
      logger.debug("Setting up JWT Authentication");
    }

    const secretOrKey = process.env.TOKEN_SECRET;
    const jwtOpts: StrategyOptions = {
      issuer: process.env.TOKEN_ISSUER,
      jwtFromRequest: customTokenExtractor,
      secretOrKey,
    };
    passport.use(
      "jwt",
      new JwtStrategy(jwtOpts, async (jwtPayload: JwtPayload, done) => {
        let user: User | null = null;
        if (!jwtPayload) {
          return done(null, false);
        }
        try {
          user = await userModel.findById(jwtPayload.id);
        } catch (error) {
          logger.warn(`[jwt] Error finding user from id: ${error}`);
          return done(error, false);
        }
        if (user) {
          return done(null, user);
        }
        if (userModel.createAnonymousUser) {
          logger.info("[jwt] Creating anonymous user");
          user = await userModel.createAnonymousUser();
          return done(null, user);
        }
        logger.info("[jwt] No user found from token");
        return done(null, false);
      }) as passport.Strategy
    );
  }

  // Adds req.user to the request. This may wind up duplicating requests with passport,
  // but passport doesn't give us req.user early enough.
  const decodeJWTMiddleware = async (
    req: express.Request,
    res: express.Response,
    next: express.NextFunction
  ) => {
    if (!process.env.TOKEN_SECRET) {
      return next();
    }

    // Login, signup, and refresh exchange credentials. A stale access JWT in
    // Authorization / the jwt cookie must not 401 before those handlers run.
    if (isJwtCredentialExchangePath(req)) {
      return next();
    }

    // Allow requests with a "Secret" prefix to pass through since this is a string value,
    // not a jwt that needs to be decoded
    if (req?.headers?.authorization?.split(" ")[0] === "Secret") {
      return next();
    }

    const token = customTokenExtractor(req);

    // For some reason, our app will happily put null into the authorization header when logging
    // out then back in.
    if (!token || token === "null" || token === "undefined") {
      return next();
    }

    let decoded: jwt.JwtPayload | undefined;

    try {
      decoded = jwt.verify(token, process.env.TOKEN_SECRET, {
        issuer: process.env.TOKEN_ISSUER,
      }) as jwt.JwtPayload;
    } catch (error: unknown) {
      // A bearer token that is not a JWT at all (e.g. a Better Auth opaque session
      // token) is not ours to reject — fall through so a later auth layer (Better
      // Auth session middleware) or the route's own permissions can handle it.
      // Detect this by decoding the token's header/payload structure (D1) rather
      // than counting dot-delimited segments: an opaque token can coincidentally
      // contain exactly two dots, and a malformed-but-JWT-shaped string can fail
      // this same check for the wrong reason — `jwt.decode` parses the actual
      // base64url JSON structure of each segment, which dot-counting cannot.
      // Genuine JWTs that fail verification (malformed/expired) still return 401 so the
      // client's token-refresh flow is preserved.
      if (jwt.decode(token, {complete: true}) === null) {
        return next();
      }
      const userText = req.user?._id ? ` for user ${req.user._id} ` : "";
      const expiredAt =
        error && typeof error === "object" && "expiredAt" in error
          ? (error as {expiredAt?: unknown}).expiredAt
          : undefined;
      const message = errorMessage(error);
      const details = `[jwt] Error decoding token${userText}: ${error}, expired at ${expiredAt}, current time: ${DateTime.now().toMillis()}`;
      logger.debug(details);
      return res.status(401).json({details, message});
    }
    if (decoded?.id) {
      const sessionId = getSessionIdFromJwtPayload(decoded as JwtSessionPayload);
      req.authTokenPayload = decoded as JwtSessionPayload;
      if (sessionId) {
        req.sessionId = sessionId;
        setRequestContext({sessionId});
      }
      try {
        const user = await userModel.findById(decoded.id);
        req.user = user as unknown as express.Request["user"];
        updateRequestContextFromRequest(req, res);
        if (req.user?.disabled) {
          logger.warn(`[jwt] User ${req.user.id} is disabled`);
          return res.status(401).json({status: 401, title: "User is disabled"});
        }
      } catch (error) {
        logger.warn(`[jwt] Error finding user from id: ${error}`);
      }
    }
    return next();
  };
  app.use(decodeJWTMiddleware);
  // express 5's urlencoded() handler type doesn't match RequestHandler directly
  app.use(express.urlencoded({extended: false}) as unknown as express.RequestHandler);
};

export const addAuthRoutes = (
  app: express.Application,
  userModel: UserModel,
  authOptions?: AuthOptions
): void => {
  const router = express.Router();
  router.post("/login", async (req, res, next) => {
    passport.authenticate(
      "local",
      {session: false},
      async (
        err: Error | null,
        user: (User & {type?: string}) | false | null,
        info: {message?: string} | undefined
      ) => {
        if (err) {
          logger.error(`Error logging in: ${err}`);
          return next(err);
        }
        if (!user) {
          logger.warn(`Invalid login: ${info}`);
          return res.status(401).json({message: info?.message});
        }
        if (authOptions?.requireEmailVerification && user.emailVerified !== true) {
          return next(
            new APIError({
              code: "email-not-verified",
              status: 403,
              title: "Email is not verified",
            })
          );
        }
        if (process.env.NODE_ENV !== "test") {
          logger.info(`User logged in: ${user._id}, type: ${user.type || "N/A"}`);
        }
        const tokens = await generateTokens(user, authOptions);
        if (tokens.sessionId) {
          setRequestContext({sessionId: tokens.sessionId, userId: String(user._id)});
          res.setHeader("X-Session-ID", tokens.sessionId);
        }
        return res.json({
          data: {refreshToken: tokens.refreshToken, token: tokens.token, userId: user?._id},
        });
      }
    )(req, res, next);
  });

  router.post("/refresh_token", async (req, res) => {
    if (!req.body.refreshToken) {
      logger.error(
        `No refresh token provided, must provide refreshToken in body, user id: ${req.user?.id}`
      );
      return res
        .status(401)
        .json({message: "No refresh token provided, must provide refreshToken in body"});
    }
    if (!process.env.REFRESH_TOKEN_SECRET) {
      logger.error(`No REFRESH_TOKEN_SECRET set, cannot refresh token, user id: ${req.user?.id}`);
      return res.status(401).json({message: "No REFRESH_TOKEN_SECRET set, cannot refresh token"});
    }
    const refreshTokenSecretOrKey = process.env.REFRESH_TOKEN_SECRET;
    let decoded: JwtPayload;
    try {
      decoded = jwt.verify(req.body.refreshToken, refreshTokenSecretOrKey) as JwtPayload;
    } catch (error: unknown) {
      logger.error(`Error refreshing token for user ${req.user?.id}: ${error}`);
      const message = errorMessage(error);
      return res.status(401).json({message});
    }
    if (decoded?.id) {
      const user = await userModel.findById(decoded.id);
      const tokenEpoch = typeof decoded.te === "number" ? decoded.te : 0;
      const userEpoch = (user as User | null)?.tokenEpoch ?? 0;
      if (!user || tokenEpoch !== userEpoch) {
        logger.error(`Invalid refresh token, user id: ${req.user?.id}`);
        return res.status(401).json({message: "Invalid refresh token"});
      }
      const sessionId = getSessionIdFromJwtPayload(decoded as JwtSessionPayload);
      const tokens = await generateTokens(user, authOptions, {sessionId});
      if (tokens.sessionId) {
        setRequestContext({
          sessionId: tokens.sessionId,
          userId: user?._id ? String(user._id) : undefined,
        });
        res.setHeader("X-Session-ID", tokens.sessionId);
      }
      logger.debug(`Refreshed token for ${user?.id}`);
      return res.json({data: {refreshToken: tokens.refreshToken, token: tokens.token}});
    }
    logger.error(`Invalid refresh token, user id: ${req.user?.id}`);
    return res.status(401).json({message: "Invalid refresh token"});
  });

  const signupDisabled = process.env.SIGNUP_DISABLED === "true";
  if (!signupDisabled) {
    router.post(
      "/signup",
      // Custom callback instead of `failWithError` — passport's internal
      // AuthenticationError is unusable in strict-mode bundles (see
      // authenticateMiddleware). Strategy errors (e.g. duplicate email) pass
      // through unchanged; a bare failure (missing credentials) is a 400.
      (req: express.Request, res: express.Response, next: express.NextFunction) => {
        passport.authenticate(
          "signup",
          {session: false},
          (err: Error | null, user: NonNullable<express.Request["user"]> | false | null) => {
            if (err) {
              return next(err);
            }
            if (!user) {
              return next(new APIError({status: 400, title: "Missing credentials"}));
            }
            req.user = user;
            return next();
          }
        )(req, res, next);
      },
      async (req: express.Request, res: express.Response) => {
        if (req.user && authOptions?.emailVerification !== false) {
          try {
            await sendVerificationEmail(req.user, authOptions);
          } catch (error: unknown) {
            logger.error("[auth] Failed to send verification mail after signup", {error});
          }
        }
        const tokens = await generateTokens(req.user, authOptions);
        if (tokens.sessionId) {
          setRequestContext({
            sessionId: tokens.sessionId,
            userId: req.user?._id ? String(req.user._id) : undefined,
          });
          res.setHeader("X-Session-ID", tokens.sessionId);
        }
        return res.json({
          data: {refreshToken: tokens.refreshToken, token: tokens.token, userId: req.user?._id},
        });
      }
    );
  }
  app.set("etag", false);
  app.use("/auth", router);
  addAuthRecoveryRoutes(app, userModel, authOptions);
};

export const addMeRoutes = (
  app: express.Application,
  userModel: UserModel,
  _authOptions?: AuthOptions,
  accessControl?: import("./rbac/types").AnyTerrenoAccess
): void => {
  const router = express.Router();
  router.get("/me", authenticateMiddleware(), async (req, res) => {
    if (!req.user?.id) {
      logger.debug("Not user found for /me");
      return res.sendStatus(401);
    }
    const data = await userModel.findById(req.user.id);
    if (!data) {
      logger.debug("Not user data found for /me");
      return res.sendStatus(404);
    }
    const dataObject = data.toObject() as unknown as Record<string, unknown>;
    dataObject.id = data._id;
    if (accessControl) {
      const withRoles = data as unknown as {roles?: string[]};
      dataObject.roles = withRoles.roles ?? [];
      dataObject.permissions = await accessControl.getPermissions({
        user: data as unknown as User,
      });
    }
    return res.json({data: dataObject});
  });

  router.patch("/me", authenticateMiddleware(), async (req, res) => {
    if (!req.user?.id) {
      return res.sendStatus(401);
    }
    const doc = await userModel.findById(req.user.id);
    if (!doc) {
      return res.sendStatus(404);
    }
    // TODO support limited updates for profile.
    // try {
    //   body = transform(req.body, "update", req.user);
    // } catch (e) {
    //   return res.status(403).send({message: (e as Error).message});
    // }
    try {
      const update = stripPrivilegedUserFields(req.body ?? {}, "PATCH /auth/me");
      const isMailboxChange = isEmailUpdateChangingMailbox(doc.email, update.email);
      Object.assign(doc, update);
      if (isMailboxChange) {
        await AuthToken.invalidateUnusedFor({_id: String(doc._id)}, "passwordReset");
        if (userModel.schema.path("emailVerified") !== undefined) {
          doc.emailVerified = false;
          await AuthToken.invalidateUnusedFor({_id: String(doc._id)}, "emailVerification");
        }
      }
      await doc.save();

      const dataObject = doc.toObject() as unknown as Record<string, unknown>;
      dataObject.id = doc._id;
      return res.json({data: dataObject});
    } catch (error: unknown) {
      const message = errorMessage(error);
      return res.status(403).send({message});
    }
  });

  app.set("etag", false);
  app.use("/auth", router);
  app.use(apiErrorMiddleware);
};
