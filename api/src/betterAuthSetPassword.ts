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
 * - with a `userModel`, the app User linked by `betterAuthId` gets the same passport password
 *   when it already has one (a dual-enrolled account), so a JWT sign-in with the same email and
 *   password keeps working, and its `tokenEpoch` is bumped. A Better Auth only account never
 *   gains a legacy password: the JWT `POST /auth/login` has no second factor.
 *
 * `/change-password` (and session revocation) reach the legacy credential through the credential
 * sync plugin in `betterAuthSetup.ts`, which follows the same rule and bumps `tokenEpoch`.
 *
 * The security events plugin records a successful set as `password-set`.
 */

import type {BetterAuthPlugin} from "better-auth";
import {
  createAuthEndpoint,
  freshSessionMiddleware,
  sensitiveSessionMiddleware,
} from "better-auth/api";
import {z} from "zod";

import {type HasSetPassword, setPasswordForUser, type UserModel} from "./auth";
import {logger} from "./logger";
import {findOneOrNoneFor} from "./plugins";

/** The path the plugin serves, under Better Auth's `basePath`. */
const SET_PASSWORD_PATH = "/terreno/set-password";

const setPasswordBodySchema = z.object({
  newPassword: z.string().meta({description: "The password to add to the account"}),
});

interface PassportUserDoc {
  _id?: unknown;
  betterAuthId?: string;
  save: () => Promise<unknown>;
  setPassword?: unknown;
  tokenEpoch?: number;
}

/**
 * The app User linked to a Better Auth user by `betterAuthId`. There is no email fallback: the
 * app user sync links the User before any session exists, and an email match alone does not
 * prove the session owns that User.
 */
const findLinkedAppUser = async (
  userModel: UserModel,
  betterAuthUserId: string
): Promise<PassportUserDoc | null> =>
  (await findOneOrNoneFor(userModel, {
    betterAuthId: betterAuthUserId,
  } as never)) as unknown as PassportUserDoc | null;

/**
 * Sets the passport-local-mongoose hash of the linked app User to the new password, only when
 * it already has one, so a Better Auth only account does not gain a second way to sign in. Like
 * every server-side password change, replacing it bumps `tokenEpoch`, so JWT refresh tokens
 * issued under the old password stop working. Does nothing when no app User is linked or the
 * model has no passport plugin. Never throws: Better Auth already holds the password, so a
 * failure is logged.
 */
const syncPasswordToAppUser = async ({
  betterAuthUserId,
  password,
  userModel,
}: {
  betterAuthUserId: string;
  password: string;
  userModel: UserModel;
}): Promise<void> => {
  try {
    const appUser = await findLinkedAppUser(userModel, betterAuthUserId);
    if (!appUser || typeof appUser.setPassword !== "function") {
      return;
    }
    const hasLegacyPassword =
      userModel.schema.path("hash") !== undefined &&
      Boolean(
        await userModel.exists({_id: appUser._id, hash: {$exists: true, $ne: null}} as never)
      );
    if (!hasLegacyPassword) {
      return;
    }
    await setPasswordForUser(appUser as unknown as HasSetPassword, password);
    if (userModel.schema.path("tokenEpoch") !== undefined) {
      appUser.tokenEpoch = (appUser.tokenEpoch ?? 0) + 1;
    }
    await appUser.save();
  } catch (error: unknown) {
    logger.error(`[better-auth] Syncing a new password to the app User failed: ${error}`);
  }
};

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
        await syncPasswordToAppUser({betterAuthUserId: userId, password: newPassword, userModel});
      }
      ctx.setHeader("cache-control", "no-store");
      return ctx.json({status: true});
    }
  );
  return {
    endpoints: {terrenoSetPassword},
    id: "terreno-set-password",
  } satisfies BetterAuthPlugin;
};
