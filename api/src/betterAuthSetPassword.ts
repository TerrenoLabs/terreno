/**
 * Set a first password for a signed-in user who has none (they signed up with a social or
 * generic OAuth provider, or a passkey), and keep the app User's JWT password in step with the
 * Better Auth one.
 *
 * Better Auth's own `setPassword` is server-only, so a security screen cannot call it. This
 * plugin serves `POST {basePath}/terreno/set-password` (`{newPassword}`) for the signed-in user:
 * - the session must be fresh (`freshSessionMiddleware`: signed in within Better Auth's
 *   `session.freshAge`, a day by default), so a stolen old session cannot add a lasting password,
 *   and it is read from the database, not the cookie cache (`sensitiveSessionMiddleware`), so a
 *   revoked session cannot either;
 * - it is refused (409 `PASSWORD_ALREADY_SET`) when the user already has a password: changing one
 *   goes through `/change-password`, which checks the current password. Two concurrent requests
 *   leave one password: the later credential row is removed and its request refused;
 * - the new password follows Better Auth's `minPasswordLength` / `maxPasswordLength`;
 * - with a `userModel`, the app User's passport hash is set too, so a JWT sign-in with the same
 *   email and password works on dual-enrolled apps.
 *
 * With a `userModel`, a successful `/change-password` also sets the app User's passport hash and
 * bumps its `tokenEpoch`, so the old password stops working at `POST /auth/login` (which has no
 * second factor) and outstanding JWT refresh tokens stop refreshing.
 *
 * The security events plugin records a successful set as `password-set`.
 */

import type {BetterAuthPlugin} from "better-auth";
import {
  createAuthEndpoint,
  createAuthMiddleware,
  freshSessionMiddleware,
  sensitiveSessionMiddleware,
} from "better-auth/api";
import {z} from "zod";

import {type HasSetPassword, setPasswordForUser, type UserModel} from "./auth";
import {logger} from "./logger";
import {findOneOrNoneFor} from "./plugins";

/** The path the plugin serves, under Better Auth's `basePath`. */
const SET_PASSWORD_PATH = "/terreno/set-password";

const CHANGE_PASSWORD_PATH = "/change-password";

const setPasswordBodySchema = z.object({
  newPassword: z.string().meta({description: "The password to add to the account"}),
});

interface PassportUserDoc {
  betterAuthId?: string;
  save: () => Promise<unknown>;
  setPassword?: unknown;
  tokenEpoch?: number;
}

/** The Better Auth session user fields the JWT sync reads. */
interface SessionUserLike {
  email?: string | null;
  emailVerified?: boolean | null;
  id: string;
}

/**
 * The app User for a Better Auth user: the one carrying its id, or else the one with its email.
 * The email fallback applies only to a verified Better Auth email and never to an app User linked
 * to another Better Auth user, so a session cannot set the password of an account it has not
 * proved it owns.
 */
const findAppUserFor = async (
  userModel: UserModel,
  user: SessionUserLike
): Promise<PassportUserDoc | null> => {
  const byId = (await findOneOrNoneFor(userModel, {
    betterAuthId: user.id,
  } as never)) as unknown as PassportUserDoc | null;
  if (byId) {
    return byId;
  }
  if (!user.email || user.emailVerified !== true) {
    return null;
  }
  const byEmail = (await findOneOrNoneFor(userModel, {
    email: user.email,
  } as never)) as unknown as PassportUserDoc | null;
  if (byEmail?.betterAuthId && byEmail.betterAuthId !== user.id) {
    return null;
  }
  return byEmail;
};

/**
 * Sets the app User's passport-local-mongoose hash to the new password, and with
 * `bumpTokenEpoch` invalidates its JWT refresh tokens. Does nothing when no app User matches or
 * the model has no passport plugin. Never throws: Better Auth already holds the password, so a
 * failure is logged.
 */
const syncPasswordToAppUser = async ({
  bumpTokenEpoch,
  password,
  user,
  userModel,
}: {
  bumpTokenEpoch: boolean;
  password: string;
  user: SessionUserLike;
  userModel: UserModel;
}): Promise<void> => {
  try {
    const appUser = await findAppUserFor(userModel, user);
    if (!appUser || typeof appUser.setPassword !== "function") {
      return;
    }
    await setPasswordForUser(appUser as unknown as HasSetPassword, password);
    if (bumpTokenEpoch) {
      appUser.tokenEpoch = (appUser.tokenEpoch ?? 0) + 1;
    }
    await appUser.save();
  } catch (error: unknown) {
    logger.error(`[better-auth] Syncing a new password to the app User failed: ${error}`);
  }
};

/** The parts of a Better Auth `/change-password` after-hook context the JWT sync reads. */
interface ChangePasswordHookContext {
  body?: {newPassword?: unknown};
  context: {returned?: unknown; session?: {user?: SessionUserLike} | null};
}

interface CredentialRow {
  createdAt?: Date | string;
  id: string;
  providerId: string;
}

const createdAtOf = (row: CredentialRow): number =>
  row.createdAt ? new Date(row.createdAt).getTime() : 0;

/** The credential row that wins when concurrent requests each created one: the oldest. */
const firstCredential = (rows: CredentialRow[]): CredentialRow | undefined =>
  [...rows]
    .filter((row) => row.providerId === "credential")
    .sort((a, b) => createdAtOf(a) - createdAtOf(b) || String(a.id).localeCompare(String(b.id)))[0];

/**
 * The Better Auth plugin `createBetterAuth` always adds for `POST {basePath}/terreno/set-password`.
 */
export const createSetPasswordPlugin = ({
  userModel,
}: {
  userModel?: UserModel;
} = {}): BetterAuthPlugin => {
  const terrenoSetPassword = createAuthEndpoint(
    SET_PASSWORD_PATH,
    {
      body: setPasswordBodySchema,
      method: "POST",
      use: [sensitiveSessionMiddleware, freshSessionMiddleware],
    },
    async (ctx) => {
      if (ctx.context.options.emailAndPassword?.enabled !== true) {
        throw ctx.error("BAD_REQUEST", {
          code: "EMAIL_PASSWORD_DISABLED",
          message: "Email and password sign-in is turned off",
        });
      }
      const {newPassword} = ctx.body;
      const {minPasswordLength, maxPasswordLength} = ctx.context.password.config;
      if (newPassword.length < minPasswordLength) {
        throw ctx.error("BAD_REQUEST", {
          code: "PASSWORD_TOO_SHORT",
          message: "Password too short",
        });
      }
      if (newPassword.length > maxPasswordLength) {
        throw ctx.error("BAD_REQUEST", {code: "PASSWORD_TOO_LONG", message: "Password too long"});
      }
      const sessionUser = ctx.context.session.user;
      const userId = sessionUser.id;
      const alreadySet = (): Error =>
        ctx.error("CONFLICT", {
          code: "PASSWORD_ALREADY_SET",
          message: "User already has a password set",
        });
      const account = await ctx.context.internalAdapter.findCredentialAccount(userId);
      if (account?.password) {
        throw alreadySet();
      }
      const passwordHash = await ctx.context.password.hash(newPassword);
      if (account) {
        // Only fills a row that still has no password, so a concurrent set cannot be overwritten.
        const filled = await ctx.context.adapter.update<CredentialRow>({
          model: "account",
          update: {password: passwordHash, updatedAt: new Date()},
          where: [
            {field: "id", value: account.id},
            {field: "password", value: null},
          ],
        });
        if (!filled) {
          throw alreadySet();
        }
      } else {
        const created = await ctx.context.internalAdapter.linkAccount({
          accountId: userId,
          password: passwordHash,
          providerId: "credential",
          userId,
        });
        // A concurrent request may have created a credential row too; the oldest one stays.
        const rows = (await ctx.context.internalAdapter.findAccounts(userId)) as CredentialRow[];
        const winner = firstCredential(rows);
        if (winner && String(winner.id) !== String(created.id)) {
          await ctx.context.internalAdapter.deleteAccount(created.id);
          throw alreadySet();
        }
      }
      if (userModel) {
        await syncPasswordToAppUser({
          bumpTokenEpoch: false,
          password: newPassword,
          user: sessionUser,
          userModel,
        });
      }
      ctx.setHeader("cache-control", "no-store");
      return ctx.json({status: true});
    }
  );
  return {
    endpoints: {terrenoSetPassword},
    ...(userModel
      ? {
          hooks: {
            after: [
              {
                // A changed Better Auth password replaces the app User's JWT password too.
                handler: createAuthMiddleware(async (rawCtx): Promise<void> => {
                  const ctx = rawCtx as unknown as ChangePasswordHookContext;
                  const password = ctx.body?.newPassword;
                  const user = ctx.context.session?.user;
                  if (ctx.context.returned instanceof Error || typeof password !== "string") {
                    return;
                  }
                  if (!user?.id) {
                    return;
                  }
                  await syncPasswordToAppUser({bumpTokenEpoch: true, password, user, userModel});
                }),
                matcher: (context): boolean => context.path === CHANGE_PASSWORD_PATH,
              },
            ],
          },
        }
      : {}),
    id: "terreno-set-password",
  } satisfies BetterAuthPlugin;
};
