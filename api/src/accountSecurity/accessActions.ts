/**
 * Access recovery actions: sign a user out everywhere, mail a password reset, disable or enable
 * the account, and issue a set-password link to a legacy user who has no way to sign in.
 *
 * Revoking deletes the user's Better Auth sessions. Bearer clients (native apps, bearer-mode web,
 * sockets) present the session token itself, so they fail on their next request. Cookie clients
 * can keep working for up to Better Auth's 5-minute session cookie cache (Q7).
 */

import {ConflictError, APIError as TerrenoAPIError} from "../errors";
import type {SecurityActionResult, SecurityRouteAction} from "./accountSecurityApp";
import type {SignInLinkRefusal} from "./accountSecurityService";

/**
 * The RBAC statement `issue-sign-in-link` needs on top of `user:manageSecurity` (D11). Only
 * `superadmin` holds it by default (through `*`); without RBAC the actor needs `admin: true`.
 */
export const ISSUE_SIGN_IN_LINK_PERMISSION = {user: ["issueSignInLink"]} as const;

const NOT_LINKED_TITLE = "User has no Better Auth account";

const RESET_NOT_CONFIGURED_TITLE = "Password reset email is not configured";

const SIGN_IN_LINK_NOT_CONFIGURED_TITLE = "Sign-in links are not configured";

const SIGN_IN_LINK_REFUSALS: Record<
  Exclude<SignInLinkRefusal, "not-configured">,
  {detail: string; title: string}
> = {
  "email-taken": {
    detail: "Another Better Auth user already uses this email",
    title: "Email already belongs to another sign-in account",
  },
  "has-password": {
    detail: "The user can sign in with their existing password, which links their account",
    title: "User already has a password",
  },
  linked: {
    detail:
      "Use send-password-reset for a user who already has a Better Auth account they have used",
    title: "User already has a Better Auth account",
  },
  "no-email": {
    detail: "Add an email to the user before issuing a sign-in link",
    title: "User has no email",
  },
};

/** `POST /:userId/security/revoke-sessions`: sign the user out on every device. */
export const revokeSessionsAction: SecurityRouteAction = {
  id: "revoke-sessions",
  isApplicable: ({state}) => state.sessions.active > 0,
  isSupported: (features) => features.betterAuth,
  method: "post",
  path: "/revoke-sessions",
  run: async ({service, target}): Promise<SecurityActionResult> => {
    const {jwtRefreshRevoked, revokedCount} = await service.revokeSessions(target);
    return {
      audit: {jwtRefreshRevoked, revokedCount},
      changed: revokedCount > 0 || jwtRefreshRevoked,
      data: {jwtRefreshRevoked, revokedCount},
    };
  },
};

/**
 * `POST /:userId/security/send-password-reset`: mail the user a Better Auth password-reset link.
 * 501 without `sendMail` or `publicAppUrl`; 409 for a user with no Better Auth account.
 */
export const sendPasswordResetAction: SecurityRouteAction = {
  id: "send-password-reset",
  isApplicable: ({state}) => state.betterAuthLinked,
  isSupported: (features) => features.betterAuth,
  method: "post",
  path: "/send-password-reset",
  run: async ({service, target}): Promise<SecurityActionResult> => {
    const result = await service.sendPasswordReset(target);
    if (result.sent) {
      return {audit: {}, changed: true, data: {sent: true}};
    }
    if (result.reason === "not-configured") {
      throw new TerrenoAPIError({
        detail: "Configure sendMail and publicAppUrl in BetterAuthConfig",
        status: 501,
        title: RESET_NOT_CONFIGURED_TITLE,
      });
    }
    throw new ConflictError({
      detail: "Issue a sign-in link instead, which creates the Better Auth account",
      title: NOT_LINKED_TITLE,
    });
  },
};

/**
 * `POST /:userId/security/disable`: set `User.disabled` and revoke every session. A disabled
 * user's remaining credentials are refused on REST (401) and on the socket handshake.
 */
export const disableAccountAction: SecurityRouteAction = {
  id: "disable",
  isApplicable: ({state}) => !state.disabled,
  isSupported: (features) => features.disableAccount,
  method: "post",
  path: "/disable",
  // Under the org-admin prefix "disable" suspends the membership instead (Q8, T9).
  platformOnly: true,
  run: async ({service, target}): Promise<SecurityActionResult> => {
    const {changed} = await service.setDisabled(target, true);
    if (!changed) {
      return {changed: false};
    }
    const {jwtRefreshRevoked, revokedCount} = await service.revokeSessions(target);
    return {
      audit: {jwtRefreshRevoked, revokedCount},
      changed: true,
      data: {jwtRefreshRevoked, revokedCount},
    };
  },
};

/** `POST /:userId/security/enable`: clear `User.disabled` so the user can sign in again. */
export const enableAccountAction: SecurityRouteAction = {
  id: "enable",
  isApplicable: ({state}) => state.disabled,
  isSupported: (features) => features.disableAccount,
  method: "post",
  path: "/enable",
  platformOnly: true,
  run: async ({service, target}): Promise<SecurityActionResult> =>
    service.setDisabled(target, false),
};

/**
 * `POST /:userId/security/issue-sign-in-link` (platform only, `user:issueSignInLink`): for a
 * legacy User with no Better Auth account and no password (a GitHub-JWT user), create the Better
 * Auth user, link it, and return a single-use set-password link `{url, expiresAt}` for the
 * administrator to hand over. The link is a password-reset token, so Better Auth's
 * `/reset-password` consumes it once. A link that was never used can be issued again.
 */
export const issueSignInLinkAction: SecurityRouteAction = {
  id: "issue-sign-in-link",
  isApplicable: ({state}) =>
    !state.legacyPassword &&
    (!state.betterAuthLinked ||
      (!state.emailVerified &&
        !state.password &&
        state.providers.length === 0 &&
        state.passkeys.count === 0)),
  isSupported: (features) => features.betterAuth,
  method: "post",
  path: "/issue-sign-in-link",
  platformOnly: true,
  requiredPermission: ISSUE_SIGN_IN_LINK_PERMISSION,
  run: async ({service, target}): Promise<SecurityActionResult> => {
    const result = await service.issueSignInLink(target);
    if (result.issued) {
      // The URL carries the token, so it goes to the administrator and never into the audit log.
      return {
        audit: {betterAuthId: result.betterAuthId, expiresAt: result.expiresAt},
        changed: true,
        data: {expiresAt: result.expiresAt, url: result.url},
      };
    }
    if (result.reason === "not-configured") {
      throw new TerrenoAPIError({
        detail: "Set publicAppUrl in BetterAuthConfig so the link opens the app's reset page",
        status: 501,
        title: SIGN_IN_LINK_NOT_CONFIGURED_TITLE,
      });
    }
    throw new ConflictError(SIGN_IN_LINK_REFUSALS[result.reason]);
  },
};
