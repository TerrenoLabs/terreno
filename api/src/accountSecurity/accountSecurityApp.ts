/**
 * AccountSecurityApp: per-user security summary and recovery routes for platform staff.
 *
 * A framework plugin with its own Express router (the OrgsApp precedent), not modelRouter
 * actions. `mountSecurityRoutes(router, authorize)` mounts the same handlers under any prefix,
 * so the org-admin prefix (`/orgs/:orgId/members/:userId/security/*`) reuses them with its own
 * authorizer. Each recovery action is one row in the action table; the summary lists only the
 * actions this server supports and that apply to the user.
 */

import type express from "express";
import {type NextFunction, type Request, type Response, Router} from "express";

import {asyncHandler, type OpenApiMiddleware} from "../api";
import {AuditApp} from "../audit/auditApp";
import {isAuditRecorderInstalled} from "../audit/record";
import {authenticateMiddleware, type User, type UserModel} from "../auth";
import {findBetterAuthProvider, getProvidedBetterAuth} from "../betterAuthApp";
import type {BetterAuthInstance} from "../betterAuthSetup";
import {APIError, ForbiddenError, NotFoundError} from "../errors";
import {logger} from "../logger";
import {MCP_OAUTH_ACCESS_TOKEN_PREFIX} from "../models/mcpOAuthToken";
import {MCP_SERVICE_TOKEN_PREFIX} from "../models/mcpServiceToken";
import {createOpenApiBuilder} from "../openApiBuilder";
import type {PermissionSet} from "../rbac/statements";
import type {AnyTerrenoAccess} from "../rbac/types";
import {getCurrentRequestContext, type RequestCredential} from "../requestContext";
import type {TerrenoApp} from "../terrenoApp";
import type {TerrenoPlugin} from "../terrenoPlugin";
import {
  disableAccountAction,
  enableAccountAction,
  issueSignInLinkAction,
  revokeSessionsAction,
  sendPasswordResetAction,
} from "./accessActions";
import {
  type AccountSecurityActionSummary,
  type AccountSecurityFeatures,
  type AccountSecurityService,
  type AccountSecurityState,
  type AccountSecuritySummary,
  createAccountSecurityService,
  userIdOf,
} from "./accountSecurityService";
import {removePasskeyAction, unlinkProviderAction} from "./credentialActions";
import {
  recordSecurityAction,
  SECURITY_ACTIONS,
  type SecurityActionId,
  type SecurityActionOrg,
} from "./securityEvents";

/** The RBAC statement that grants the platform security routes. */
export const MANAGE_SECURITY_PERMISSION = {user: ["manageSecurity"]} as const;

/** Who is acting, and for org-admin routes, the org they act for. */
export interface SecurityAuthorization {
  actor: User;
  org?: SecurityActionOrg;
}

/**
 * Decides whether `req.user` may act on `targetUserId`. Throws an `APIError` to refuse: 403 when
 * the caller lacks the right, 404 when the target is out of their reach.
 */
export type SecurityAuthorizer = (args: {
  req: Request;
  targetUserId: string;
}) => Promise<SecurityAuthorization>;

/** What a security action handler receives. */
export interface SecurityActionContext {
  actor: User;
  features: AccountSecurityFeatures;
  org?: SecurityActionOrg;
  req: Request;
  service: AccountSecurityService;
  target: User;
}

/**
 * What a handler returns. A `changed: false` result (nothing to do) answers 200 and is not
 * recorded; `data` is merged into the response body.
 */
export interface SecurityActionResult {
  /** Extra fields for the AuditEvent `after` (such as which passkey was removed). No secrets. */
  audit?: Record<string, unknown>;
  changed: boolean;
  data?: Record<string, unknown>;
}

/** One row of the action table: a recovery route and the rules for listing it. */
export interface SecurityRouteAction {
  id: SecurityActionId;
  /** Whether the user's current state makes the action worth offering in the summary. */
  isApplicable: (args: {
    features: AccountSecurityFeatures;
    org?: SecurityActionOrg;
    state: AccountSecurityState;
  }) => boolean;
  /** Whether this server can run it at all. Unsupported actions answer 404. */
  isSupported: (features: AccountSecurityFeatures) => boolean;
  method: "delete" | "post";
  /** Path under `/:userId/security`, such as `/reset-two-factor` or `/passkeys/:passkeyId`. */
  path: string;
  /**
   * Only platform staff may run it. `mountSecurityRoutes` skips it unless the mount passes
   * `includePlatformOnly`, so org-admin prefixes never expose it.
   */
  platformOnly?: boolean;
  /**
   * An RBAC permission the actor needs on top of the route's authorizer, such as
   * `{user: ["issueSignInLink"]}`. Without RBAC the actor needs `admin: true`. Actions the actor
   * may not run answer 403 and are left out of the summary.
   */
  requiredPermission?: {readonly [resource: string]: readonly string[]};
  run: (context: SecurityActionContext) => Promise<SecurityActionResult>;
}

export const resetTwoFactorAction: SecurityRouteAction = {
  id: "reset-two-factor",
  isApplicable: ({state}) => state.twoFactor.enabled,
  isSupported: (features) => features.twoFactor,
  method: "post",
  path: "/reset-two-factor",
  run: async ({service, target}) => service.resetTwoFactor(target),
};

/** The built-in action table, in display order. */
export const defaultSecurityActions = (): SecurityRouteAction[] => [
  resetTwoFactorAction,
  removePasskeyAction,
  unlinkProviderAction,
  revokeSessionsAction,
  sendPasswordResetAction,
  disableAccountAction,
  enableAccountAction,
  issueSignInLinkAction,
];

/** Options for {@link AccountSecurityApp.mountSecurityRoutes}. */
export interface MountSecurityRoutesOptions {
  /**
   * Mount and list actions marked `platformOnly` (such as `issue-sign-in-link`). Only the
   * platform mount sets it; org-admin prefixes leave it off.
   */
  includePlatformOnly?: boolean;
}

export interface AccountSecurityAppOptions {
  /** Extra recovery actions, mounted and listed after the built-in ones. */
  actions?: SecurityRouteAction[];
  /**
   * RBAC access control. Platform routes require `user:manageSecurity`. Defaults to the
   * TerrenoApp's `accessControl`; without either, they require `admin: true`.
   */
  accessControl?: AnyTerrenoAccess;
  /**
   * Pass `false` to run without AuditApp. Otherwise registration throws unless AuditApp is
   * registered, because every recovery action must leave an audit record.
   */
  audit?: boolean;
  /** Prefix for the platform routes. Defaults to `/users`. */
  basePath?: string;
  /**
   * Better Auth instance. Defaults to the registered BetterAuthApp's. Required outside
   * TerrenoApp (setupServer); without it every Better Auth feature reads as off.
   */
  getBetterAuth?: () => BetterAuthInstance | undefined;
  /**
   * App page base for `issue-sign-in-link` URLs (`{publicAppUrl}/resetPassword?token=`). Defaults
   * to the registered BetterAuthApp's `publicAppUrl`.
   */
  publicAppUrl?: string;
  /** App User model. Defaults to the TerrenoApp's `userModel`. */
  userModel?: UserModel;
}

/** The credentials that prove the caller is the person at the keyboard. */
const OWN_SESSION_CREDENTIALS: readonly RequestCredential[] = ["jwt", "better-auth-session"];

const DELEGATED_CREDENTIAL_TITLE = "Account security requires your own session";

const OUT_OF_REACH_TITLE = "Target holds permissions you lack";

const SELF_TARGET_TITLE = "Use your own security settings to change your account";

const bearerToken = (req: Request): string | undefined => {
  const authorization = req.headers.authorization;
  if (typeof authorization !== "string") {
    return undefined;
  }
  return authorization.startsWith("Bearer ") ? authorization.slice(7) : authorization;
};

/** Refuses delegated agent bearers (MCP service tokens, MCP OAuth tokens) before auth runs. */
const rejectDelegatedBearer = (req: Request, _res: Response, next: NextFunction): void => {
  const token = bearerToken(req);
  if (
    token?.startsWith(MCP_SERVICE_TOKEN_PREFIX) ||
    token?.startsWith(MCP_OAUTH_ACCESS_TOKEN_PREFIX)
  ) {
    next(new ForbiddenError(DELEGATED_CREDENTIAL_TITLE));
    return;
  }
  next();
};

/**
 * The credential that authenticated the request. Outside TerrenoApp (setupServer has no request
 * context) it is read from what the auth middleware left on the request.
 */
const requestCredentialOf = (req: Request): RequestCredential | undefined => {
  const fromContext = getCurrentRequestContext()?.credential;
  if (fromContext) {
    return fromContext;
  }
  const withAuth = req as Request & {authTokenPayload?: unknown; betterAuthSession?: unknown};
  if (withAuth.betterAuthSession) {
    return "better-auth-session";
  }
  if (withAuth.authTokenPayload) {
    return "jwt";
  }
  return undefined;
};

/** Allows only the user's own session (a Terreno JWT or a Better Auth session). */
const requireOwnSession = (req: Request, _res: Response, next: NextFunction): void => {
  const credential = requestCredentialOf(req);
  if (!credential || !OWN_SESSION_CREDENTIALS.includes(credential)) {
    next(new ForbiddenError(DELEGATED_CREDENTIAL_TITLE));
    return;
  }
  next();
};

const rolesOf = (user: User): string[] => (user as User & {roles?: string[]}).roles ?? [];

const missingPermissions = (held: PermissionSet, required: PermissionSet): string[] => {
  const missing: string[] = [];
  for (const [resource, actions] of Object.entries(required)) {
    const heldActions = new Set(held[resource] ?? []);
    for (const action of actions) {
      if (!heldActions.has(action)) {
        missing.push(`${resource}:${action}`);
      }
    }
  }
  return missing;
};

const permissionLabels = (permission: SecurityRouteAction["requiredPermission"]): string[] =>
  Object.entries(permission ?? {}).flatMap(([resource, actions]) =>
    actions.map((action) => `${resource}:${action}`)
  );

const targetUserIdOf = (req: Request): string => {
  const value = req.params.userId;
  return typeof value === "string" ? value : "";
};

/** Two actions with one id would share a summary entry and an audit name, so refuse them. */
const assertUniqueActionIds = (actions: readonly SecurityRouteAction[]): void => {
  const seen = new Set<string>();
  for (const action of actions) {
    if (seen.has(action.id)) {
      throw new APIError({
        detail: `Two security actions use the id "${action.id}"; give the custom action its own id.`,
        status: 500,
        title: "Duplicate security action id",
      });
    }
    seen.add(action.id);
  }
};

export class AccountSecurityApp implements TerrenoPlugin {
  private readonly options: AccountSecurityAppOptions;
  private readonly actions: SecurityRouteAction[];
  private terrenoApp: TerrenoApp | undefined;
  private openApi: OpenApiMiddleware | undefined;
  private readonly service: AccountSecurityService;
  private warnedNoBetterAuth = false;

  constructor(options: AccountSecurityAppOptions = {}) {
    this.options = options;
    this.actions = [...defaultSecurityActions(), ...(options.actions ?? [])];
    assertUniqueActionIds(this.actions);
    this.service = createAccountSecurityService({
      getAuth: () => this.resolveBetterAuth(),
      getPublicAppUrl: () => this.resolvePublicAppUrl(),
      getUserModel: () => this.resolveUserModel(),
    });
  }

  /** The recovery actions this plugin mounts, in display order. */
  getActions(): readonly SecurityRouteAction[] {
    return this.actions;
  }

  register(app: express.Application, openApi?: unknown, terrenoApp?: TerrenoApp): void {
    this.terrenoApp = terrenoApp;
    this.openApi = openApi as OpenApiMiddleware | undefined;
    this.assertAuditRegistered();
    this.resolveUserModel();
    const router = Router();
    this.mountSecurityRoutes(router, this.authorizePlatform, {includePlatformOnly: true});
    app.use(this.options.basePath ?? "/users", router);
  }

  /**
   * Mounts `GET /:userId/security` and every action route on `router`, each guarded by
   * `authorize`. Routers mounted under a prefix with its own params (such as `:orgId`) need
   * `Router({mergeParams: true})` so the authorizer can read them.
   */
  mountSecurityRoutes(
    router: Router,
    authorize: SecurityAuthorizer,
    {includePlatformOnly = false}: MountSecurityRoutesOptions = {}
  ): void {
    const guards = [rejectDelegatedBearer, authenticateMiddleware(), requireOwnSession];
    const actions = this.actions.filter((action) => includePlatformOnly || !action.platformOnly);

    router.get(
      "/:userId/security",
      ...guards,
      this.docs("Get a user's sign-in security summary"),
      asyncHandler(async (req, res) => {
        const {actor, org, target} = await this.resolveTarget(req, authorize);
        const features = await this.service.readFeatures();
        const state = await this.service.readState(target, features);
        const permitted = await this.filterPermitted({actions, actor, req});
        const summary: AccountSecuritySummary = {
          ...state,
          actions: this.listActions(permitted, {features, org, state}),
        };
        return res.json({data: summary});
      })
    );

    for (const action of actions) {
      router[action.method](
        `/:userId/security${action.path}`,
        ...guards,
        this.docs(SECURITY_ACTIONS[action.id].label),
        asyncHandler(async (req, res) => {
          const {actor, org, target} = await this.resolveTarget(req, authorize);
          if (!(await this.mayRun({action, actor, req}))) {
            throw new ForbiddenError({
              detail: `${action.id} needs ${permissionLabels(action.requiredPermission).join(", ")}`,
              title: "Access denied",
            });
          }
          const features = await this.service.readFeatures();
          if (!action.isSupported(features)) {
            throw new NotFoundError({
              detail: `${action.id} is not enabled on this server`,
              title: "Security action not available",
            });
          }
          const result = await action.run({
            actor,
            features,
            org,
            req,
            service: this.service,
            target,
          });
          if (result.changed) {
            void recordSecurityAction({
              action: action.id,
              actor: {id: userIdOf(actor)},
              details: result.audit,
              org,
              target: {id: userIdOf(target)},
            });
          }
          return res.json({data: {...result.data, action: action.id, changed: result.changed}});
        })
      );
    }
  }

  /**
   * The shared pipeline step every route runs before its handler: authorize the caller (403),
   * load the target (404), then refuse a target the caller may not act on (403).
   */
  private resolveTarget = async (
    req: Request,
    authorize: SecurityAuthorizer
  ): Promise<SecurityAuthorization & {target: User}> => {
    const authorization = await authorize({req, targetUserId: targetUserIdOf(req)});
    const target = await this.service.loadTarget(targetUserIdOf(req));
    await this.assertWithinReach({actor: authorization.actor, target});
    return {...authorization, target};
  };

  /**
   * Refuses (403) acting on yourself, which belongs on your own security screen, and acting on
   * someone who holds any permission you lack, such as a superadmin, so recovery cannot be used
   * to take over a more privileged account.
   */
  private assertWithinReach = async ({
    actor,
    target,
  }: {
    actor: User;
    target: User;
  }): Promise<void> => {
    if (userIdOf(actor) === userIdOf(target)) {
      throw new ForbiddenError(SELF_TARGET_TITLE);
    }
    if (rolesOf(target).includes("superadmin") && !rolesOf(actor).includes("superadmin")) {
      throw new ForbiddenError({detail: "The target is a superadmin", title: OUT_OF_REACH_TITLE});
    }
    if (target.admin === true && actor.admin !== true) {
      throw new ForbiddenError({detail: "The target is an admin", title: OUT_OF_REACH_TITLE});
    }
    const accessControl = this.resolveAccessControl();
    if (!accessControl) {
      return;
    }
    const [actorPermissions, targetPermissions] = await Promise.all([
      accessControl.getPermissions({user: actor}),
      accessControl.getPermissions({user: target}),
    ]);
    const missing = missingPermissions(actorPermissions, targetPermissions);
    if (missing.length > 0) {
      throw new ForbiddenError({
        detail: `The target holds ${missing.slice(0, 5).join(", ")}`,
        title: OUT_OF_REACH_TITLE,
      });
    }
  };

  /** Platform staff: `user:manageSecurity` under RBAC, otherwise `admin: true`. */
  readonly authorizePlatform: SecurityAuthorizer = async ({req}) => {
    const actor = req.user as User | undefined;
    if (!actor) {
      throw new APIError({status: 401, title: "Unauthorized"});
    }
    const accessControl = this.resolveAccessControl();
    if (accessControl) {
      const result = await accessControl.can({
        context: {req},
        permissions: MANAGE_SECURITY_PERMISSION as never,
        user: actor,
      });
      if (!result.allowed) {
        throw new ForbiddenError({detail: result.reason, title: "Access denied"});
      }
      return {actor};
    }
    if (actor.admin !== true) {
      throw new ForbiddenError("Access denied");
    }
    return {actor};
  };

  /** Whether the actor holds the action's `requiredPermission` (or `admin: true` without RBAC). */
  private mayRun = async ({
    action,
    actor,
    req,
  }: {
    action: SecurityRouteAction;
    actor: User;
    req: Request;
  }): Promise<boolean> => {
    if (!action.requiredPermission) {
      return true;
    }
    const accessControl = this.resolveAccessControl();
    if (!accessControl) {
      return actor.admin === true;
    }
    const result = await accessControl.can({
      context: {req},
      permissions: action.requiredPermission as never,
      user: actor,
    });
    return result.allowed;
  };

  private filterPermitted = async ({
    actions,
    actor,
    req,
  }: {
    actions: readonly SecurityRouteAction[];
    actor: User;
    req: Request;
  }): Promise<SecurityRouteAction[]> => {
    const allowed = await Promise.all(actions.map((action) => this.mayRun({action, actor, req})));
    return actions.filter((_action, index) => allowed[index]);
  };

  private listActions = (
    actions: readonly SecurityRouteAction[],
    args: {
      features: AccountSecurityFeatures;
      org?: SecurityActionOrg;
      state: AccountSecurityState;
    }
  ): AccountSecurityActionSummary[] =>
    actions
      .filter((action) => action.isSupported(args.features) && action.isApplicable(args))
      .map((action) => ({
        destructive: SECURITY_ACTIONS[action.id].destructive,
        id: action.id,
        label: SECURITY_ACTIONS[action.id].label,
      }));

  private docs = (summary: string): express.RequestHandler =>
    createOpenApiBuilder({openApi: this.openApi})
      .withTags(["account-security"])
      .withSummary(summary)
      .build() as unknown as express.RequestHandler;

  private assertAuditRegistered = (): void => {
    if (this.options.audit === false) {
      return;
    }
    const auditRegistered = this.terrenoApp
      ? this.terrenoApp.getRegistrations().some((registration) => registration instanceof AuditApp)
      : isAuditRecorderInstalled();
    if (auditRegistered) {
      return;
    }
    throw new APIError({
      detail:
        "Register AuditApp so every recovery action is audited, or pass audit: false to AccountSecurityApp.",
      status: 500,
      title: "AccountSecurityApp requires AuditApp",
    });
  };

  private resolveAccessControl = (): AnyTerrenoAccess | undefined =>
    this.options.accessControl ?? this.terrenoApp?.getAccessControl();

  private resolvePublicAppUrl = (): string | undefined => {
    if (this.options.publicAppUrl) {
      return this.options.publicAppUrl;
    }
    const provider = this.terrenoApp
      ? findBetterAuthProvider(this.terrenoApp.getRegistrations())
      : undefined;
    return provider?.getBetterAuthConfig?.().publicAppUrl;
  };

  private resolveBetterAuth = (): BetterAuthInstance | undefined => {
    const auth = this.options.getBetterAuth
      ? this.options.getBetterAuth()
      : this.terrenoApp
        ? getProvidedBetterAuth(findBetterAuthProvider(this.terrenoApp.getRegistrations()))
        : undefined;
    if (!auth && !this.warnedNoBetterAuth) {
      this.warnedNoBetterAuth = true;
      logger.warn(
        "AccountSecurityApp found no Better Auth instance; every Better Auth feature reads as off. Register BetterAuthApp or pass getBetterAuth."
      );
    }
    return auth;
  };

  private resolveUserModel = (): UserModel => {
    const userModel = this.options.userModel ?? this.terrenoApp?.getUserModel();
    if (!userModel) {
      throw new APIError({
        detail: "Pass userModel to AccountSecurityApp, or register it on a TerrenoApp.",
        status: 500,
        title: "AccountSecurityApp requires a userModel",
      });
    }
    return userModel;
  };
}
