/**
 * Structural types for the Better Auth client surface consumed by
 * {@link ../auth/betterAuthAdapter!betterAuthAdapter}. Better Auth is NOT a
 * dependency of this package — these narrow interfaces describe just the
 * pieces syncdb touches (the shape produced by `createBetterAuthClient`
 * and the admin-spa client), so any object matching them works.
 */

/** The user portion of a Better Auth session. */
export interface BetterAuthUserLike {
  id?: string | null;
}

/** The session portion of a Better Auth session (carries the bearer token). */
export interface BetterAuthSessionLike {
  token?: string | null;
}

/** Combined session payload: `{session, user}`. */
export interface BetterAuthSessionDataLike {
  session?: BetterAuthSessionLike | null;
  user?: BetterAuthUserLike | null;
}

/**
 * What `authClient.getSession()` resolves to. Better Auth wraps the payload in
 * a `{data}` envelope; some wrappers unwrap it — the adapter tolerates both,
 * plus null/undefined when signed out.
 */
export type BetterAuthGetSessionResult =
  | {data?: BetterAuthSessionDataLike | null}
  | BetterAuthSessionDataLike
  | null
  | undefined;

/**
 * Nanostore-style session atom exposed by Better Auth clients
 * (`authClient.useSession.subscribe(listener)` returns an unsubscribe).
 */
export interface BetterAuthSessionAtomLike {
  subscribe?: (listener: (value: unknown) => void) => () => void;
}

/** Minimal Better Auth client surface required by the adapter. */
export interface BetterAuthClientLike {
  getSession: () => Promise<BetterAuthGetSessionResult>;
  /** Present on nanostore-backed clients; enables poll-free auth-change delivery. */
  useSession?: BetterAuthSessionAtomLike;
}
