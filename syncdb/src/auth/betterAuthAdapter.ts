import type {AuthProvider} from "../types";
import type {
  BetterAuthClientLike,
  BetterAuthGetSessionResult,
  BetterAuthSessionDataLike,
} from "./types";

/** Default polling cadence when the client exposes no session subscription. */
export const DEFAULT_AUTH_POLL_INTERVAL_MS = 5_000;

export interface BetterAuthAdapterOptions {
  /** Polling cadence for the fallback watcher (default {@link DEFAULT_AUTH_POLL_INTERVAL_MS}). */
  pollIntervalMs?: number;
  /** Interval scheduler, injectable for deterministic tests (default global setInterval). */
  setIntervalFn?: (handler: () => void, ms: number) => unknown;
  /** Interval canceller matching `setIntervalFn` (default global clearInterval). */
  clearIntervalFn?: (handle: unknown) => void;
  /**
   * Synchronous bearer-token reader, for clients that keep the session token locally
   * (for example rtk's `getBetterAuthBearerToken` in web bearer mode). When it returns a
   * token, `getToken` uses it without calling `getSession()`. A null or empty result, or a
   * throw, falls back to reading `getSession()`. `getUserId`, `onAuthChange` and `refresh`
   * always read the session.
   */
  getBearerToken?: () => string | null;
}

/**
 * Unwrap `getSession()` results: Better Auth returns a `{data}` envelope, some
 * wrappers return the payload directly, and signed-out states are null-ish.
 */
const unwrapSession = (result: unknown): BetterAuthSessionDataLike | null => {
  if (!result || typeof result !== "object") {
    return null;
  }
  if ("data" in result) {
    const data = (result as {data?: BetterAuthSessionDataLike | null}).data;
    return data && typeof data === "object" ? data : null;
  }
  return result as BetterAuthSessionDataLike;
};

/** True for an error whose status says the server has no session for this client. */
const isUnauthorizedError = (error: unknown): boolean => {
  return (
    Boolean(error) && typeof error === "object" && (error as {status?: unknown}).status === 401
  );
};

/**
 * True for a `{error}` envelope from a fetch that failed: Better Auth's client returns one
 * instead of rejecting for many failures. A 401 is the server saying "signed out", so it
 * stays a successful (signed-out) read.
 */
const isFailedReadEnvelope = (result: unknown): boolean => {
  if (!result || typeof result !== "object" || !("error" in result)) {
    return false;
  }
  const error = (result as {error?: unknown}).error;
  if (!error) {
    return false;
  }
  return !isUnauthorizedError(error);
};

/**
 * Adapt a Better Auth client to syncdb's {@link AuthProvider} contract.
 * Tokens and user ids are read per call via `getSession()`, unless
 * `options.getBearerToken` supplies the token. Tokens are never cached, so
 * Better Auth session refresh is picked up transparently. Auth changes are
 * delivered through the client's nanostore session atom when available, with
 * an injectable polling fallback otherwise. Read errors never throw: a failed
 * token read returns null, and a failed user-id read returns the user id the
 * server last confirmed (null before the first confirmation), so a request that
 * fails while offline is never reported as a sign-out.
 */
export const betterAuthAdapter = (
  authClient: BetterAuthClientLike,
  options: BetterAuthAdapterOptions = {}
): AuthProvider => {
  const pollIntervalMs = options.pollIntervalMs ?? DEFAULT_AUTH_POLL_INTERVAL_MS;
  const setIntervalFn =
    options.setIntervalFn ??
    ((handler: () => void, ms: number): unknown => setInterval(handler, ms));
  const clearIntervalFn =
    options.clearIntervalFn ??
    ((handle: unknown): void => clearInterval(handle as ReturnType<typeof setInterval>));

  /**
   * The user id the server last confirmed: set by successful session reads and by
   * session-atom emissions, cleared when either reports signed out. `undefined` until the
   * first confirmation. {@link getUserId} answers with it when a read fails.
   */
  let confirmedUserId: string | null | undefined;
  /**
   * Ordering for {@link confirmedUserId}. Every session read takes a ticket when it starts,
   * and every emission that changes or clears the identity takes one when it arrives. The
   * cache keeps the answer with the highest ticket, so a read that started before a sign-out
   * or user switch and resolves after it cannot restore the previous user.
   */
  let lastTicket = 0;
  let confirmedTicket = 0;

  const takeTicket = (): number => {
    lastTicket += 1;
    return lastTicket;
  };

  const confirmUserId = (userId: string | null, ticket: number): void => {
    if (ticket < confirmedTicket) {
      return;
    }
    confirmedTicket = ticket;
    confirmedUserId = userId;
  };

  /**
   * Record an emission's identity. An emission that only re-confirms the cached user takes no
   * ticket, so it does not discard an in-flight read that may carry a newer sign-out. A
   * signed-out emission always takes one, so it discards every read that started before it.
   *
   * A replay (the atom's current value, delivered synchronously to a new subscriber) is not a
   * new server answer: it may be older than a read that already confirmed a sign-out. It
   * counts as the oldest answer, so it only fills the cache before anything is confirmed.
   */
  const confirmUserIdFromEmission = (userId: string | null, isReplay: boolean): void => {
    if (isReplay) {
      confirmUserId(userId, 0);
      return;
    }
    if (userId !== null && userId === confirmedUserId) {
      return;
    }
    confirmUserId(userId, takeTicket());
  };

  /**
   * Read the session, distinguishing "read failed" from "signed out". Both surface as
   * a null session, but only the latter is an identity change — see
   * {@link classifyEmission}. Better Auth reports a failed fetch either by rejecting or
   * as a `{data: null, error}` envelope; a 401 error means signed out.
   */
  const readSessionResult = async (): Promise<{
    ok: boolean;
    session: BetterAuthSessionDataLike | null;
  }> => {
    const ticket = takeTicket();
    let result: BetterAuthGetSessionResult;
    try {
      result = await authClient.getSession();
    } catch {
      return {ok: false, session: null};
    }
    if (isFailedReadEnvelope(result)) {
      return {ok: false, session: null};
    }
    const session = unwrapSession(result);
    confirmUserId(session?.user?.id ?? null, ticket);
    return {ok: true, session};
  };

  const readSession = async (): Promise<BetterAuthSessionDataLike | null> => {
    return (await readSessionResult()).session;
  };

  /**
   * One-shot silent refresh consumed by the client's A4 auth-pause pipeline:
   * re-fetch the session (Better Auth clients transparently refresh/renew the
   * underlying token on `getSession()` when the client library supports it)
   * and report whether a usable token now exists. Never throws — a failed
   * refresh just means the pause surfaces to the app as usual.
   */
  const refresh = async (): Promise<boolean> => {
    const session = await readSession();
    return Boolean(session?.session?.token);
  };

  /**
   * Read the caller's bearer token, treating a throw (for example blocked storage) like a
   * missing token so the session read still gets a chance.
   */
  const readBearerToken = (): string | null => {
    if (!options.getBearerToken) {
      return null;
    }
    try {
      return options.getBearerToken() || null;
    } catch {
      return null;
    }
  };

  const getToken = async (): Promise<string | null> => {
    const bearerToken = readBearerToken();
    if (bearerToken) {
      return bearerToken;
    }
    const session = await readSession();
    return session?.session?.token ?? null;
  };

  /**
   * A failed read answers with the last confirmed user id instead of null: callers such as
   * the syncdb client treat null as a sign-out, and a request that fails while the device is
   * offline proves nothing about the session (INV-2). Before any read has succeeded, a failed
   * read still answers null.
   */
  const getUserId = async (): Promise<string | null> => {
    const {ok, session} = await readSessionResult();
    if (!ok) {
      return confirmedUserId ?? null;
    }
    return session?.user?.id ?? null;
  };

  /**
   * Identity snapshot used by the polling fallback to detect auth changes. Returns null
   * when the read itself failed, so a transient network error is never sampled as a
   * signed-out identity (the same phantom-logout hazard {@link classifyEmission} guards).
   */
  const readAuthKey = async (): Promise<string | null> => {
    const {ok, session} = await readSessionResult();
    if (!ok) {
      return null;
    }
    return `${session?.user?.id ?? ""}|${session?.session?.token ?? ""}`;
  };

  /**
   * Classify a session-atom emission for the subscribe path:
   * - "pending": an in-flight fetch state (`isPending: true`), a refetch start
   *   (`isRefetching: true`, which re-emits the previous data rather than a server answer),
   *   or a FAILED read (`error` set, other than a 401) — never a change;
   * - `{key}`: a parseable session envelope reduced to its identity (userId|token). A 401
   *   error is the server saying "signed out", so it reduces to the signed-out identity,
   *   matching how a 401 from `getSession()` is read;
   * - null: an opaque value the adapter cannot interpret.
   *
   * A failed read is deliberately indistinguishable from "pending" here. Better Auth
   * emits `{data: null, error}` when a get-session fetch fails, which is shaped exactly
   * like a signed-out session — forwarding it would report a PHANTOM logout, and the
   * client's logout path clears its current-user pointer, breaking local-first writes
   * (`mutate()` throws) until the next real auth event. A transient network failure is a
   * recoverable state, not a sign-out (INV-2), so the identity is left unchanged and the
   * next successful emission decides.
   */
  const classifyEmission = (
    value: unknown
  ): {key: string; userId: string | null} | "pending" | null => {
    if (!value || typeof value !== "object") {
      return null;
    }
    const emission = value as {
      isPending?: unknown;
      isRefetching?: unknown;
      data?: unknown;
      user?: unknown;
      error?: unknown;
    };
    if (emission.isPending === true || emission.isRefetching === true) {
      return "pending";
    }
    if (isUnauthorizedError(emission.error)) {
      return {key: "|", userId: null};
    }
    if (emission.error) {
      return "pending";
    }
    let payload: BetterAuthSessionDataLike | null = null;
    if ("data" in emission) {
      payload =
        emission.data && typeof emission.data === "object"
          ? (emission.data as BetterAuthSessionDataLike)
          : null;
    } else if ("user" in emission || "session" in emission) {
      payload = emission as BetterAuthSessionDataLike;
    } else {
      return null;
    }
    return {
      key: `${payload?.user?.id ?? ""}|${payload?.session?.token ?? ""}`,
      userId: payload?.user?.id ?? null,
    };
  };

  const onAuthChange = (callback: () => void): (() => void) => {
    const subscribe = authClient.useSession?.subscribe;
    if (typeof subscribe === "function") {
      // Dedupe by session identity: Better Auth's session atom re-emits on EVERY
      // get-session fetch (each settles with a fresh object), including fetches this
      // adapter's own getToken/getUserId trigger. Forwarding every emission creates a
      // feedback loop (auth change → getUserId → getSession → atom emission → auth
      // change → ...), so only a genuine identity change (login/logout/user switch/
      // token rotation) may fire the callback. In-flight (`isPending`) states are
      // skipped; opaque values the adapter cannot parse are forwarded as before.
      let lastKey: string | undefined;
      let isSubscribing = true;
      const unsubscribe = subscribe((value) => {
        const parsed = classifyEmission(value);
        if (parsed === "pending") {
          return;
        }
        if (parsed === null) {
          callback();
          return;
        }
        // An emission repeating the atom's own last value is not a new server answer (a
        // fetch that started before a newer read can settle late), so it must not
        // overwrite what that read confirmed.
        if (parsed.key === lastKey) {
          return;
        }
        confirmUserIdFromEmission(parsed.userId, isSubscribing);
        lastKey = parsed.key;
        callback();
      });
      isSubscribing = false;
      return typeof unsubscribe === "function" ? unsubscribe : (): void => {};
    }

    // Polling fallback: sample the session identity and fire on change. The
    // first sample only establishes the baseline so subscribing never emits a
    // spurious change for the already-current session.
    let disposed = false;
    let lastKey: string | undefined;
    void readAuthKey().then((key) => {
      if (!disposed && lastKey === undefined && key !== null) {
        lastKey = key;
      }
    });
    const handle = setIntervalFn(() => {
      void readAuthKey().then((key) => {
        if (disposed || key === null) {
          // Failed read: hold the last known identity rather than sampling it as
          // signed out.
          return;
        }
        if (lastKey === undefined) {
          lastKey = key;
          return;
        }
        if (key !== lastKey) {
          lastKey = key;
          callback();
        }
      });
    }, pollIntervalMs);
    return () => {
      disposed = true;
      clearIntervalFn(handle);
    };
  };

  return {getToken, getUserId, onAuthChange, refresh};
};
