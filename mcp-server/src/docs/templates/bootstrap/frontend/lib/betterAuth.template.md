import {createBetterAuthClient} from "@terreno/syncdb/auth";
import {baseUrl} from "@terreno/syncdb/config";
import Constants from "expo-constants";

const getAppScheme = (): string => {
  const expoExtra = Constants.expoConfig?.extra;
  return expoExtra?.scheme ?? "{{appName}}";
};

/**
 * Expo-ready Better Auth client (SecureStore on native, AsyncStorage on web). Feeds
 * `SessionProvider` (app/_layout.tsx) and the shared auth provider in store/syncdb.ts.
 */
export const betterAuthClient = createBetterAuthClient({
  baseURL: baseUrl,
  scheme: getAppScheme(),
  storagePrefix: "{{appName}}",
});
