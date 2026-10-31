import Constants from "expo-constants";
import type {ExpoPushToken} from "expo-notifications";
import * as Updates from "expo-updates";
import {Platform} from "react-native";

interface VersionInfo {
  environment: "production" | "staging" | "publish-on-merge" | "dev" | "unknown" | null;
  dev: boolean;
  updateChannel: string;
  version: string;
}

/** @internal */
export interface VersionInfoInputs {
  appEnv?: VersionInfo["environment"];
  configVersion?: string;
  isDev: boolean;
  manifestChannel?: string;
  updatesChannel?: string | null;
  updatesVersion?: string;
}

/** @internal */
export const buildVersionInfo = ({
  appEnv,
  configVersion,
  isDev,
  manifestChannel,
  updatesChannel,
  updatesVersion,
}: VersionInfoInputs): VersionInfo => {
  return {
    dev: Boolean(isDev),
    environment: appEnv ?? (isDev ? "dev" : "unknown"),
    updateChannel: updatesChannel ?? manifestChannel ?? "unknown",
    version: updatesVersion ?? configVersion ?? "Unknown",
  };
};

/** @internal */
export const versionInfo = (): VersionInfo => {
  return buildVersionInfo({
    appEnv: Constants.expoConfig?.extra?.APP_ENV,
    configVersion: Constants.expoConfig?.version,
    isDev: Boolean(__DEV__),
    manifestChannel: (Constants.manifest2?.metadata as {channel?: string})?.channel,
    updatesChannel: Updates.channel,
    updatesVersion: (Updates.manifest as {version?: string})?.version,
  });
};

export const getCurrentExpoToken = async (): Promise<ExpoPushToken> => {
  if (Platform.OS === "web") {
    return {data: "", type: "expo"};
  }
  // Lazy-load expo-notifications so importing this module on web does not
  // evaluate expo-notifications' DevicePushTokenAutoRegistration side effect,
  // which logs "Listening to push token changes is not yet fully supported on web".
  const Notifications = await import("expo-notifications");
  // Native push registration fails on iOS and Android 13+ unless the user has granted
  // notification permission. Request it before fetching the Expo token so denied
  // permission skips registration instead of throwing.
  const permission = await Notifications.requestPermissionsAsync();
  if (permission.status !== "granted") {
    return {data: "", type: "expo"};
  }
  let tokenRes: ExpoPushToken;
  if (__DEV__) {
    const appConfig = require("../app.json");
    const projectId = appConfig?.expo?.extra?.eas?.projectId;
    tokenRes = await Notifications.getExpoPushTokenAsync({
      projectId,
    });
  } else {
    tokenRes = await Notifications.getExpoPushTokenAsync({
      projectId: Constants.expoConfig?.extra?.eas.projectId,
    });
  }
  return tokenRes;
};
