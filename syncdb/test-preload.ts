/**
 * bun test preload (see bunfig.toml). Bun cannot parse react-native's Flow
 * source, and @testing-library/react-native imports it at module load — mock
 * the minimal surface it touches (mirrors rtk/test-preload.ts). The syncdb
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
