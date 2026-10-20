import type {AuthProvider} from "../types";
import type {BetterAuthClientLike, BetterAuthSessionDataLike} from "./types";

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

/**
 * Adapt a Better Auth client to syncdb's {@link AuthProvider} contract.
 * Tokens/user ids are read per call via `getSession()` (unless
 * `options.getBearerToken` supplies the token; never cached, so
 * Better Auth session refresh is picked up transparently); auth changes are
 * delivered through the client's nanostore session atom when available, with
 * an injectable polling fallback otherwise. All read errors degrade to null —
 * a broken auth client behaves like "signed out", never a crash.
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
   * Read the session, distinguishing "read failed" from "signed out". Both surface as
   * a null session, but only the latter is an identity change — see
   * {@link classifyEmission}.
   */
  const readSessionResult = async (): Promise<{
    ok: boolean;
    session: BetterAuthSessionDataLike | null;
  }> => {
    try {
      return {ok: true, session: unwrapSession(await authClient.getSession())};
    } catch {
      return {ok: false, session: null};
    }
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

  const getUserId = async (): Promise<string | null> => {
    const session = await readSession();
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
   * - "pending": an in-flight fetch state (`isPending: true`) or a FAILED read
   *   (`error` set) — never a change;
   * - `{key}`: a parseable session envelope reduced to its identity (userId|token);
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
  const classifyEmission = (value: unknown): {key: string} | "pending" | null => {
    if (!value || typeof value !== "object") {
      return null;
    }
    const emission = value as {
      isPending?: unknown;
      data?: unknown;
      user?: unknown;
      error?: unknown;
    };
    if (emission.isPending === true) {
      return "pending";
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
    return {key: `${payload?.user?.id ?? ""}|${payload?.session?.token ?? ""}`};
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
      const unsubscribe = subscribe((value) => {
        const parsed = classifyEmission(value);
        if (parsed === "pending") {
          return;
        }
        if (parsed === null) {
          callback();
          return;
        }
        if (parsed.key === lastKey) {
          return;
        }
        lastKey = parsed.key;
        callback();
      });
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
