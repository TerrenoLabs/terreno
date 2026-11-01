import type {Store} from "@reduxjs/toolkit";

declare global {
  interface GlobalThis {
    __TERRENO_STORE__?: Store<object>;
  }
}

/**
 * Exposes the Redux store on `globalThis.__TERRENO_STORE__` in development so
 * `terreno-mcp-local` can run `get_client_state` against the real app state.
 */
export const registerTerrenoDevStore = <S extends object>(store: Store<S>): void => {
  if (typeof __DEV__ === "undefined" || !__DEV__) {
    return;
  }
  const g = globalThis as typeof globalThis & {__TERRENO_STORE__?: Store<object>};
  g.__TERRENO_STORE__ = store;
};
