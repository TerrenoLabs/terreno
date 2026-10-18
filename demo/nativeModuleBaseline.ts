import stripePackage from "@stripe/stripe-react-native/package.json";
import expoBuildPropertiesPackage from "expo-build-properties/package.json";
import expoCryptoPackage from "expo-crypto/package.json";
import expoDevicePackage from "expo-device/package.json";
import expoLocalAuthenticationPackage from "expo-local-authentication/package.json";
import expoSystemUiPackage from "expo-system-ui/package.json";
import {NativeModules, Platform, TurboModuleRegistry} from "react-native";
import purchasesPackage from "react-native-purchases/package.json";
import purchasesUiPackage from "react-native-purchases-ui/package.json";

type NativeModuleKind = "expo" | "react-native" | "config-plugin";

interface NativeModuleEntry {
  // Name the native side registers; omitted for config-plugin-only packages.
  moduleName?: string;
  kind: NativeModuleKind;
  packageName: string;
  version: string;
}

export type NativeModuleStatus = "linked" | "missing" | "web" | "buildOnly";

export interface NativeModuleRow extends NativeModuleEntry {
  status: NativeModuleStatus;
}

// The Terreno 58 native module baseline. Every package here ships native code or a config
// plugin, so a dev client built before 58 does not contain it. react-native-otp-verify is left
// out: it does not support the New Architecture, the only one React Native 0.88 runs.
const NATIVE_MODULE_BASELINE: NativeModuleEntry[] = [
  {
    kind: "react-native",
    moduleName: "StripeSdk",
    packageName: "@stripe/stripe-react-native",
    version: stripePackage.version,
  },
  {
    kind: "config-plugin",
    packageName: "expo-build-properties",
    version: expoBuildPropertiesPackage.version,
  },
  {
    kind: "expo",
    moduleName: "ExpoCrypto",
    packageName: "expo-crypto",
    version: expoCryptoPackage.version,
  },
  {
    kind: "expo",
    moduleName: "ExpoDevice",
    packageName: "expo-device",
    version: expoDevicePackage.version,
  },
  {
    kind: "expo",
    moduleName: "ExpoLocalAuthentication",
    packageName: "expo-local-authentication",
    version: expoLocalAuthenticationPackage.version,
  },
  {
    kind: "expo",
    moduleName: "ExpoSystemUI",
    packageName: "expo-system-ui",
    version: expoSystemUiPackage.version,
  },
  {
    kind: "react-native",
    moduleName: "RNPurchases",
    packageName: "react-native-purchases",
    version: purchasesPackage.version,
  },
  {
    kind: "react-native",
    moduleName: "RNPaywalls",
    packageName: "react-native-purchases-ui",
    version: purchasesUiPackage.version,
  },
];

interface ExpoGlobal {
  expo?: {modules?: Record<string, unknown>};
}

const isExpoModuleLinked = (moduleName: string): boolean => {
  // Expo installs every linked native module on globalThis.expo.modules (what
  // requireOptionalNativeModule reads). Reading it here avoids a direct expo-modules-core
  // dependency, which expo-doctor rejects in an app.
  return Boolean((globalThis as ExpoGlobal).expo?.modules?.[moduleName]);
};

const isReactNativeModuleLinked = (moduleName: string): boolean => {
  // Bridgeless builds expose legacy modules through the TurboModule interop layer.
  return Boolean(TurboModuleRegistry.get(moduleName) ?? NativeModules[moduleName]);
};

const resolveStatus = ({kind, moduleName}: NativeModuleEntry): NativeModuleStatus => {
  if (kind === "config-plugin" || !moduleName) {
    return "buildOnly";
  }
  if (Platform.OS === "web") {
    return "web";
  }
  if (kind === "expo") {
    return isExpoModuleLinked(moduleName) ? "linked" : "missing";
  }
  return isReactNativeModuleLinked(moduleName) ? "linked" : "missing";
};

/** Resolves each baseline package's installed version and whether this binary links it. */
export const resolveNativeModuleRows = (): NativeModuleRow[] =>
  NATIVE_MODULE_BASELINE.map((entry) => ({...entry, status: resolveStatus(entry)}));
