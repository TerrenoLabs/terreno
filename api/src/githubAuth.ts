import type express from "express";
import {Router} from "express";
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
   * Custom function to handle user creation or lookup from GitHub profile.
   * If not provided, a default implementation will be used.
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
      },
      async (
        req: express.Request,
        accessToken: string,
        refreshToken: string,
        profile: Profile,
        done: (error: unknown, user?: unknown) => void
      ) => {
        try {
          const existingUser = req.user;

          // If custom handler provided, use it
          if (githubOptions.findOrCreateUser) {
            const user = await githubOptions.findOrCreateUser(
              profile,
              accessToken,
              refreshToken,
              existingUser
            );
            return done(null, user);
          }

          // Default implementation
          const githubId = profile.id;

          // Check if user with this GitHub ID already exists
          const existingGitHubUser = await findOneOrNoneFor(userModel, {githubId});

          // Case 1: User is authenticated and wants to link GitHub account
          if (existingUser) {
            if (!githubOptions.allowAccountLinking) {
              return done(new APIError({status: 400, title: "Account linking is disabled"}));
            }

            if (
              existingGitHubUser &&
              existingGitHubUser._id.toString() !== existingUser._id.toString()
            ) {
              return done(
                new APIError({
                  status: 400,
                  title: "This GitHub account is already linked to another user",
                })
              );
            }

            // Link GitHub to existing user
            const user = await userModel.findById(existingUser._id);
            if (user) {
              const userWithGitHub = user as unknown as GitHubUserFields;
              userWithGitHub.githubId = githubId;
              userWithGitHub.githubUsername = profile.username;
              userWithGitHub.githubProfileUrl = profile.profileUrl;
              userWithGitHub.githubAvatarUrl = profile.photos?.[0]?.value;
              await user.save();
              return done(null, user);
            }
            return done(new APIError({status: 404, title: "User not found"}));
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
      // Store the return URL in session or query for redirect after auth
      const returnTo = req.query.returnTo as string | undefined;
      if (returnTo) {
        const reqWithSession = req as express.Request & {session?: {returnTo?: string}};
        reqWithSession.session = reqWithSession.session ?? {};
        reqWithSession.session.returnTo = returnTo;
      }
      next();
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
        const returnTo = (req as express.Request & {session?: {returnTo?: string}}).session
          ?.returnTo;

        // If there's a return URL, redirect with tokens as query params
        if (returnTo) {
          const url = new URL(returnTo);
          url.searchParams.set("token", tokens.token ?? "");
          if (tokens.refreshToken) {
            url.searchParams.set("refreshToken", tokens.refreshToken);
          }
          url.searchParams.set("userId", req.user?._id ? String(req.user._id) : "");
          return res.redirect(url.toString());
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
      passport.authenticate("github", {session: false})
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
