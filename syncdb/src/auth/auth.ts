/**
 * `@terreno/syncdb/auth` — Better Auth client and session state without Redux.
 *
 * - `createBetterAuthClient` builds the Expo-ready Better Auth client (SecureStore on native,
 *   AsyncStorage on web, cookie-jar repair).
 * - `SessionProvider` / `useSession()` expose `{userId, user, isLoading, isAuthenticated,
 *   error, logout, refresh}`; `createSessionStore` is the framework-agnostic core.
 * - `betterAuthAdapter` / `bridgeBetterAuthReactClient` feed the same client to `createSyncDb`
 *   and `createApiClient` as their `AuthProvider`.
 * - `useLoginController` / `TerrenoLoginScreen` / `useAccountSecurity` /
 *   `TerrenoAccountSecurityScreen` drive social login, account linking, two-factor, passkeys, and
 *   remembered accounts; `useAuthMethods` reads the server's enabled sign-in methods.
 * - `jwtAuthAdapter` / `useJwtAuth` are the legacy `@terreno/api` JWT equivalent (token
 *   storage, refresh before expiry and on 401, logout on refresh failure), and
 *   `getTokenExpirationTimes` / `shouldShowStillThereModal` read its stored tokens.
 *
 * Requires the optional peers `better-auth`, `@better-auth/expo`, `expo-secure-store`,
 * `@react-native-async-storage/async-storage`, and `react`.
 */

export {
  type BetterAuthAdapterOptions,
  betterAuthAdapter,
  DEFAULT_AUTH_POLL_INTERVAL_MS,
} from "./betterAuthAdapter";
export {
  type BetterAuthClient,
  type BetterAuthClientFor,
  type BetterAuthClientWithFeatures,
  type BetterAuthFeaturePlugins,
  type BetterAuthHandoffClient,
  completeBetterAuthOAuthHandoff,
  createBetterAuthClient,
  createStorageAdapter,
  type ExpoAuthClientPlugin,
  getBetterAuthBearerToken,
  getBetterAuthClientWebAuth,
  repairCookieJar,
  type StorageAdapter,
  signInSocialWithHandoff,
  withCookieJarRepair,
} from "./betterAuthClient";
export {type BetterAuthReactClientLike, bridgeBetterAuthReactClient} from "./betterAuthReactClient";
export type {
  BetterAuthBearerStorage,
  BetterAuthClientConfig,
  BetterAuthClientFeatures,
  BetterAuthOAuthProvider,
  BetterAuthSession,
  BetterAuthSessionClientLike,
  BetterAuthSessionData,
  BetterAuthTwoFactorFeature,
  BetterAuthTwoFactorRedirectContext,
  BetterAuthUser,
  BetterAuthWebAuth,
} from "./betterAuthTypes";
export {
  DEFAULT_JWT_AUTH_PATHS,
  DEFAULT_JWT_AUTH_TIMEOUT_MS,
  DEFAULT_REFRESH_BEFORE_EXPIRY_SECS,
  type EmailLoginRequest,
  type EmailSignupRequest,
  type GoogleLoginRequest,
  type JwtAuthAdapter,
  type JwtAuthAdapterOptions,
  type JwtAuthPaths,
  type JwtAuthResponse,
  type JwtSessionUser,
  jwtAuthAdapter,
  type ResetPasswordRequest,
} from "./jwtAuthAdapter";
export * from "./loginErrors";
export * from "./rememberedAccounts";
export {
  SessionProvider,
  type SessionProviderProps,
  type UseSessionResult,
  useSession,
  useSessionStore,
} from "./SessionProvider";
export {
  betterAuthSessionSource,
  createSessionStore,
  DEFAULT_SESSION_POLL_INTERVAL_MS,
  DEFAULT_SIGN_OUT_TIMEOUT_MS,
  SESSION_SYNC_ERROR,
  type SessionChangeListener,
  type SessionSnapshot,
  type SessionSource,
  type SessionState,
  type SessionStore,
  type SessionStoreConfig,
  type SessionSyncDb,
  SIGN_OUT_FAILED_MESSAGE,
} from "./session";
export * from "./TerrenoAccountSecurityScreen";
export * from "./TerrenoLoginScreen";
export {
  AUTH_TOKEN_KEY,
  createJwtTokenStorage,
  decodeJwtClaims,
  getDefaultJwtTokenStorage,
  getTokenExpirationTimes,
  type JwtClaims,
  type JwtTokenStorage,
  type JwtTokens,
  REFRESH_TOKEN_KEY,
  readJwtTokens,
  STILL_THERE_THRESHOLD_SECS,
  shouldShowStillThereModal,
  type TokenExpirationTimes,
  tokenExpirationTimesFor,
} from "./tokenExpiry";
export * from "./useAccountSecurity";
export * from "./useAuthMethods";
export {type UseJwtAuthResult, useJwtAuth} from "./useJwtAuth";
export * from "./useLoginController";
