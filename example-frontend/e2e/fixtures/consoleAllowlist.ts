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

  // react-redux memoization warning. Some selectors in the dependency tree
  // return new array/object references each call. TODO(rtk/example-frontend):
  // audit selectors and wrap with createSelector where appropriate.
  "Selector unknown returned a different result when called with the same parameters",

  // Feature-flags RTK query (terrenoFlagConfiguration) rejects until auth tokens
  // exist — expected on signup/login flows (e.g. duplicate-email signup) before a
  // token is available. Broad substring covers the "No token found" message too.
  "terrenoFlagConfiguration rejected query",

  // @terreno/syncdb is started globally by the root layout on every authenticated
  // login (see app/_layout.tsx), not just in syncdb-focused specs. Its startup
  // reconcile and the realtime socket's token warmup race the app's own auth-state
  // propagation immediately after login/signup and can transiently
  // warn/error before settling — expected noise on any authenticated screen, not
  // just the syncdb suite (which additionally uses allowSyncDbNoise() for its
  // offline-simulation-specific messages).
  /\[syncdb\] (startup|reconnect) reconcile failed/,
  "[SocketConnection] Attempting to connect socket, but getAuthToken returned no token.",
];
