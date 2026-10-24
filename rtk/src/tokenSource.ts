// Leaf module: holds the app's registered token source. It imports nothing from rtk so every rtk
// consumer (base query, sockets, chat, MCP tools, offline replay) can read it without a cycle.
import type {AuthProvider} from "@terreno/syncdb";

let registeredTokenSource: AuthProvider | undefined;

/**
 * Registers the token source every `@terreno/rtk` consumer reads by default. Pass the same
 * `AuthProvider` the app builds for syncdb (for example
 * `betterAuthAdapter(betterAuthClient)`), once at startup. Until an app registers one, rtk uses
 * the legacy JWT tokens in storage. Pass `undefined` to go back to that default.
 */
export const setTokenSource = (source: AuthProvider | undefined): void => {
  registeredTokenSource = source;
};

/** Returns the registered token source, or `undefined` when the app has not registered one. */
export const getTokenSource = (): AuthProvider | undefined => {
  return registeredTokenSource;
};
