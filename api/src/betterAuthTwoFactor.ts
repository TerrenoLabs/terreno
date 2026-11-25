/**
 * Session-free Better Auth two-factor checks, for code that must verify a user in-process (the
 * built-in MCP OAuth consent page) rather than through a Better Auth sign-in.
 *
 * Better Auth has no public API for this. `auth.api.verifyTOTP` (`/two-factor/verify-totp`)
 * needs a session or the two-factor cookie that sign-in sets, signs the user in by minting a
 * session, and doesn't say which time step matched, which a replay check needs. So these helpers
 * read Better Auth's `$context` (the internal adapter, the `twoFactor` table, and the secret
 * config) the way `verifyBetterAuthCredentialPassword` reads credential accounts. Keep every such
 * access behind this module, whose tests break on a Better Auth upgrade that changes them.
 */
import {createHmac, timingSafeEqual} from "node:crypto";
import {symmetricDecrypt} from "better-auth/crypto";
import {DateTime} from "luxon";

import type {BetterAuthInstance} from "./betterAuthSetup";

/** Better Auth's TOTP period: 30-second steps. */
export const BETTER_AUTH_TOTP_PERIOD_SECONDS = 30;
/** Steps either side of the current one accepted for clock drift, as Better Auth's verify does. */
export const BETTER_AUTH_TOTP_WINDOW = 1;
const TOTP_DIGITS = 6;

interface TwoFactorContext {
  adapter: {
    findOne: <T>(args: {
      model: string;
      where: {field: string; value: string}[];
    }) => Promise<T | null>;
  };
  internalAdapter: {
    findUserByEmail: (email: string) => Promise<{user: {id: string}} | null>;
    findUserById: (userId: string) => Promise<{twoFactorEnabled?: boolean | null} | null>;
  };
  secretConfig: Parameters<typeof symmetricDecrypt>[0]["key"];
}

const contextOf = async (auth: BetterAuthInstance): Promise<TwoFactorContext> =>
  (await auth.$context) as unknown as TwoFactorContext;

/** The Better Auth user id for `email`, or null when no Better Auth user has it. */
export const findBetterAuthUserIdByEmail = async (
  auth: BetterAuthInstance,
  email: string
): Promise<string | null> => {
  if (!email) {
    return null;
  }
  const found = await (await contextOf(auth)).internalAdapter.findUserByEmail(email);
  return found?.user.id ?? null;
};

/** Whether the Better Auth user has two-factor turned on. */
export const isBetterAuthTwoFactorEnabled = async (
  auth: BetterAuthInstance,
  betterAuthUserId: string
): Promise<boolean> => {
  if (!betterAuthUserId) {
    return false;
  }
  const user = await (await contextOf(auth)).internalAdapter.findUserById(betterAuthUserId);
  return user?.twoFactorEnabled === true;
};

/** One RFC 4226 HOTP value: HMAC-SHA1, dynamic truncation, six digits. */
const hotp = (key: Buffer, counter: number): string => {
  const message = Buffer.alloc(8);
  message.writeBigUInt64BE(BigInt(counter));
  const digest = createHmac("sha1", key).update(message).digest();
  const offset = digest[digest.length - 1] & 0x0f;
  const value = (digest.readUInt32BE(offset) & 0x7fffffff) % 10 ** TOTP_DIGITS;
  return String(value).padStart(TOTP_DIGITS, "0");
};

/**
 * The RFC 6238 time step that `code` matches for the user's verified Better Auth TOTP secret,
 * within the drift window, or null (no two-factor record, an unverified one, or a wrong code).
 * The caller spends the step to stop a replay.
 */
export const matchBetterAuthTotpStep = async (
  auth: BetterAuthInstance,
  betterAuthUserId: string,
  code: string,
  now: DateTime = DateTime.now()
): Promise<number | null> => {
  if (!betterAuthUserId || !/^\d{6}$/.test(code)) {
    return null;
  }
  const context = await contextOf(auth);
  const twoFactor = await context.adapter.findOne<{secret: string; verified?: boolean | null}>({
    model: "twoFactor",
    where: [{field: "userId", value: betterAuthUserId}],
  });
  if (!twoFactor || twoFactor.verified === false) {
    return null;
  }
  // Better Auth stores the secret encrypted and keys HMAC with the decrypted string's bytes.
  const secret = await symmetricDecrypt({data: twoFactor.secret, key: context.secretConfig});
  const key = Buffer.from(secret, "utf8");
  const current = Math.floor(now.toSeconds() / BETTER_AUTH_TOTP_PERIOD_SECONDS);
  let matched: number | null = null;
  // Check every step in the window so timing doesn't reveal which one matched.
  for (let offset = -BETTER_AUTH_TOTP_WINDOW; offset <= BETTER_AUTH_TOTP_WINDOW; offset += 1) {
    const step = current + offset;
    if (timingSafeEqual(Buffer.from(hotp(key, step)), Buffer.from(code))) {
      matched = step;
    }
  }
  return matched;
};
