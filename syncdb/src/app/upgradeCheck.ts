import Constants from "expo-constants";
import {useCallback, useEffect, useRef, useState} from "react";
// Namespace import + lazy property access so per-test `mock.module` swaps reach the
// runtime values (react-native's CJS getter exports fail bun's static-export check).
import * as ReactNative from "react-native";

import type {ApiClient} from "../api/client";
import {useApiClient} from "../react/apiHooks";

/** Response from Terreno `GET /version-check` (`VersionCheckPlugin`). */
export interface VersionCheckResponse {
  message?: string;
  /** How often the client should poll for updates, in milliseconds. */
  pollingIntervalMs?: number;
  requiredVersion?: number;
  status: "ok" | "warning" | "required";
  updateUrl?: string;
  warningVersion?: number;
}

export interface UseUpgradeCheckOptions {
  /**
   * Local fallback for how often to re-check (ms), used until the first server
   * response supplies `pollingIntervalMs`. Default: no polling.
   */
  pollingIntervalMs?: number;
  /** Re-check when the app or browser tab returns to the foreground. Default `false`. */
  recheckOnForeground?: boolean;
  /** Request client; defaults to the nearest `ApiClientProvider`. */
  client?: ApiClient;
}

export interface UseUpgradeCheckResult {
  canUpdate: boolean;
  isRequired: boolean;
  isWarning: boolean;
  requiredMessage?: string;
  warningMessage?: string;
  /** Increments each time a poll returns "warning" status. Useful as a React key to force remount. */
  warningCheckCount: number;
  onUpdate: () => void;
}

const isWebPlatform = (): boolean => ReactNative.Platform.OS === "web";

/**
 * Checks the running app build number (`Constants.expoConfig.extra.buildNumber`)
 * against the backend's VersionConfig thresholds and returns the upgrade status.
 *
 * - `isRequired` — the build is below the required threshold; block the UI
 *   (e.g. with `UpgradeRequiredScreen`).
 * - `isWarning` — the build is below the warning threshold; show a dismissible prompt.
 *
 * The polling interval is server-driven: the first successful `/version-check`
 * response's `pollingIntervalMs` replaces the local `pollingIntervalMs` fallback.
 * With no build number (dev), the check is skipped.
 */
export const useUpgradeCheck = (options: UseUpgradeCheckOptions = {}): UseUpgradeCheckResult => {
  const {
    pollingIntervalMs: fallbackPollingIntervalMs,
    recheckOnForeground = false,
    client: clientOverride,
  } = options;
  const client = useApiClient(clientOverride);

  const [isRequired, setIsRequired] = useState(false);
  const [isWarning, setIsWarning] = useState(false);
  const [requiredMessage, setRequiredMessage] = useState<string>();
  const [warningMessage, setWarningMessage] = useState<string>();
  const [updateUrl, setUpdateUrl] = useState<string>();
  const [warningCheckCount, setWarningCheckCount] = useState(0);
  // Starts with the local fallback; updated to the server-configured value after the first response.
  const [activePollingIntervalMs, setActivePollingIntervalMs] = useState<number | undefined>(
    fallbackPollingIntervalMs
  );
  const buildNumber = Constants.expoConfig?.extra?.buildNumber as number | undefined;
  const appState = useRef(ReactNative.AppState.currentState);

  // Uncached request so every poll is processed, even when the response is unchanged.
  const runCheck = useCallback((): void => {
    if (buildNumber === undefined || buildNumber === null) {
      return;
    }
    const platform = isWebPlatform() ? "web" : "mobile";
    client
      .request<VersionCheckResponse>({
        params: {platform, version: buildNumber},
        url: "/version-check",
      })
      .then((data) => {
        const {
          message,
          pollingIntervalMs: serverPollingIntervalMs,
          status,
          updateUrl: responseUpdateUrl,
        } = data;

        if (status === "required") {
          setIsRequired(true);
          setRequiredMessage(message);
          setIsWarning(false);
        } else if (status === "warning") {
          setIsRequired(false);
          setIsWarning(true);
          setWarningMessage(message);
          setWarningCheckCount((count) => count + 1);
        } else {
          setIsWarning(false);
          setIsRequired(false);
        }

        if (responseUpdateUrl) {
          setUpdateUrl(responseUpdateUrl);
        }

        if (serverPollingIntervalMs !== undefined) {
          setActivePollingIntervalMs(serverPollingIntervalMs);
        }
      })
      .catch((error: unknown) => {
        console.debug("Version check failed, continuing normally", error);
      });
  }, [buildNumber, client]);

  const onUpdate = useCallback((): void => {
    if (isWebPlatform()) {
      window.location.reload();
      return;
    }
    if (!updateUrl) {
      console.warn("useUpgradeCheck: no update URL available for mobile update");
      return;
    }
    ReactNative.Linking.openURL(updateUrl).catch((error: unknown) => {
      console.warn("Failed to open update URL", error);
    });
  }, [updateUrl]);

  // Check once on mount (and again if the client or build number changes).
  useEffect(() => {
    runCheck();
  }, [runCheck]);

  // Poll on the server-driven interval (the local fallback applies until the first response).
  useEffect(() => {
    if (!activePollingIntervalMs) {
      return;
    }
    const interval = setInterval(runCheck, activePollingIntervalMs);
    return (): void => clearInterval(interval);
  }, [runCheck, activePollingIntervalMs]);

  // Re-check when the app or tab returns to the foreground.
  useEffect(() => {
    if (!recheckOnForeground) {
      return;
    }
    const subscription = ReactNative.AppState.addEventListener("change", (nextAppState) => {
      const wasBackground = /inactive|background/.test(appState.current ?? "");
      if (wasBackground && nextAppState === "active") {
        runCheck();
      }
      appState.current = nextAppState;
    });
    return (): void => subscription.remove();
  }, [runCheck, recheckOnForeground]);

  return {
    canUpdate: isWebPlatform() || Boolean(updateUrl),
    isRequired,
    isWarning,
    onUpdate,
    requiredMessage,
    warningCheckCount,
    warningMessage,
  };
};
