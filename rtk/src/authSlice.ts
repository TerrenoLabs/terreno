// Note: we will open source this when we get a chance, so there should be no imports from private
// files.
import AsyncStorage from "@react-native-async-storage/async-storage";
import {createListenerMiddleware, createSlice, type PayloadAction} from "@reduxjs/toolkit";
import type {Api, BaseQueryFn, EndpointBuilder} from "@reduxjs/toolkit/query/react";
import * as SecureStore from "expo-secure-store";
import {DateTime} from "luxon";
import {useSelector} from "react-redux";

import {emitAuthChange} from "./authEvents";
import {LOGOUT_ACTION_TYPE, type RootState} from "./constants";
import {IsWeb} from "./platform";

interface AuthState {
  userId: string | null;
  error: string | null;
  isAuthenticating: boolean;
  lastTokenRefreshTimestamp: number | null;
}

interface AuthErrorData {
  message?: string;
}

interface MutationFulfilledAction {
  meta?: {
    arg?: {
      endpointName?: string;
    };
  };
  payload?: {
    refreshToken?: string;
    token?: string;
    userId?: string;
  };
  type: string;
}

export interface UserResponse {
  data: {
    userId: string;
    token: string;
    refreshToken: string;
  };
}

export type EmailLoginRequest =
  | {email: string; username?: never; password: string}
  | {username: string; email?: never; password: string};

export interface EmailSignupRequest {
  email: string;
  password: string;
  // Extra data
  [key: string]: unknown;
}

export interface ResetPasswordRequest {
  email: string;
  password: string;
  // Extra data
  [key: string]: unknown;
}

export interface GoogleLoginRequest {
  idToken: string;
}

export const generateProfileEndpoints = (
  builder: EndpointBuilder<BaseQueryFn<unknown, unknown, unknown>, string, string>,
  path: string
) => {
  return {
    // This is a slightly different version of emailSignUp for creating another user using the
    // auth/signup endpoint. This is useful for things like creating a user from an admin account.
    // Unlike emailSignUp, this doesn't log in as the user.
    createEmailUser: builder.mutation<UserResponse, EmailSignupRequest>({
      invalidatesTags: [path, "conversations"],
      query: ({email, password, ...body}) => ({
        body: {email, password, ...body},
        method: "POST",
        url: `auth/signup`,
      }),
    }),
    emailLogin: builder.mutation<UserResponse, EmailLoginRequest>({
      extraOptions: {maxRetries: 0},
      invalidatesTags: [path],
      query: ({email, username, password}) => ({
        body: {email, password, username},
        method: "POST",
        url: "auth/login",
      }),
    }),
    emailSignUp: builder.mutation<UserResponse, EmailSignupRequest>({
      invalidatesTags: [path],
      query: ({email, password, ...body}) => ({
        body: {email, password, ...body},
        method: "POST",
        url: `auth/signup`,
      }),
    }),
    googleLogin: builder.mutation<UserResponse, GoogleLoginRequest>({
      extraOptions: {maxRetries: 0},
      invalidatesTags: [path],
      query: (body) => ({
        body,
        method: "POST",
        url: `/auth/google`,
      }),
    }),
    resetPassword: builder.mutation<UserResponse, ResetPasswordRequest>({
      extraOptions: {maxRetries: 0},
      query: ({_id, password, oldPassword, newPassword, ...body}) => ({
        body: {_id, newPassword, oldPassword, password, ...body},
        method: "POST",
        url: `/resetPassword`,
      }),
    }),
  };
};

// noExplicitAny: generateAuthSlice attaches to consumer OpenAPI-generated APIs whose EndpointDefinitions differ per app; Api's Definitions generic must stay open
// biome-ignore lint/suspicious/noExplicitAny: generateAuthSlice attaches to consumer OpenAPI-generated APIs whose EndpointDefinitions differ per app
export const generateAuthSlice = (api: Api<any, any, any, any, any>) => {
  const authSlice = createSlice({
    extraReducers: (builder) => {
      // Reset isAuthenticating on rehydration in case the app was killed mid-login
      builder.addCase("persist/REHYDRATE", (state) => {
        state.isAuthenticating = false;
      });
      builder.addMatcher(api.endpoints.emailLogin.matchFulfilled, (state) => {
        // Note: isAuthenticating is normally cleared by setUserId after the listener
        // middleware stores the token. This is a safety fallback in case the listener fails.
        state.isAuthenticating = false;
        console.debug("Login success");
      });
      builder.addMatcher(
        api.endpoints.emailLogin.matchRejected,
        (state, action: PayloadAction<{data?: AuthErrorData}>) => {
          state.error = action.payload?.data?.message ?? null;
          state.isAuthenticating = false;
          console.debug("Login rejected", action.payload?.data?.message);
        }
      );
      builder.addMatcher(api.endpoints.emailLogin.matchPending, (state) => {
        state.error = null;
        state.isAuthenticating = true;
        console.debug("Login pending");
      });
      builder.addMatcher(api.endpoints.emailSignUp.matchFulfilled, (state) => {
        // Safety fallback: clear isAuthenticating in case the listener middleware fails.
        state.isAuthenticating = false;
        console.debug("Signup success");
      });
      builder.addMatcher(
        api.endpoints.emailSignUp.matchRejected,
        (state, action: PayloadAction<{data?: AuthErrorData}>) => {
          state.error = action.payload?.data?.message ?? null;
          state.isAuthenticating = false;
          console.debug("Signup rejected", action.payload);
        }
      );
      builder.addMatcher(api.endpoints.emailSignUp.matchPending, (state) => {
        state.error = null;
        state.isAuthenticating = true;
        console.debug("Signup pending");
      });
      builder.addMatcher(api.endpoints.googleLogin.matchPending, (state) => {
        state.error = null;
        state.isAuthenticating = true;
      });
      builder.addMatcher(api.endpoints.googleLogin.matchFulfilled, (state) => {
        // Safety fallback: clear isAuthenticating in case the listener middleware fails.
        state.isAuthenticating = false;
      });
      builder.addMatcher(
        api.endpoints.googleLogin.matchRejected,
        (state, action: PayloadAction<{data?: AuthErrorData}>) => {
          state.error = action.payload?.data?.message ?? null;
          state.isAuthenticating = false;
        }
      );
    },
    initialState: {
      error: null,
      isAuthenticating: false,
      lastTokenRefreshTimestamp: null,
      userId: null,
    } as AuthState,
    name: "auth",
    reducers: {
      logout: (state) => {
        state.userId = null;
        state.isAuthenticating = false;
        state.lastTokenRefreshTimestamp = null;
      },
      setUserId: (state, {payload: {userId}}: PayloadAction<{userId: string}>) => {
        state.userId = userId;
        state.isAuthenticating = false;
      },
      tokenRefreshedSuccess: (state) => {
        state.lastTokenRefreshTimestamp = DateTime.now().toMillis();
      },
    },
  });
  // Since we need to do async actions to store tokens in expo-secure-store,
  // we need to use a listener middleware.
  const loginListenerMiddleware = createListenerMiddleware();
  loginListenerMiddleware.startListening({
    effect: async (action: MutationFulfilledAction, listenerApi) => {
      if (
        action.payload?.token &&
        (action.meta?.arg?.endpointName === "emailLogin" ||
          action.meta?.arg?.endpointName === "emailSignUp" ||
          action.meta?.arg?.endpointName === "googleLogin")
      ) {
        if (!IsWeb) {
          try {
            await SecureStore.setItemAsync("AUTH_TOKEN", action.payload.token);
            await SecureStore.setItemAsync("REFRESH_TOKEN", action.payload.refreshToken ?? "");
            console.debug("Saved auth token to secure storage.");
          } catch (error) {
            console.error(`Error setting auth token: ${error}`);
            throw error;
          }
        } else {
          // On web, we don't have secure storage, and cookie support is not in Expo yet,
          // so this is what we're left with. This can be vulnerable to XSS attacks.
          try {
            // Check if we're in a browser environment (not SSR)
            if (typeof window !== "undefined") {
              await AsyncStorage.setItem("AUTH_TOKEN", action.payload.token);
              await AsyncStorage.setItem("REFRESH_TOKEN", action.payload.refreshToken ?? "");
              console.debug("Saved auth token to async storage.");
            } else {
              console.warn("Cannot store auth token: window is not defined (SSR context)");
            }
          } catch (error) {
            console.error(`Error setting auth token: ${error}`);
            throw error;
          }
        }
        listenerApi.dispatch(authSlice.actions.setUserId({userId: action.payload.userId ?? ""}));
        emitAuthChange();
      }
    },
    type: "terreno-rtk/executeMutation/fulfilled",
  });

  // const clearLocalStorage = async (): Promise<void> => {
  //   try {
  //     const keys = await AsyncStorage.getAllKeys();
  //     const keysToRemove = keys.filter((key) => key.includes("formInstance"));
  //     if (keysToRemove.length > 0) {
  //       await AsyncStorage.multiRemove(keysToRemove);
  //       console.debug("Cleared local storage.");
  //     }
  //   } catch (error) {
  //     console.error("Error:", error);
  //   }
  // };
  // Since we need to do async actions to store tokens in expo-secure-store,
  // we need to use a listener middleware.
  const logoutListenerMiddleware = createListenerMiddleware();
  logoutListenerMiddleware.startListening({
    effect: async () => {
      // TODO: We should only clear local storage when we're logging out, not disconnected.
      // await clearLocalStorage();
      if (!IsWeb) {
        await SecureStore.deleteItemAsync("AUTH_TOKEN");
        await SecureStore.deleteItemAsync("REFRESH_TOKEN");
      } else {
        // Check if we're in a browser environment (not SSR)
        if (typeof window !== "undefined") {
          await AsyncStorage.removeItem("AUTH_TOKEN");
          await AsyncStorage.removeItem("REFRESH_TOKEN");
        }
      }
      console.debug("Cleared auth token from secure storage as part of logout.");
      emitAuthChange();
    },
    type: LOGOUT_ACTION_TYPE,
  });
  return {
    authReducer: authSlice.reducer,
    authSlice,
    logout: authSlice.actions.logout,
    middleware: [logoutListenerMiddleware.middleware, loginListenerMiddleware.middleware],
    setUserId: authSlice.actions.setUserId,
    tokenRefreshedSuccess: authSlice.actions.tokenRefreshedSuccess,
  };
};

export const selectCurrentUserId = (state: RootState): string | undefined => state.auth?.userId;
export const selectLastTokenRefreshTimestamp = (state: RootState): number | null =>
  state.auth?.lastTokenRefreshTimestamp ?? null;
export const selectIsAuthenticating = (state: RootState): boolean =>
  state.auth?.isAuthenticating ?? false;

export const useSelectCurrentUserId = (): string | undefined => {
  return useSelector((state: RootState): string | undefined => {
    return state.auth?.userId;
  });
};

export const useSelectIsAuthenticating = (): boolean => {
  return useSelector((state: RootState): boolean => state.auth?.isAuthenticating ?? false);
};

export const getAuthToken = async (): Promise<string | null> => {
  let token: string | null;

  if (!IsWeb) {
    token = await SecureStore.getItemAsync("AUTH_TOKEN");
  } else {
    // Check if we're in a browser environment (not SSR)
    if (typeof window !== "undefined") {
      token = await AsyncStorage.getItem("AUTH_TOKEN");
    } else {
      console.warn("Cannot get auth token: window is not defined (SSR context)");
      token = null;
    }
  }
  return token;
};
