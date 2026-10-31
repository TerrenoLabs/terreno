/**
 * Packages that must not be bumped outside a release because they change the
 * Expo native fingerprint (new EAS dev build for every developer).
 *
 * The update-dependencies skill consults this matcher. Do not copy a second list.
 */

const SKIP_EXACT = new Set([
  "@expo/config-plugins",
  "@sentry/react-native",
  "@shopify/flash-list",
  "@shopify/react-native-skia",
  "@stripe/stripe-react-native",
  "expo",
  "react-native",
]);

const SKIP_PREFIXES = [
  "@react-native-async-storage/",
  "@react-native-community/",
  "@react-native-picker/",
  "@react-native/",
  "expo-",
];

/**
 * `react-native-web` is JavaScript-only. Other `react-native-*` packages ship
 * native code or config plugins and skip until a release.
 */
const REACT_NATIVE_PREFIX = "react-native-";
const REACT_NATIVE_WEB = "react-native-web";

export const isFingerprintSkip = (packageName: string): boolean => {
  if (!packageName) {
    return false;
  }
  if (SKIP_EXACT.has(packageName)) {
    return true;
  }
  if (packageName.startsWith(REACT_NATIVE_PREFIX) && packageName !== REACT_NATIVE_WEB) {
    return true;
  }
  return SKIP_PREFIXES.some((prefix) => packageName.startsWith(prefix));
};
