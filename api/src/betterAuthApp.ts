/**
 * BetterAuthApp plugin for @terreno/api.
 *
 * Registers Better Auth as a TerrenoPlugin, mounting routes, session middleware,
 * and user sync on an existing Express application.
 */

import type express from "express";
import type {UserModel} from "./auth";
import type {BetterAuthConfig} from "./betterAuth";
import {
  type BetterAuthInstance,
  createBetterAuth,
  createBetterAuthSessionMiddleware,
  getMongoClientFromMongoose,
  mountBetterAuthRoutes,
  setupBetterAuthUserSync,
} from "./betterAuthSetup";
import {APIError} from "./errors";
import {logger} from "./logger";
import type {TerrenoPlugin} from "./terrenoPlugin";

/**
 * The capability a registered plugin offers when it owns the app's Better Auth instance, as
 * BetterAuthApp does. TerrenoApp mounts its session middleware and RealtimeApp validates socket
 * sessions with it, so both find the provider the same way: {@link findBetterAuthProvider}.
 */
export interface BetterAuthProvider {
  getAuth: () => BetterAuthInstance | undefined;
  ensureAuth?: () => BetterAuthInstance;
  /**
   * Hands the provider the host app's user model when it was given none of its own. TerrenoApp
   * calls it before anything creates the Better Auth instance.
   */
  adoptUserModel?: (userModel: UserModel) => void;
  markSessionMiddlewareMounted?: () => void;
  getBetterAuthBasePath?: () => string;
}

/** Whether a registered plugin provides the app's Better Auth instance. */
export const isBetterAuthProvider = (plugin: unknown): plugin is BetterAuthProvider =>
  typeof plugin === "object" &&
  plugin !== null &&
  typeof (plugin as Partial<BetterAuthProvider>).getAuth === "function";

/** The first registered plugin that provides the app's Better Auth instance, if any. */
export const findBetterAuthProvider = (
  registrations: readonly unknown[]
): BetterAuthProvider | undefined => registrations.find(isBetterAuthProvider);

/** The provider's Better Auth instance, creating it when the provider supports that. */
export const getProvidedBetterAuth = (
  provider: BetterAuthProvider | undefined
): BetterAuthInstance | undefined => provider?.ensureAuth?.() ?? provider?.getAuth();

export interface BetterAuthAppOptions {
  config: BetterAuthConfig;
  userModel?: UserModel;
}

export class BetterAuthApp implements TerrenoPlugin {
  private auth: BetterAuthInstance | undefined;
  private options: BetterAuthAppOptions;
  private sessionMiddlewareMounted = false;

  constructor(options: BetterAuthAppOptions) {
    this.options = options;
  }

  ensureAuth(): BetterAuthInstance {
    if (this.auth) {
      return this.auth;
    }
    const {config, userModel} = this.options;
    this.auth = createBetterAuth({
      config,
      mongoClient: getMongoClientFromMongoose(),
      userModel,
    });
    if (userModel) {
      setupBetterAuthUserSync(this.auth, userModel);
    }
    return this.auth;
  }

  /**
   * Uses `userModel` (TerrenoApp's) when this plugin was constructed without one. The app User
   * guard and sync (`terreno-app-user-sync`) are installed when the Better Auth instance is
   * created, so a user model that arrives after that would leave sign-ups unguarded while the
   * session middleware still links app Users: that is refused at boot instead.
   */
  adoptUserModel(userModel: UserModel): void {
    if (this.options.userModel) {
      return;
    }
    if (this.auth) {
      throw new APIError({
        detail: "Pass userModel to BetterAuthApp, or let TerrenoApp build it first.",
        status: 500,
        title: "BetterAuthApp created Better Auth before it was given a userModel",
      });
    }
    this.options = {...this.options, userModel};
  }

  markSessionMiddlewareMounted(): void {
    this.sessionMiddlewareMounted = true;
  }

  register(app: express.Application): void {
    const {config, userModel} = this.options;
    const auth = this.ensureAuth();

    const basePath = config.basePath ?? "/api/auth";
    mountBetterAuthRoutes(app, auth, basePath);

    if (!this.sessionMiddlewareMounted) {
      app.use(createBetterAuthSessionMiddleware(auth, userModel));
      this.sessionMiddlewareMounted = true;
    }

    logger.info("Better Auth initialized via BetterAuthApp plugin");
  }

  getBetterAuthBasePath(): string {
    return this.options.config.basePath ?? "/api/auth";
  }

  getAuth(): BetterAuthInstance | undefined {
    return this.auth;
  }
}
