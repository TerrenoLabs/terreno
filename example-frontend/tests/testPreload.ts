import {mock} from "bun:test";

// Screens import @terreno/rtk, whose barrel loads Better Auth's Expo client.
// Those modules touch native Expo packages at import time. Register the mocks
// once here so every example-frontend test file sees the same modules.
mock.module("expo-secure-store", () => ({
  deleteItemAsync: async (): Promise<void> => {},
  getItem: (): null => null,
  getItemAsync: async (): Promise<null> => null,
  setItem: (): void => {},
  setItemAsync: async (): Promise<void> => {},
}));

mock.module("expo-constants", () => ({
  default: {
    expoConfig: {extra: {}, scheme: "frontend"},
  },
}));

mock.module("expo-linking", () => ({
  addEventListener: (): {remove: () => void} => ({
    remove: (): void => {},
  }),
  createURL: (): string => "frontend://",
  parse: (): Record<string, never> => ({}),
}));
