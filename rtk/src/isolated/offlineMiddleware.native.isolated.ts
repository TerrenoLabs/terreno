import {describe, expect, it, mock} from "bun:test";
import type {AuthProvider} from "@terreno/syncdb";

mock.module("react-native", () => ({
  Platform: {OS: "ios"},
  StyleSheet: {create: (styles: unknown) => styles},
}));
mock.module("../platform", () => ({IsWeb: false}));
mock.module("../authSlice", () => ({
  getAuthToken: async () => null,
  selectCurrentUserId: (state: {auth?: {userId?: string}}) => state.auth?.userId,
}));
mock.module("../constants", () => ({
  baseUrl: "http://localhost:4000",
  LOGOUT_ACTION_TYPE: "auth/logout",
}));
// Stand-in for the built-in JWT token source; this file only exercises native network monitoring.
const fakeJwtTokenSource: AuthProvider = {
  getToken: async (): Promise<string | null> => null,
  getUserId: async (): Promise<string | null> => null,
  onAuthChange: (): (() => void) => (): void => {},
};
mock.module("../emptyApi", () => ({
  isJwtTokenSource: (source: AuthProvider | undefined): boolean =>
    !source || source === fakeJwtTokenSource,
  jwtTokenSource: fakeJwtTokenSource,
}));

let networkListener: ((state: {isConnected?: boolean}) => void) | undefined;
const removeNetworkListener = mock(() => {});
mock.module("expo-network", () => ({
  addNetworkStateListener: (listener: (state: {isConnected?: boolean}) => void) => {
    networkListener = listener;
    return {remove: removeNetworkListener};
  },
  getNetworkStateAsync: async () => ({isConnected: false}),
}));

const {configureStore} = await import("@reduxjs/toolkit");
const {createApi, fetchBaseQuery} = await import("@reduxjs/toolkit/query");
const {createOfflineMiddleware} = await import("../offlineMiddleware");
const {selectIsOnline} = await import("../offlineSlice");

const api = createApi({
  baseQuery: fetchBaseQuery({baseUrl: "http://localhost:4000"}),
  endpoints: (builder) => ({
    patchTodosById: builder.mutation({
      query: (args: {id: string; body: Record<string, unknown>}) => ({
        body: args.body,
        method: "PATCH",
        url: `/todos/${args.id}`,
      }),
    }),
  }),
  reducerPath: "terreno-rtk-native",
});

const createNativeStore = () => {
  const offline = createOfflineMiddleware({
    api: api as unknown as Parameters<typeof createOfflineMiddleware>[0]["api"],
    endpoints: ["patchTodosById"],
  });

  return configureStore({
    middleware: (getDefault) =>
      getDefault({serializableCheck: false}).concat(api.middleware, offline.middleware),
    reducer: {
      [api.reducerPath]: api.reducer,
      offline: offline.offlineReducer,
    },
  });
};

const waitForEffects = async (): Promise<void> => {
  await new Promise((resolve) => setTimeout(resolve, 0));
};

describe("createOfflineMiddleware native network monitoring", () => {
  it("uses expo-network initial state and subscription updates", async () => {
    const store = createNativeStore();

    store.dispatch({type: "init-native-network-monitoring"});
    await waitForEffects();

    expect(selectIsOnline(store.getState())).toBe(false);
    networkListener?.({isConnected: true});
    expect(selectIsOnline(store.getState())).toBe(true);
    networkListener?.({isConnected: false});
    expect(selectIsOnline(store.getState())).toBe(false);
  });
});
