/**
 * Token storage and expiry helpers for legacy `@terreno/api` JWT auth (`/auth/login`,
 * `/auth/refresh_token`). Ported from the pre-58 rtk package's `authSlice` / `emptyApi`:
 * tokens live in `expo-secure-store` on native and AsyncStorage on web, under the same
 * `AUTH_TOKEN` / `REFRESH_TOKEN` keys, so a signed-in rtk app stays signed in after the move.
 */
import AsyncStorage from "@react-native-async-storage/async-storage";
import * as SecureStore from "expo-secure-store";
import {jwtDecode} from "jwt-decode";
import {DateTime} from "luxon";

/** Storage key for the short-lived access token. */
export const AUTH_TOKEN_KEY = "AUTH_TOKEN";
/** Storage key for the long-lived refresh token. */
export const REFRESH_TOKEN_KEY = "REFRESH_TOKEN";

/**
 * Seconds before refresh-token expiry at which the "are you still there?" modal shows. One
 * minute plus five seconds so a user who sees it with a minute left has time to respond.
 */
export const STILL_THERE_THRESHOLD_SECS = 65;

/** Async key/value storage for JWTs. */
export interface JwtTokenStorage {
  getItem: (key: string) => Promise<string | null>;
  setItem: (key: string, value: string) => Promise<void>;
  removeItem: (key: string) => Promise<void>;
}

/** The stored token pair; either may be missing. */
export interface JwtTokens {
  token: string | null;
  refreshToken: string | null;
}

/** Seconds until each token expires (negative once expired); undefined without both tokens. */
export interface TokenExpirationTimes {
  authRemainingSecs?: number;
  refreshRemainingSecs?: number;
}

/** Claims `@terreno/api`'s `generateTokens` puts in every access and refresh token. */
export interface JwtClaims {
  exp?: number;
  id?: string;
  sid?: string;
  te?: number;
}

/**
 * True in a browser (react-native-web), false on iOS/Android. Evaluated per call so syncdb
 * never imports react-native and tests can flip it with a `document` stub.
 */
const detectIsWeb = (): boolean => typeof document !== "undefined";

const hasWindow = (): boolean => typeof window !== "undefined";

/**
 * Token storage that works on web and native: `expo-secure-store` on iOS/Android, and
 * AsyncStorage on web (no secure storage in the browser, so XSS can read it — the same
 * trade-off rtk made). Server-side rendering (no `window`) reads nothing and writes nothing.
 */
export const createJwtTokenStorage = ({
  isWeb = detectIsWeb(),
}: {
  isWeb?: boolean;
} = {}): JwtTokenStorage => {
  if (!isWeb) {
    return {
      getItem: (key: string): Promise<string | null> => SecureStore.getItemAsync(key),
      removeItem: (key: string): Promise<void> => SecureStore.deleteItemAsync(key),
      setItem: (key: string, value: string): Promise<void> => SecureStore.setItemAsync(key, value),
    };
  }
  return {
    getItem: async (key: string): Promise<string | null> => {
      if (!hasWindow()) {
        return null;
      }
      return AsyncStorage.getItem(key);
    },
    removeItem: async (key: string): Promise<void> => {
      if (!hasWindow()) {
        return;
      }
      await AsyncStorage.removeItem(key);
    },
    setItem: async (key: string, value: string): Promise<void> => {
      if (!hasWindow()) {
        console.warn("[terreno/syncdb] Cannot store auth token: window is not defined (SSR)");
        return;
      }
      await AsyncStorage.setItem(key, value);
    },
  };
};

let defaultStorage: JwtTokenStorage | undefined;

/** The platform storage shared by `jwtAuthAdapter` and the expiry helpers by default. */
export const getDefaultJwtTokenStorage = (): JwtTokenStorage => {
  defaultStorage ??= createJwtTokenStorage();
  return defaultStorage;
};

/** Read the stored token pair. */
export const readJwtTokens = async (
  storage: JwtTokenStorage = getDefaultJwtTokenStorage()
): Promise<JwtTokens> => {
  const [token, refreshToken] = await Promise.all([
    storage.getItem(AUTH_TOKEN_KEY),
    storage.getItem(REFRESH_TOKEN_KEY),
  ]);
  return {refreshToken: refreshToken || null, token: token || null};
};

/** Decode a JWT's claims without verifying it; `null` when it is not a JWT. */
export const decodeJwtClaims = (token: string | null | undefined): JwtClaims | null => {
  if (!token) {
    return null;
  }
  try {
    return jwtDecode<JwtClaims>(token);
  } catch {
    return null;
  }
};

const remainingSecs = (token: string, now: DateTime): number | undefined => {
  const exp = decodeJwtClaims(token)?.exp;
  if (typeof exp !== "number") {
    return undefined;
  }
  return Math.floor(DateTime.fromSeconds(exp).diff(now, "seconds").seconds);
};

/**
 * Seconds until a token pair expires. Both values are undefined unless both tokens are
 * present (rtk behaviour), and a token without a readable `exp` claim reports undefined.
 */
export const tokenExpirationTimesFor = ({
  now = DateTime.now(),
  tokens,
}: {
  now?: DateTime;
  tokens: JwtTokens;
}): TokenExpirationTimes => {
  if (!tokens.token || !tokens.refreshToken) {
    return {authRemainingSecs: undefined, refreshRemainingSecs: undefined};
  }
  return {
    authRemainingSecs: remainingSecs(tokens.token, now),
    refreshRemainingSecs: remainingSecs(tokens.refreshToken, now),
  };
};

/** Seconds until the stored access and refresh tokens expire. */
export const getTokenExpirationTimes = async ({
  now,
  storage,
}: {
  now?: DateTime;
  storage?: JwtTokenStorage;
} = {}): Promise<TokenExpirationTimes> => {
  return tokenExpirationTimesFor({now, tokens: await readJwtTokens(storage)});
};

/**
 * True when the refresh token expires within {@link STILL_THERE_THRESHOLD_SECS}: show an
 * "are you still there?" prompt whose confirm action makes any authenticated request (the
 * adapter refreshes the session on it). False when there is no refresh token.
 */
export const shouldShowStillThereModal = async ({
  now,
  storage,
}: {
  now?: DateTime;
  storage?: JwtTokenStorage;
} = {}): Promise<boolean> => {
  const {refreshRemainingSecs} = await getTokenExpirationTimes({now, storage});
  if (refreshRemainingSecs === undefined) {
    return false;
  }
  return refreshRemainingSecs <= STILL_THERE_THRESHOLD_SECS;
};
