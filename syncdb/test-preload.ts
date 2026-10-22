/**
 * bun test preload (see bunfig.toml). Bun cannot parse react-native's Flow
 * source, and @testing-library/react-native imports it at module load — mock
 * the minimal surface it touches. The syncdb
 * runtime itself never imports react-native.
 */
import {mock} from "bun:test";

mock.module("react-native", () => ({
  AppState: {
    addEventListener: () => ({remove: () => {}}),
    currentState: "active",
  },
  Linking: {openURL: async () => true},
  Platform: {OS: "web"},
  StyleSheet: {create: (styles: unknown) => styles},
}));

// @terreno/syncdb/config reads the app's Expo config at import time.
mock.module("expo-constants", () => ({
  default: {expoConfig: {extra: {}, version: "1.0.0"}},
}));

// @terreno/syncdb/auth: expo-secure-store and AsyncStorage ship native code. Mirrors the
// real surface — SecureStore exposes sync getItem/setItem alongside the *Async variants,
// and createStorageAdapter's native branch depends on the sync pair.
mock.module("expo-secure-store", () => ({
  deleteItemAsync: async () => {},
  getItem: () => null,
  getItemAsync: async () => null,
  setItem: () => {},
  setItemAsync: async () => {},
}));

mock.module("@react-native-async-storage/async-storage", () => ({
  default: {
    getItem: async () => null,
    removeItem: async () => {},
    setItem: async () => {},
  },
}));
