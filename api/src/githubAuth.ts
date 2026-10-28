import {createHmac, randomBytes, timingSafeEqual} from "node:crypto";
import type express from "express";
import {Router} from "express";
import {DateTime} from "luxon";
import type {Schema} from "mongoose";
import passport from "passport";
import {Strategy as GitHubStrategy, type Profile} from "passport-github2";
import {generateTokens, isUserDisabled, type User, type UserModel} from "./auth";
import {APIError} from "./errors";
import type {AuthOptions} from "./expressServer";
import {logger} from "./logger";
import {findOneOrNoneFor} from "./plugins";

/** Options for configuring GitHub OAuth authentication */
export interface GitHubAuthOptions {
  /** GitHub OAuth Client ID */
  clientId: string;
  /** GitHub OAuth Client Secret */
  clientSecret: string;
  /** Callback URL for GitHub OAuth (e.g., https://yourapp.com/auth/github/callback) */
  callbackURL: string;
  /** OAuth scopes to request from GitHub. Defaults to ["user:email"] */
  scope?: string[];
  /**
   * Whether to allow linking GitHub to existing accounts.
   * If true, authenticated users can link their GitHub account.
   * Defaults to true.
   */
  allowAccountLinking?: boolean;
  /**
   * Redirect targets allowed for the `returnTo` query parameter of `GET /auth/github`. Each entry
   * is an exact http(s) origin (`https://app.example.com`) or an exact custom-scheme authority
   * (`myapp://auth`). A `returnTo` that matches no entry is rejected with 400. When this is
   * unset or empty, `returnTo` is ignored and the callback always returns JSON.
   */
  allowedReturnTo?: string[];
  /**
   * Custom function to handle user creation or lookup from GitHub profile.
   * If not provided, a default implementation will be used.
   * `existingUser` is the user who started `GET /auth/github/link`, read from the verified
   * OAuth state; it is never taken from a session or token on the callback request.
   */
  findOrCreateUser?: (
    profile: Profile,
    accessToken: string,
    refreshToken: string,
    existingUser?: Record<string, unknown>
  ) => Promise<unknown>;
}

/** Fields added to user documents for GitHub authentication */
export interface GitHubUserFields {
  /** GitHub user ID */
  githubId?: string;
  /** GitHub username */
  githubUsername?: string;
  /** GitHub profile URL */
  githubProfileUrl?: string;
  /** GitHub avatar URL */
  githubAvatarUrl?: string;
}

/**
 * Plugin to add GitHub authentication fields to a user schema.
 * Apply this plugin to your User schema if you want to enable GitHub auth.
 *
 * @example
 * ```typescript
 * import {githubUserPlugin} from "@terreno/api";
 *
 * userSchema.plugin(githubUserPlugin);
 * ```
 */
// noExplicitAny: Schema generics must be loose to accept arbitrary consumer schemas
// biome-ignore lint/suspicious/noExplicitAny: Schema generics must be loose to accept arbitrary consumer schemas
export const githubUserPlugin = (schema: Schema<any, any, any, any>): void => {
  schema.add({
    githubAvatarUrl: {description: "GitHub avatar image URL", type: String},
    githubId: {
      description: "GitHub user ID",
      index: true,
      sparse: true,
      type: String,
      unique: true,
    },
    githubProfileUrl: {description: "GitHub profile URL", type: String},
    githubUsername: {description: "GitHub username", type: String},
  });
};

/** Cookie that binds a GitHub OAuth flow to the browser that started it. */
const GITHUB_STATE_COOKIE = "terreno_github_oauth_state";
/** How long a started GitHub OAuth flow stays valid. */
const GITHUB_STATE_TTL_MINUTES = 10;
const STATE_VERIFY_FAILURE = {message: "Unable to verify authorization request state."};

interface GitHubOAuthState {
  expiresAt: number;
  linkUserId?: string;
  nonce: string;
}

type StateStoreCallback = (error: unknown, ok?: unknown, info?: unknown) => void;

interface GitHubStateStore {
  store: (
    req: express.Request,
    state: unknown,
    meta: unknown,
    callback: StateStoreCallback
  ) => void;
  verify: (
    req: express.Request,
    providedState: unknown,
    meta: unknown,
    callback: StateStoreCallback
  ) => void;
}

// Link targets read from verified state, keyed by request so no request input can set one.
const verifiedLinkTargets = new WeakMap<express.Request, string>();

const getStateSecret = (): string => {
  const secret = process.env.SESSION_SECRET || process.env.TOKEN_SECRET;
  if (!secret) {
    throw new APIError({
      status: 500,
      title: "SESSION_SECRET or TOKEN_SECRET must be set for GitHub OAuth.",
    });
  }
  return secret;
};

const signStatePayload = (payload: string): string => {
  return createHmac("sha256", getStateSecret()).update(payload).digest("base64url");
};

const safeEqual = (a: string, b: string): boolean => {
  const aBuffer = Buffer.from(a);
  const bBuffer = Buffer.from(b);
  if (aBuffer.length !== bBuffer.length) {
    return false;
  }
  return timingSafeEqual(aBuffer, bBuffer);
};

const readCookie = (req: express.Request, name: string): string | undefined => {
  const header = req.headers?.cookie;
  if (!header) {
    return undefined;
  }
  for (const part of header.split(";")) {
    const [rawName, ...rest] = part.trim().split("=");
    if (rawName === name) {
      try {
        return decodeURIComponent(rest.join("="));
      } catch {
        return undefined;
      }
    }
  }
  return undefined;
};

const parseStateCookie = (raw: string | undefined): GitHubOAuthState | undefined => {
  if (!raw) {
    return undefined;
  }
  const [payload, signature, ...extra] = raw.split(".");
  if (!payload || !signature || extra.length > 0) {
    return undefined;
  }
  if (!safeEqual(signature, signStatePayload(payload))) {
    return undefined;
  }
  try {
    const parsed = JSON.parse(Buffer.from(payload, "base64url").toString("utf8")) as unknown;
    if (!parsed || typeof parsed !== "object") {
      return undefined;
    }
    const {expiresAt, linkUserId, nonce} = parsed as Record<string, unknown>;
    if (typeof expiresAt !== "number" || typeof nonce !== "string") {
      return undefined;
    }
    if (linkUserId !== undefined && typeof linkUserId !== "string") {
      return undefined;
    }
    return {expiresAt, linkUserId, nonce};
  } catch {
    return undefined;
  }
};

const isHttpsUrl = (value: string): boolean | undefined => {
  try {
    return new URL(value).protocol === "https:";
  } catch {
    return undefined;
  }
};

/**
 * passport-oauth2 state store backed by a signed, HttpOnly, SameSite=Lax cookie. `store` issues a
 * nonce for the `state` parameter and records it (and the link target for /auth/github/link) in
 * the cookie; `verify` accepts the callback only when the cookie is intact, unexpired, and holds
 * the same nonce. The cookie is single use.
 */
const createSignedCookieStateStore = (callbackURL: string): GitHubStateStore => {
  const callbackIsHttps = isHttpsUrl(callbackURL);
  const cookieOptions = (req: express.Request): express.CookieOptions => ({
    httpOnly: true,
    path: "/",
    sameSite: "lax",
    secure: callbackIsHttps ?? req.secure,
  });

  return {
    store: (req, state, _meta, callback): void => {
      if (!req.res) {
        callback(new Error("GitHub OAuth state requires an Express response"));
        return;
      }
      const linkUserId =
        state && typeof state === "object" && "linkUserId" in state
          ? String((state as {linkUserId: unknown}).linkUserId)
          : undefined;
      const nonce = randomBytes(24).toString("base64url");
      const record: GitHubOAuthState = {
        expiresAt: DateTime.now().plus({minutes: GITHUB_STATE_TTL_MINUTES}).toMillis(),
        nonce,
        ...(linkUserId ? {linkUserId} : {}),
      };
      const payload = Buffer.from(JSON.stringify(record)).toString("base64url");
      req.res.cookie(GITHUB_STATE_COOKIE, `${payload}.${signStatePayload(payload)}`, {
        ...cookieOptions(req),
        maxAge: GITHUB_STATE_TTL_MINUTES * 60 * 1000,
      });
      callback(null, nonce);
    },
    verify: (req, providedState, _meta, callback): void => {
      const record = parseStateCookie(readCookie(req, GITHUB_STATE_COOKIE));
      req.res?.clearCookie(GITHUB_STATE_COOKIE, cookieOptions(req));
      if (!record || typeof providedState !== "string") {
        callback(null, false, STATE_VERIFY_FAILURE);
        return;
      }
      if (record.expiresAt <= DateTime.now().toMillis()) {
        callback(null, false, STATE_VERIFY_FAILURE);
        return;
      }
      if (!safeEqual(record.nonce, providedState)) {
        callback(null, false, STATE_VERIFY_FAILURE);
        return;
      }
      if (record.linkUserId) {
        verifiedLinkTargets.set(req, record.linkUserId);
      }
      callback(null, true);
    },
  };
};

// http(s) targets compare by origin; custom schemes compare by scheme plus authority.
const returnToKey = (value: string): string | undefined => {
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    return undefined;
  }
  if (url.protocol === "http:" || url.protocol === "https:") {
    return url.origin.toLowerCase();
  }
  if (!url.host || url.username || url.password) {
    return undefined;
  }
  return `${url.protocol}//${url.host}`.toLowerCase();
};

/** Whether `value` is a redirect target the operator allowed in `allowedReturnTo`. */
const isAllowedReturnTo = (value: unknown, allowed: string[] | undefined): value is string => {
  if (typeof value !== "string" || !allowed?.length) {
    return false;
  }
  const key = returnToKey(value);
  if (!key) {
    return false;
  }
  return allowed.some((entry) => returnToKey(entry) === key);
};

/**
 * Sets up GitHub OAuth authentication strategy.
 * Call this after setupAuth() in your server initialization.
 */
export const setupGitHubAuth = (
  _app: express.Application,
  userModel: UserModel,
  githubOptions: GitHubAuthOptions
): void => {
  const scope = githubOptions.scope ?? ["user:email"];

  passport.use(
    "github",
    new GitHubStrategy(
      {
        callbackURL: githubOptions.callbackURL,
        clientID: githubOptions.clientId,
        clientSecret: githubOptions.clientSecret,
        passReqToCallback: true,
        scope,
        store: createSignedCookieStateStore(githubOptions.callbackURL),
      } as ConstructorParameters<typeof GitHubStrategy>[0],
      async (
        req: express.Request,
        accessToken: string,
        refreshToken: string,
        profile: Profile,
        done: (error: unknown, user?: unknown) => void
      ) => {
        try {
          // The link target comes only from state issued by /auth/github/link, never from an
          // ambient session or token on the callback request.
          const linkUserId = verifiedLinkTargets.get(req);
          const linkUser = linkUserId ? await userModel.findById(linkUserId) : null;
          if (linkUserId && !linkUser) {
            return done(new APIError({status: 404, title: "User not found"}));
          }

          // If custom handler provided, use it
          if (githubOptions.findOrCreateUser) {
            const user = await githubOptions.findOrCreateUser(
              profile,
              accessToken,
              refreshToken,
              (linkUser ?? undefined) as Record<string, unknown> | undefined
            );
            return done(null, user);
          }

          // Default implementation
          const githubId = profile.id;

          // Check if user with this GitHub ID already exists
          const existingGitHubUser = await findOneOrNoneFor(userModel, {githubId});

          // Case 1: The user who started /auth/github/link is linking their GitHub account
          if (linkUser) {
            if (!githubOptions.allowAccountLinking) {
              return done(new APIError({status: 400, title: "Account linking is disabled"}));
            }

            if (
              existingGitHubUser &&
              existingGitHubUser._id.toString() !== linkUser._id.toString()
            ) {
              return done(
                new APIError({
                  status: 400,
                  title: "This GitHub account is already linked to another user",
                })
              );
            }

            const userWithGitHub = linkUser as unknown as GitHubUserFields;
            userWithGitHub.githubId = githubId;
            userWithGitHub.githubUsername = profile.username;
            userWithGitHub.githubProfileUrl = profile.profileUrl;
            userWithGitHub.githubAvatarUrl = profile.photos?.[0]?.value;
            await linkUser.save();
            return done(null, linkUser);
          }

          // Case 2: User with this GitHub ID exists - log them in
          if (existingGitHubUser) {
            return done(null, existingGitHubUser);
          }

          // Case 3: Create new user with GitHub credentials
          const email = profile.emails?.[0]?.value;

          // Check if user with this email already exists
          if (email) {
            const existingEmailUser = await findOneOrNoneFor(userModel, {email});
            if (existingEmailUser) {
              // If account linking is allowed, link GitHub to existing email account
              if (githubOptions.allowAccountLinking !== false) {
                const emailUserWithGitHub = existingEmailUser as unknown as GitHubUserFields;
                emailUserWithGitHub.githubId = githubId;
                emailUserWithGitHub.githubUsername = profile.username;
                emailUserWithGitHub.githubProfileUrl = profile.profileUrl;
                emailUserWithGitHub.githubAvatarUrl = profile.photos?.[0]?.value;
                await existingEmailUser.save();
                return done(null, existingEmailUser);
              }
              return done(
                new APIError({
                  status: 400,
                  title:
                    "An account with this email already exists. Please log in and link your GitHub account.",
                })
              );
            }
          }

          // Create new user
          const newUser = new userModel({
            admin: false,
            email,
            githubAvatarUrl: profile.photos?.[0]?.value,
            githubId,
            githubProfileUrl: profile.profileUrl,
            githubUsername: profile.username,
          } as unknown as Partial<User>);

          await newUser.save();
          return done(null, newUser);
        } catch (error) {
          logger.error(`GitHub auth error: ${error}`);
          return done(error);
        }
      }
    ) as passport.Strategy
  );
};

/**
 * Adds GitHub OAuth routes to the Express application.
 *
 * Routes added:
 * - GET /auth/github - Initiates GitHub OAuth flow
 * - GET /auth/github/callback - Handles GitHub OAuth callback
 * - POST /auth/github/link - Links GitHub account to authenticated user (requires JWT auth)
 * - DELETE /auth/github/unlink - Unlinks GitHub account from authenticated user (requires JWT auth)
 */
export const addGitHubAuthRoutes = (
  app: express.Application,
  userModel: UserModel,
  githubOptions: GitHubAuthOptions,
  authOptions?: AuthOptions
): void => {
  const router = Router();

  // Initiate GitHub OAuth flow
  router.get(
    "/github",
    (req: express.Request, _res: express.Response, next: express.NextFunction) => {
      // Store an allowlisted return URL in the session for the redirect after auth
      const returnTo = req.query.returnTo;
      if (returnTo === undefined || returnTo === "") {
        return next();
      }
      if (!githubOptions.allowedReturnTo?.length) {
        logger.warn("[github] Ignoring returnTo because githubAuth.allowedReturnTo is not set");
        return next();
      }
      if (!isAllowedReturnTo(returnTo, githubOptions.allowedReturnTo)) {
        return next(
          new APIError({status: 400, title: "returnTo is not an allowed redirect target"})
        );
      }
      const reqWithSession = req as express.Request & {session?: {returnTo?: string}};
      reqWithSession.session = reqWithSession.session ?? {};
      reqWithSession.session.returnTo = returnTo;
      return next();
    },
    passport.authenticate("github", {session: false})
  );

  // GitHub OAuth callback
  router.get(
    "/github/callback",
    passport.authenticate("github", {
      failureRedirect: "/auth/github/failure",
      session: false,
    }),
    async (req: express.Request, res: express.Response) => {
      if (isUserDisabled(req.user)) {
        logger.warn(`[github] Refusing GitHub login for disabled user ${req.user?._id}`);
        return res.status(401).json({status: 401, title: "User is disabled"});
      }
      try {
        const tokens = await generateTokens(req.user, authOptions);
        const session = (req as express.Request & {session?: {returnTo?: string}}).session;
        const returnTo = session?.returnTo;
        if (session && returnTo !== undefined) {
          delete session.returnTo;
        }

        // Redirect only to an allowlisted target, with tokens in the fragment so they stay out
        // of server logs and Referer headers
        if (returnTo && isAllowedReturnTo(returnTo, githubOptions.allowedReturnTo)) {
          const url = new URL(returnTo);
          const fragment = new URLSearchParams({token: tokens.token ?? ""});
          if (tokens.refreshToken) {
            fragment.set("refreshToken", tokens.refreshToken);
          }
          fragment.set("userId", req.user?._id ? String(req.user._id) : "");
          url.hash = fragment.toString();
          return res.redirect(url.toString());
        }
        if (returnTo) {
          logger.warn("[github] Not redirecting to a returnTo outside githubAuth.allowedReturnTo");
        }

        // Otherwise return JSON response
        return res.json({
          data: {
            refreshToken: tokens.refreshToken,
            token: tokens.token,
            userId: req.user?._id,
          },
        });
      } catch (error) {
        logger.error(`GitHub callback error: ${error}`);
        return res.status(500).json({message: "Authentication failed"});
      }
    }
  );

  // GitHub auth failure handler
  router.get("/github/failure", (_req: express.Request, res: express.Response) => {
    return res.status(401).json({message: "GitHub authentication failed"});
  });

  // Link GitHub to existing authenticated user
  if (githubOptions.allowAccountLinking !== false) {
    router.get(
      "/github/link",
      (req: express.Request, res: express.Response, next: express.NextFunction): void => {
        // Require JWT authentication for linking
        passport.authenticate(
          "jwt",
          {session: false},
          (err: unknown, user: User | false | null) => {
            if (err || !user) {
              res.status(401).json({message: "Authentication required to link GitHub account"});
              return;
            }
            req.user = user as unknown as express.Request["user"];
            next();
          }
        )(req, res, next);
      },
      (req: express.Request, res: express.Response, next: express.NextFunction): void => {
        // Record the bearer-authenticated user in the signed state as the only link target.
        passport.authenticate("github", {
          session: false,
          state: {linkUserId: String(req.user?._id)},
        } as unknown as passport.AuthenticateOptions)(req, res, next);
      }
    );

    // Unlink GitHub from user account
    router.delete(
      "/github/unlink",
      passport.authenticate("jwt", {session: false}),
      async (req: express.Request, res: express.Response) => {
        if (!req.user) {
          return res.status(401).json({message: "Authentication required"});
        }

        try {
          // Explicitly select hash and salt fields which may be hidden by default
          const user = await userModel.findById(req.user._id).select("+hash +salt");
          if (!user) {
            return res.status(404).json({message: "User not found"});
          }

          // Check if user has other authentication methods before unlinking
          // passport-local-mongoose stores password in hash and salt fields
          const userWithAuth = user as unknown as {hash?: string; salt?: string};
          const hasPassword = !!userWithAuth.hash || !!userWithAuth.salt;
          if (!hasPassword) {
            return res.status(400).json({
              message:
                "Cannot unlink GitHub account without another authentication method. Set a password first.",
            });
          }

          const userWithGitHub = user as unknown as GitHubUserFields;
          userWithGitHub.githubId = undefined;
          userWithGitHub.githubUsername = undefined;
          userWithGitHub.githubProfileUrl = undefined;
          userWithGitHub.githubAvatarUrl = undefined;
          await user.save();

          return res.json({data: {message: "GitHub account unlinked successfully"}});
        } catch (error) {
          logger.error(`GitHub unlink error: ${error}`);
          return res.status(500).json({message: "Failed to unlink GitHub account"});
        }
      }
    );
  }

  app.use("/auth", router);
};
