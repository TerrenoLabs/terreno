/**
 * Credential recovery actions: remove one of a user's passkeys, and unlink a sign-in provider.
 *
 * Unlinking never removes the password (`credential`) account. Neither action leaves a user with
 * no way to sign in: removing the last sign-in method is allowed only when the user's email is
 * verified, and then a password-reset link is mailed so they can set a password (Q5).
 */

import type {Request} from "express";

import type {User} from "../auth";
import {BadRequestError, ConflictError, NotFoundError} from "../errors";
import {logger} from "../logger";
import type {
  SecurityActionContext,
  SecurityActionResult,
  SecurityRouteAction,
} from "./accountSecurityApp";
import {
  type AccountSecurityCredentials,
  type AccountSecurityFeatures,
  type AccountSecurityService,
  PASSWORD_PROVIDER_ID,
  userIdOf,
} from "./accountSecurityService";
import {recordSecurityAction} from "./securityEvents";

const PASSKEY_NOT_FOUND_TITLE = "Passkey not found";

const PROVIDER_NOT_LINKED_TITLE = "Provider not linked";

const LAST_METHOD_TITLE = "Cannot remove the last sign-in method";

const RESET_NOT_CONFIGURED_TITLE = "Password reset email is not configured";

const PASSWORD_NOT_UNLINKABLE_TITLE = "The password cannot be unlinked";

const routeParam = (req: Request, name: string): string => {
  const value = req.params[name];
  return typeof value === "string" ? value : "";
};

/** Every sign-in method the user still has: accounts (including the password) and passkeys. */
const signInMethodCount = (credentials: AccountSecurityCredentials): number =>
  credentials.accounts.length + credentials.passkeys.length;

/**
 * Before removing a sign-in method: refuses (409) to remove the user's last one unless their
 * email is verified, and then mails a password reset first, so a delivery failure removes nothing.
 * Returns whether a reset was sent.
 */
const guardLastSignInMethod = async ({
  remaining,
  credentials,
  service,
  target,
}: {
  credentials: AccountSecurityCredentials;
  remaining: number;
  service: AccountSecurityService;
  target: User;
}): Promise<boolean> => {
  if (remaining > 0) {
    return false;
  }
  if (!credentials.emailVerified) {
    throw new ConflictError({
      detail: "The user's email is not verified, so a password reset cannot replace this method",
      title: LAST_METHOD_TITLE,
    });
  }
  const reset = await service.sendPasswordReset(target);
  if (!reset.sent) {
    throw new ConflictError({
      detail:
        "Configure sendMail and publicAppUrl in BetterAuthConfig so the user can set a password",
      title: RESET_NOT_CONFIGURED_TITLE,
    });
  }
  return true;
};

/**
 * After removing a sign-in method: a concurrent removal may have taken the user's last other
 * method after the guard counted it. When nothing is left and no reset went out yet, mail one now
 * if the email is verified. The removal already happened, so a failed send is logged, not thrown.
 * Returns whether a reset has been sent for this action.
 */
const ensureRecoverable = async ({
  features,
  resetSent,
  service,
  target,
}: {
  features: AccountSecurityFeatures;
  resetSent: boolean;
  service: AccountSecurityService;
  target: User;
}): Promise<boolean> => {
  if (resetSent) {
    return true;
  }
  const after = await service.readCredentials(target, features);
  if (!after || signInMethodCount(after) > 0) {
    return false;
  }
  if (!after.emailVerified) {
    logger.error(
      `User ${userIdOf(target)} has no sign-in method left after concurrent recovery actions, and an unverified email`
    );
    return false;
  }
  try {
    const reset = await service.sendPasswordReset(target);
    return reset.sent;
  } catch (error: unknown) {
    logger.error(`Could not mail a password reset to user ${userIdOf(target)}`, error);
    return false;
  }
};

/**
 * Records the reset mail of an action that then found nothing to remove (another request removed
 * it first), so a reset link never goes out unaudited.
 */
const recordOrphanedReset = ({
  actor,
  details,
  org,
  target,
}: Pick<SecurityActionContext, "actor" | "org" | "target"> & {
  details: Record<string, unknown>;
}): void => {
  void recordSecurityAction({
    action: "send-password-reset",
    actor: {id: userIdOf(actor)},
    details: {...details, reason: "last-sign-in-method"},
    org,
    target: {id: userIdOf(target)},
  });
};

const runRemovePasskey = async ({
  actor,
  features,
  org,
  req,
  service,
  target,
}: SecurityActionContext): Promise<SecurityActionResult> => {
  const passkeyId = routeParam(req, "passkeyId");
  const credentials = await service.readCredentials(target, features);
  const passkey = credentials?.passkeys.find((item) => item.id === passkeyId);
  if (!credentials || !passkey) {
    throw new NotFoundError(PASSKEY_NOT_FOUND_TITLE);
  }
  const sentBefore = await guardLastSignInMethod({
    credentials,
    remaining: signInMethodCount(credentials) - 1,
    service,
    target,
  });
  const removed = await service.deletePasskey({
    betterAuthId: credentials.betterAuthId,
    passkeyId: passkey.id,
  });
  if (!removed) {
    // Removed by someone else between the read and the delete.
    if (sentBefore) {
      recordOrphanedReset({actor, details: {passkeyId: passkey.id}, org, target});
    }
    throw new NotFoundError(PASSKEY_NOT_FOUND_TITLE);
  }
  const passwordResetSent = await ensureRecoverable({
    features,
    resetSent: sentBefore,
    service,
    target,
  });
  return {
    audit: {passkeyId: passkey.id, passkeyName: passkey.name, passwordResetSent},
    changed: true,
    data: {passkeyId: passkey.id, passwordResetSent},
  };
};

const runUnlinkProvider = async ({
  actor,
  features,
  org,
  req,
  service,
  target,
}: SecurityActionContext): Promise<SecurityActionResult> => {
  const providerId = routeParam(req, "providerId");
  if (providerId === PASSWORD_PROVIDER_ID) {
    throw new BadRequestError({
      detail: "Send a password reset instead; this route only unlinks sign-in providers",
      title: PASSWORD_NOT_UNLINKABLE_TITLE,
    });
  }
  const credentials = await service.readCredentials(target, features);
  const accountCount =
    credentials?.accounts.filter((account) => account.providerId === providerId).length ?? 0;
  if (!credentials || accountCount === 0) {
    throw new NotFoundError(PROVIDER_NOT_LINKED_TITLE);
  }
  const sentBefore = await guardLastSignInMethod({
    credentials,
    remaining: signInMethodCount(credentials) - accountCount,
    service,
    target,
  });
  const removed = await service.deleteAccounts({
    betterAuthId: credentials.betterAuthId,
    providerId,
  });
  if (removed === 0) {
    // Unlinked by someone else between the read and the delete.
    if (sentBefore) {
      recordOrphanedReset({actor, details: {providerId}, org, target});
    }
    throw new NotFoundError(PROVIDER_NOT_LINKED_TITLE);
  }
  const passwordResetSent = await ensureRecoverable({
    features,
    resetSent: sentBefore,
    service,
    target,
  });
  return {
    audit: {accountCount: removed, passwordResetSent, providerId},
    changed: true,
    data: {accountCount: removed, passwordResetSent, providerId},
  };
};

/** `DELETE /:userId/security/passkeys/:passkeyId`: remove one of the user's passkeys. */
export const removePasskeyAction: SecurityRouteAction = {
  id: "remove-passkey",
  isApplicable: ({state}) => state.passkeys.count > 0,
  isSupported: (features) => features.passkey,
  method: "delete",
  path: "/passkeys/:passkeyId",
  run: runRemovePasskey,
};

/**
 * `DELETE /:userId/security/accounts/:providerId`: unlink every account the user has with that
 * provider. Provider account ids are never exposed, so a user who linked two accounts of one
 * provider loses both.
 */
export const unlinkProviderAction: SecurityRouteAction = {
  id: "unlink-provider",
  isApplicable: ({state}) => state.providers.length > 0,
  isSupported: (features) => features.betterAuth,
  method: "delete",
  path: "/accounts/:providerId",
  run: runUnlinkProvider,
};
