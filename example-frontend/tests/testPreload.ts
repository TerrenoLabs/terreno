import {registerExpoTestEnvironment} from "@terreno/test/expo/registerExpoTestEnvironment";

// Shared Expo / React Native test environment from @terreno/test: mocks react-native, the
// expo-* modules screens and @terreno/rtk load (SecureStore, Constants, Linking, Router, ...),
// and resets spies and stored tokens after each test.
registerExpoTestEnvironment({
  expoConfig: {extra: {}, scheme: "frontend"},
});
