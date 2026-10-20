/**
 * `@terreno/syncdb/config` — the running app's API base URLs and standard request
 * headers, resolved once from Expo config and env:
 *
 * 1. `extra.BASE_URL` (production/staging; `__SAME_ORIGIN__` → page origin)
 * 2. `EXPO_PUBLIC_API_URL` (dev web)
 * 3. Expo `hostUri` + dev API port (simulator/device)
 * 4. `http://localhost:<dev API port>`
 *
 * Requires `expo-constants` (optional peer dependency).
 */
import Constants from "expo-constants";

import {type ExpoConstantsShape, resolveBaseUrls, resolveDevApiPort} from "./resolveBaseUrls";

export {
  type BaseUrls,
  DEFAULT_DEV_API_PORT,
  type ExpoConstantsShape,
  resolveBaseUrls,
  resolveDevApiPort,
  SAME_ORIGIN_SENTINEL,
} from "./resolveBaseUrls";

const expoConstants = Constants as unknown as ExpoConstantsShape & {
  expoConfig?: {version?: string};
};

if (expoConstants.expoGoConfig?.debuggerHost?.includes("exp.direct")) {
  console.error(
    "Expo Tunnel is not currently supported for connecting to the API, please use LAN or Local mode."
  );
}

const windowOrigin = (globalThis as {location?: {origin?: string}}).location?.origin || undefined;

const resolved = resolveBaseUrls({
  devApiPort: resolveDevApiPort({
    envDevApiPort: process.env.EXPO_PUBLIC_DEV_API_PORT,
    expoConstants,
  }),
  envApiUrl: process.env.EXPO_PUBLIC_API_URL,
  expoConstants,
  isDev: (globalThis as {__DEV__?: boolean}).__DEV__ === true,
  windowOrigin,
});

export const baseUrl: string = resolved.baseUrl;
export const baseWebsocketsUrl: string = resolved.baseWebsocketsUrl;
export const baseTasksUrl: string = resolved.baseTasksUrl;

/** True in a browser (react-native-web), false on iOS/Android. */
export const isWeb: boolean = typeof document !== "undefined";

/**
 * `App-Version` (Expo config version) and `App-Platform` (`web` | `mobile`), the
 * headers `@terreno/api`'s version check and request logs read. Pass as the
 * `headers` option of `createApiClient`.
 */
export const appHeaders = (): Record<string, string> => {
  const headers: Record<string, string> = {"App-Platform": isWeb ? "web" : "mobile"};
  const version = expoConstants.expoConfig?.version;
  if (version) {
    headers["App-Version"] = version;
  }
  return headers;
};
