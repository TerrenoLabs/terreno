// Patterns that should NOT fail e2e tests when emitted as console.warn,
// console.error, or page errors. Use sparingly — prefer fixing the underlying
// issue. Entries are matched as substrings against the message text. Regex
// entries are matched with .test().

export const GLOBAL_CONSOLE_ALLOWLIST: ReadonlyArray<string | RegExp> = [
  // React Native Web deprecation: pointerEvents prop. @terreno/ui no longer
  // passes it, but unmaintained third-party components still do
  // (@react-native-community/slider, react-native-actions-sheet,
  // react-native-modalize, react-native-calendars).
  "props.pointerEvents is deprecated. Use style.pointerEvents",

  // @terreno/syncdb is started globally by the root layout on every authenticated
  // login (see app/_layout.tsx), not just in syncdb-focused specs. Its startup
  // reconcile and the realtime socket's token warmup race the app's own auth-state
  // propagation immediately after login/signup and can transiently
  // warn/error before settling — expected noise on any authenticated screen, not
  // just the syncdb suite (which additionally uses allowSyncDbNoise() for its
  // offline-simulation-specific messages).
  /\[syncdb\] (startup|reconnect) reconcile failed/,

  // React Native Web dev builds only: Animated has no native module on web and falls back to JS.
  // The cross-site specs run against `expo start` (a dev bundle); CI's static export never logs it.
  "`useNativeDriver` is not supported because the native animated module is missing",
];
