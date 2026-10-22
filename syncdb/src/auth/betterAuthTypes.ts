/**
 * Better Auth types shared by the session store, `SessionProvider`, and app code.
 *
 * Type-only module: importing it never loads Better Auth, Expo, or React Native.
 */

/**
 * Configuration options for the Better Auth client.
 */
export interface BetterAuthClientConfig {
  /**
   * Base URL of the auth server (e.g., "http://localhost:3000").
   */
  baseURL: string;

  /**
   * App URL scheme for deep linking (e.g., "terreno").
   */
  scheme: string;

  /**
   * Storage key prefix for auth tokens.
   * @default "terreno"
   */
  storagePrefix?: string;
}

/**
 * User data from Better Auth session.
 */
export interface BetterAuthUser {
  id: string;
  email: string;
  name: string | null;
  image: string | null;
  emailVerified: boolean;
  createdAt: Date;
  updatedAt: Date;
}

/**
 * Session data from Better Auth.
 */
export interface BetterAuthSession {
  id: string;
  userId: string;
  expiresAt: Date;
  ipAddress: string | null;
  userAgent: string | null;
  createdAt: Date;
  updatedAt: Date;
}

/**
 * Combined session and user data from Better Auth.
 */
export interface BetterAuthSessionData {
  session: BetterAuthSession;
  user: BetterAuthUser;
}

/**
 * OAuth provider types supported by Better Auth.
 */
export type BetterAuthOAuthProvider = "google" | "github" | "apple";

/**
 * Minimal Better Auth client surface the session store needs: read the session, sign out,
 * and (optionally) the nanostore session atom that pushes changes. The client returned by
 * `createBetterAuthClient` satisfies it; tests can pass a plain object.
 *
 * `useSession` and `$store` are typed `unknown` because the React client exposes
 * `useSession` as a hook and the atom under `$store.atoms.session`, while nanostore-style
 * wrappers expose `useSession.subscribe` — the session source probes both at runtime.
 */
export interface BetterAuthSessionClientLike {
  getSession: () => Promise<unknown>;
  signOut: () => Promise<unknown>;
  useSession?: unknown;
  $store?: unknown;
}
