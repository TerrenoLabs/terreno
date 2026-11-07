import type {JestNativeMatchers} from "@testing-library/react-native/build/matchers/types";

// RNTL registers its jest-native matchers on the global expect at runtime; this teaches
// bun:test's typings about them so test files typecheck.
declare module "bun:test" {
  interface Matchers<T> extends JestNativeMatchers<T> {}
}
