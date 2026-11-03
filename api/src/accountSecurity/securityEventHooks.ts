/**
 * Records the security changes a user makes to their own account through Better Auth (linking a
 * provider, adding a passkey, turning on 2FA, changing their password, ...) as security actions
 * with `origin: "self"`. Each one writes a security `AuditEvent` (when AuditApp is registered) and
 * reaches every `onSecurityAction` listener, such as the notification emails.
 *
 * Only successful requests are recorded. Admin recovery actions never pass through these hooks:
 * they change Better Auth data through its adapters, not its endpoints, and record themselves.
 */

import type {BetterAuthPlugin} from "better-auth";
import {createAuthMiddleware} from "better-auth/api";

import type {UserModel} from "../auth";
import {logger} from "../logger";
import {findOneOrNoneFor} from "../plugins";
import {recordSecurityAction, type SecurityActionId} from "./securityEvents";

/** The app User linked to a Better Auth user, as a security principal id. */
const appUserIdFor = async (
  userModel: UserModel,
  betterAuthUserId: string
): Promise<string | undefined> => {
  const user = await findOneOrNoneFor(userModel, {betterAuthId: betterAuthUserId} as never);
  return user ? String((user as {_id: unknown})._id) : undefined;
};

/**
 * Records a security action the user made themselves, by their Better Auth user id. Does nothing
 * when no app User is linked yet. Never throws: a recording failure is logged.
 */
export const recordSelfSecurityAction = async ({
  action,
  betterAuthUserId,
  details,
  userModel,
}: {
  action: SecurityActionId;
  betterAuthUserId: string | undefined;
  details?: Record<string, unknown>;
  userModel: UserModel;
}): Promise<void> => {
  if (!betterAuthUserId) {
    return;
  }
  try {
    const userId = await appUserIdFor(userModel, betterAuthUserId);
    if (!userId) {
      return;
    }
    void recordSecurityAction({
      action,
      actor: {id: userId},
      ...(details ? {details} : {}),
      target: {id: userId},
    });
  } catch (error: unknown) {
    logger.error(`[AccountSecurity] Recording ${action} failed: ${error}`);
  }
};

interface HookSessionUser {
  id?: string;
  twoFactorEnabled?: boolean | null;
}

interface HookContext {
  body?: Record<string, unknown>;
  context: {
    getPlugin?: (id: string) => unknown;
    returned?: unknown;
    session?: {user?: HookSessionUser} | null;
  };
  path?: string;
}

interface AccountRow {
  id?: string;
  providerId?: string;
  userId?: string;
}

interface AccountHookAdapter {
  internalAdapter: {
    findAccounts: (userId: string) => Promise<AccountRow[]>;
    findUserById: (userId: string) => Promise<{twoFactorEnabled?: boolean | null} | null>;
  };
}

/** The endpoint context Better Auth hands database hooks (null outside an endpoint). */
interface DatabaseHookContext {
  context?: {session?: {user?: HookSessionUser} | null};
  path?: string;
}

/** The endpoints that can turn two-factor on or off for the signed-in user. */
const TWO_FACTOR_PATHS = new Set([
  "/two-factor/disable",
  "/two-factor/enable",
  "/two-factor/verify-otp",
  "/two-factor/verify-totp",
]);

const isSuccess = (returned: unknown): boolean => !(returned instanceof Error);

const stringOf = (value: unknown): string | undefined =>
  typeof value === "string" && value.length > 0 ? value : undefined;

/** The session user as it was when the request started (before the endpoint changed it). */
const sessionUserOf = (ctx: HookContext): HookSessionUser | undefined =>
  ctx.context.session?.user ?? undefined;

/**
 * Two-factor changes seen by the `user.update.before` database hook, by Better Auth user id:
 * the value the endpoint is writing, recorded only when it differs from the stored one. The
 * endpoint's after hook takes the entry and records it if the request succeeded.
 */
type TwoFactorChanges = Map<string, boolean>;

/** The two-factor change this request made, read (and cleared) from the update hook's notes. */
const takeTwoFactorChange = (
  ctx: HookContext,
  changes: TwoFactorChanges
): {action: SecurityActionId} | undefined => {
  const userId = sessionUserOf(ctx)?.id;
  if (!userId || !changes.has(userId)) {
    return undefined;
  }
  const enabled = changes.get(userId);
  changes.delete(userId);
  if (!isSuccess(ctx.context.returned)) {
    return undefined;
  }
  return {action: enabled ? "two-factor-enabled" : "two-factor-disabled"};
};

/** Which self-service action a successful request to `path` records, and its details. */
const actionFor = (
  ctx: HookContext
): {action: SecurityActionId; details?: Record<string, unknown>} | undefined => {
  switch (ctx.path) {
    case "/change-password":
      return {action: "password-changed"};
    case "/terreno/set-password":
      return {action: "password-set"};
    case "/revoke-other-sessions":
      return {action: "other-sessions-revoked"};
    case "/passkey/verify-registration": {
      const passkeyId = stringOf((ctx.context.returned as {id?: unknown} | undefined)?.id);
      return {action: "passkey-added", ...(passkeyId ? {details: {passkeyId}} : {})};
    }
    case "/passkey/delete-passkey": {
      const passkeyId = stringOf(ctx.body?.id);
      return {action: "passkey-removed", ...(passkeyId ? {details: {passkeyId}} : {})};
    }
    default:
      return undefined;
  }
};

const RECORDED_PATHS = new Set([
  "/change-password",
  "/passkey/delete-passkey",
  "/passkey/verify-registration",
  "/revoke-other-sessions",
  "/terreno/set-password",
  ...TWO_FACTOR_PATHS,
]);

/**
 * The Better Auth plugin that records self-service security changes. `createBetterAuth` adds it
 * whenever it has a `userModel` (security principals are app User ids).
 *
 * - Endpoint `hooks.after`: `/change-password` (password-changed), `/terreno/set-password`
 *   (password-set, a first password for an OAuth- or passkey-only user), `/revoke-other-sessions`
 *   (other-sessions-revoked), `/passkey/verify-registration` (passkey-added),
 *   `/passkey/delete-passkey` (passkey-removed), and a successful `/two-factor/*` request that
 *   changed the user's stored `twoFactorEnabled` (two-factor-enabled / two-factor-disabled). The
 *   change is detected by a `user.update.before` database hook that compares the value being
 *   written with the user row in the database, not with the (possibly cookie-cached) session.
 *   So enrolment counts once, the 2FA step of a sign-in never does, and admin resets (which run
 *   outside any Better Auth endpoint) are not mistaken for the user's own change.
 * - Database hooks, because they see the account row: a non-password `account` created for a
 *   user who already had another sign-in method (provider-linked, from `/link-social`, the link
 *   callback, the OAuth handoff, or implicit linking on sign-in), and an account deleted by
 *   `/unlink-account` (provider-unlinked). A first account is a sign-up, not a link.
 *
 * A completed `/reset-password` is recorded from `onPasswordReset` in `createBetterAuth`
 * (password-reset), which knows the user the token belonged to.
 */
export const createSecurityEventsPlugin = (userModel: UserModel): BetterAuthPlugin => {
  const twoFactorChanges: TwoFactorChanges = new Map();
  return {
    hooks: {
      after: [
        {
          handler: createAuthMiddleware(async (rawCtx): Promise<void> => {
            const ctx = rawCtx as unknown as HookContext;
            const recorded = TWO_FACTOR_PATHS.has(ctx.path ?? "")
              ? takeTwoFactorChange(ctx, twoFactorChanges)
              : isSuccess(ctx.context.returned)
                ? actionFor(ctx)
                : undefined;
            if (!recorded) {
              return;
            }
            await recordSelfSecurityAction({
              ...recorded,
              betterAuthUserId: sessionUserOf(ctx)?.id,
              userModel,
            });
          }),
          matcher: (context): boolean => RECORDED_PATHS.has(context.path ?? ""),
        },
      ],
    },
    id: "terreno-security-events",
    init: (authContext) => {
      const {internalAdapter} = authContext as unknown as AccountHookAdapter;
      return {
        options: {
          databaseHooks: {
            account: {
              create: {
                after: async (account): Promise<void> => {
                  const row = account as AccountRow;
                  if (!row.userId || !row.providerId || row.providerId === "credential") {
                    return;
                  }
                  try {
                    const accounts = await internalAdapter.findAccounts(row.userId);
                    if (accounts.length < 2) {
                      return;
                    }
                  } catch (error: unknown) {
                    logger.error(
                      `[AccountSecurity] Reading accounts for a new link failed: ${error}`
                    );
                    return;
                  }
                  await recordSelfSecurityAction({
                    action: "provider-linked",
                    betterAuthUserId: row.userId,
                    details: {providerId: row.providerId},
                    userModel,
                  });
                },
              },
              delete: {
                after: async (account, rawContext): Promise<void> => {
                  const context = rawContext as {path?: string} | null;
                  if (context?.path !== "/unlink-account") {
                    return;
                  }
                  const row = account as AccountRow;
                  await recordSelfSecurityAction({
                    action: "provider-unlinked",
                    betterAuthUserId: row.userId,
                    ...(row.providerId ? {details: {providerId: row.providerId}} : {}),
                    userModel,
                  });
                },
              },
            },
            user: {
              update: {
                before: async (data, rawContext): Promise<void> => {
                  const context = rawContext as DatabaseHookContext | null;
                  const next = (data as {twoFactorEnabled?: unknown}).twoFactorEnabled;
                  const userId = context?.context?.session?.user?.id;
                  if (
                    typeof next !== "boolean" ||
                    !userId ||
                    !TWO_FACTOR_PATHS.has(context?.path ?? "")
                  ) {
                    return;
                  }
                  try {
                    const stored = await internalAdapter.findUserById(userId);
                    if ((stored?.twoFactorEnabled === true) !== next) {
                      twoFactorChanges.set(userId, next);
                    }
                  } catch (error: unknown) {
                    logger.error(`[AccountSecurity] Reading two-factor state failed: ${error}`);
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
