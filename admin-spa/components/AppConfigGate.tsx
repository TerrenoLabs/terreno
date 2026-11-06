import {Box, Button, Spinner, Text} from "@terreno/ui";
import React, {createContext, useCallback, useContext, useEffect, useState} from "react";

/**
 * Runtime config shape served by `AdminSpaServeApp` at `${basePath}/app-config.json`.
 * Mirrors `src/appConfig.ts` (the server type) — kept separate so the web bundle does
 * not import backend code.
 */
export interface AdminSpaAppConfig {
  brandName: string;
  logoUrl?: string;
  primaryColor: string;
  providers: ReadonlyArray<"email" | "google" | "github" | "apple">;
  authBasePath?: string;
  adminApiBasePath?: string;
}

const DEFAULT_APP_CONFIG: AdminSpaAppConfig = {
  adminApiBasePath: "/admin",
  authBasePath: "/api/auth",
  brandName: "Terreno Admin",
  primaryColor: "#2563EB",
  providers: ["email"],
};

interface AppConfigContextValue {
  appConfig: AdminSpaAppConfig;
  /** Path the SPA is mounted at (e.g. "/console"), injected by the serve plugin. */
  basePath: string;
}

const AppConfigContext = createContext<AppConfigContextValue | undefined>(undefined);

/** Access the loaded app-config. Throws if used outside {@link AppConfigGate}. */
export const useAppConfig = (): AppConfigContextValue => {
  const value = useContext(AppConfigContext);
  if (!value) {
    throw new Error("useAppConfig must be used within <AppConfigGate>");
  }
  return value;
};

/**
 * Resolve the SPA mount base path. The serve plugin injects
 * `window.__ADMIN_SPA_BASE__`; fall back to empty (root mount / native).
 */
const resolveBasePath = (): string => {
  if (typeof window === "undefined") {
    return "";
  }
  const injected = (window as {__ADMIN_SPA_BASE__?: string}).__ADMIN_SPA_BASE__;
  return injected ?? "";
};

/** Process global the serve plugin publishes for the server render (`src/serverContext.ts`). */
const SERVER_CONTEXT_KEY = Symbol.for("terreno.adminSpa.server");

interface InjectedAppConfig {
  appConfig: AdminSpaAppConfig;
  basePath: string;
}

/**
 * The config available without a fetch: on the server, the serve plugin's process global;
 * in the browser, `window.__ADMIN_SPA_CONFIG__`, which `+html.tsx` writes into the
 * server-rendered page. Undefined in dev-proxy mode, where the gate fetches instead.
 */
const readInjectedAppConfig = (): InjectedAppConfig | undefined => {
  if (typeof window === "undefined") {
    const published = (globalThis as unknown as Record<symbol, unknown>)[SERVER_CONTEXT_KEY] as
      | {appConfig?: Partial<AdminSpaAppConfig>; basePath?: string}
      | undefined;
    if (!published?.appConfig) {
      return undefined;
    }
    return {
      appConfig: {...DEFAULT_APP_CONFIG, ...published.appConfig},
      basePath: published.basePath ?? "",
    };
  }
  const injected = (window as {__ADMIN_SPA_CONFIG__?: Partial<AdminSpaAppConfig>})
    .__ADMIN_SPA_CONFIG__;
  if (!injected) {
    return undefined;
  }
  return {appConfig: {...DEFAULT_APP_CONFIG, ...injected}, basePath: resolveBasePath()};
};

/**
 * Top-level gate (above `StoreProvider`) that fetches `${basePath}/app-config.json`
 * once on boot and exposes it via context. Blocks render until loaded so the auth client
 * can be built from the config.
 */
export const AppConfigGate: React.FC<{children: React.ReactNode}> = ({children}) => {
  const [injected] = useState<InjectedAppConfig | undefined>(readInjectedAppConfig);
  const [appConfig, setAppConfig] = useState<AdminSpaAppConfig | undefined>(injected?.appConfig);
  const [error, setError] = useState<string | undefined>(undefined);
  const [reloadKey, setReloadKey] = useState(0);
  const basePath = injected?.basePath ?? resolveBasePath();

  // Fetch the runtime app-config on boot (and on retry). Absolute URL derived from the
  // injected base so deep refreshes (e.g. /console/users/abc) still resolve correctly.
  useEffect(() => {
    // A server-rendered page already carries its config; only a retry refetches it.
    if (injected && reloadKey === 0) {
      return;
    }
    let cancelled = false;
    const load = async (): Promise<void> => {
      try {
        const res = await fetch(`${basePath}/app-config.json`, {
          headers: {Accept: "application/json"},
        });
        if (!res.ok) {
          throw new Error(`app-config.json returned ${res.status}`);
        }
        const data = (await res.json()) as Partial<AdminSpaAppConfig>;
        if (!cancelled) {
          setAppConfig({...DEFAULT_APP_CONFIG, ...data});
        }
      } catch (err) {
        console.error("AppConfigGate: failed to load app-config.json", err);
        if (!cancelled) {
          setError("Failed to load admin configuration.");
        }
      }
    };
    void load();
    return (): void => {
      cancelled = true;
    };
  }, [basePath, injected, reloadKey]);

  const handleRetry = useCallback((): void => {
    setError(undefined);
    setReloadKey((k) => k + 1);
  }, []);

  if (error) {
    return (
      <Box
        alignItems="center"
        gap={4}
        justifyContent="center"
        padding={6}
        testID="admin-spa-app-config-error"
      >
        <Text color="error">{error}</Text>
        <Button onClick={handleRetry} text="Retry" variant="primary" />
      </Box>
    );
  }

  if (!appConfig) {
    return (
      <Box
        alignItems="center"
        justifyContent="center"
        padding={6}
        testID="admin-spa-app-config-loading"
      >
        <Spinner />
      </Box>
    );
  }

  return (
    <AppConfigContext.Provider value={{appConfig, basePath}}>{children}</AppConfigContext.Provider>
  );
};
