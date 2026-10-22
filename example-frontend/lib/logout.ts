/** A sync client that can be signed out (stopped, and wiped when `wipeOnSignOut` is set). */
interface SignOutClient {
  signOut: () => Promise<void>;
}

/**
 * Explicit user logout. Signs the sync clients out first, while they still know the current
 * user, so `wipeOnSignOut` clears that user's local rows and queued writes. Ending the session
 * first would let the root layout's `stop()` (run when `userId` clears) forget the user before
 * the wipe. A failed sync sign-out never blocks the session logout.
 */
export const logoutAndWipe = async ({
  logout,
  syncDbs,
}: {
  logout: () => Promise<void>;
  syncDbs: readonly SignOutClient[];
}): Promise<void> => {
  for (const client of syncDbs) {
    try {
      await client.signOut();
    } catch (error: unknown) {
      console.error("[logout] Sync client sign out failed", error);
    }
  }
  await logout();
};
