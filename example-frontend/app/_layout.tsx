import FontAwesome from "@expo/vector-icons/FontAwesome";
import {useFonts} from "expo-font";
import {Stack, useRouter, useSegments} from "expo-router";
import * as SplashScreen from "expo-splash-screen";
import React, {type FC, type ReactNode, useCallback, useEffect, useState} from "react";
import {Platform, StatusBar} from "react-native";
import {GestureHandlerRootView} from "react-native-gesture-handler";
import "react-native-reanimated";
import {OpenFeatureProvider} from "@openfeature/react-sdk";
import {
  baseUrl,
  installTerrenoDevConsoleLogger,
  selectBetterAuthIsLoading,
  selectBetterAuthUserId,
  setRealtimeSocket,
  useRealtimeDebug,
  useSocketConnection,
  useTerrenoFeatureFlags,
  useUpgradeCheck,
} from "@terreno/rtk";
import {SyncDbProvider} from "@terreno/syncdb/react";
import {
  AnnouncementNavigator,
  Banner,
  Box,
  Button,
  ConflictSheet,
  ConsentNavigator,
  Spinner,
  Text,
  UpgradeRequiredScreen,
  useTheme,
} from "@terreno/ui";
import {Provider, useSelector} from "react-redux";
import {PersistGate} from "redux-persist/integration/react";
import {SyncConflictsProvider} from "@/components/SyncConflictsController";
import {SyncHealthToast} from "@/components/SyncHealthToast";
import {SyncLabRuntime} from "@/components/SyncLabRuntime";
import {AppThemeProvider} from "@/contexts/ThemePreferenceContext";
import {getSessionToken} from "@/lib/betterAuth";
import store, {persistor, syncBetterAuthSession} from "@/store/index";
import {registerExpoPushTokenSafely} from "@/store/registerExpoPushToken";
import {terrenoApi, useGetMeQuery, usePostCommsPushTokensMutation} from "@/store/sdk";
import {setSyncDbReady, syncDb} from "@/store/syncdb";
import {getCurrentExpoToken} from "@/store/utils";

installTerrenoDevConsoleLogger();

interface ProfileData {
  _id: string;
  id: string;
  email?: string;
  name?: string;
  admin?: boolean;
  emailVerified?: boolean;
  roles?: string[];
  permissions?: Record<string, readonly string[]>;
}

const OpenFeatureBridge: FC<{
  children: ReactNode;
  socket: ReturnType<typeof useSocketConnection>["socket"];
}> = ({children, socket}) => {
  const bridgeUserId = useSelector(selectBetterAuthUserId) ?? undefined;
  useTerrenoFeatureFlags(terrenoApi, {
    skip: !bridgeUserId,
    socket,
    userId: bridgeUserId,
  });
  return <OpenFeatureProvider domain="feature-flags">{children}</OpenFeatureProvider>;
};

const PushTokenRegistrar: FC = () => {
  const [postToken] = usePostCommsPushTokensMutation();

  const register = useCallback(async (): Promise<void> => {
    await registerExpoPushTokenSafely({
      getToken: getCurrentExpoToken,
      platform: Platform.OS,
      postToken: async (body) => {
        await postToken(body).unwrap();
      },
    });
  }, [postToken]);

  // Register the current device token once the session is available. Web has no Expo
  // push token, so registerExpoPushTokenSafely no-ops there without hitting the API.
  useEffect(() => {
    void register();
  }, [register]);

  return null;
};

export {ErrorBoundary} from "expo-router";

export const unstable_settings = {
  initialRouteName: "(tabs)",
};

SplashScreen.preventAutoHideAsync();

const RootLayout = (): React.ReactElement | null => {
  const [loaded, error] = useFonts({
    SpaceMono: require("../assets/fonts/SpaceMono-Regular.ttf"),
    ...FontAwesome.font,
    heading: require("../assets/fonts/TitilliumWeb_600SemiBold.ttf"),
    "heading-bold": require("../assets/fonts/TitilliumWeb_700Bold.ttf"),
    "heading-semibold": require("../assets/fonts/TitilliumWeb_600SemiBold.ttf"),
    text: require("../assets/fonts/Nunito_400Regular.ttf"),
    "text-bold": require("../assets/fonts/Nunito_700Bold.ttf"),
    "text-bold-italic": require("../assets/fonts/Nunito_700Bold_Italic.ttf"),
    "text-medium": require("../assets/fonts/Nunito_500Medium.ttf"),
    "text-medium-italic": require("../assets/fonts/Nunito_500Medium_Italic.ttf"),
    "text-regular": require("../assets/fonts/Nunito_400Regular.ttf"),
    "text-regular-italic": require("../assets/fonts/Nunito_400Regular_Italic.ttf"),
  });

  useEffect(() => {
    if (error) {
      throw error;
    }
  }, [error]);

  useEffect(() => {
    if (loaded) {
      SplashScreen.hideAsync();
    }
  }, [loaded]);

  if (!loaded) {
    return null;
  }

  return (
    <GestureHandlerRootView style={{flex: 1}}>
      <Provider store={store}>
        <PersistGate loading={null} persistor={persistor}>
          <AppThemeProvider openAPISpecUrl={`${baseUrl}/openapi.json`}>
            <RootLayoutNav />
          </AppThemeProvider>
        </PersistGate>
      </Provider>
    </GestureHandlerRootView>
  );
};

const ThemedStatusBar: FC = () => {
  const {colorScheme, theme} = useTheme();
  return (
    <StatusBar
      backgroundColor={theme.surface.base}
      barStyle={colorScheme === "dark" ? "light-content" : "dark-content"}
    />
  );
};

const RootLayoutNav = (): React.ReactElement => {
  const {theme} = useTheme();
  const userId = useSelector(selectBetterAuthUserId) ?? undefined;
  // The initial syncBetterAuthSession() call below is async (it awaits
  // authClient.getSession()), so userId is undefined for one or more render
  // passes on every fresh page load — including a deep link straight to a
  // route like /profile or /admin. Without gating on this flag, the auth
  // redirect effect below sees "no user yet" and replaces the URL with
  // /login before the session resolves, then bounces to the hardcoded
  // /(tabs) root once it does, silently discarding the originally requested
  // route.
  const isAuthLoading = useSelector(selectBetterAuthIsLoading);
  const [syncDbStartError, setSyncDbStartError] = useState<string | null>(null);
  const [syncDbStartAttempt, setSyncDbStartAttempt] = useState<number>(0);
  const {data: profileData, isLoading: isProfileLoading} = useGetMeQuery(undefined, {
    skip: !userId,
  });
  const profile = profileData as ProfileData | undefined;
  const segments = useSegments();
  const router = useRouter();
  const {
    canUpdate,
    isRequired,
    isWarning,
    onUpdate,
    requiredMessage,
    warningCheckCount,
    warningMessage,
  } = useUpgradeCheck({pollingIntervalMs: 300_000, recheckOnForeground: true});

  const getAuthToken = useCallback(async (): Promise<string | null> => {
    return getSessionToken();
  }, []);

  const handleRetrySyncDbStart = useCallback((): void => {
    setSyncDbStartError(null);
    setSyncDbStartAttempt((attempt) => attempt + 1);
  }, []);

  const {socket} = useSocketConnection({
    baseUrl,
    getAuthToken,
    shouldConnect: Boolean(userId),
  });

  useRealtimeDebug(baseUrl, socket?.connected);

  useEffect(() => {
    setRealtimeSocket(socket);
    return (): void => {
      setRealtimeSocket(null);
    };
  }, [socket]);

  // Hydrate Better Auth session into Redux on startup.
  useEffect(() => {
    void syncBetterAuthSession(store.dispatch);
  }, []);

  // Start the local-first syncdb client after login; stop on logout/unmount.
  // setSyncDbReady only flips true once start() resolves a user, so screens gated on
  // useSyncDbReady() don't call mutate() during the window where it would throw.
  //
  // A failed start() is terminal for writes — syncDbReady never flips, so the new-todo
  // form stays disabled — which is why the failure is surfaced with a retry affordance
  // instead of only logged. Bumping syncDbStartAttempt re-runs this effect, whose
  // cleanup stops the half-started client first so the retry begins from a clean state.
  useEffect(() => {
    if (!userId) {
      return;
    }
    let stopped = false;
    syncDb
      .start()
      .then(() => {
        if (!stopped) {
          setSyncDbStartError(null);
          setSyncDbReady(true);
        }
      })
      .catch((error: unknown) => {
        console.error("[syncdb] Failed to start client", error);
        if (!stopped) {
          setSyncDbStartError(error instanceof Error ? error.message : String(error));
        }
      });
    return (): void => {
      if (stopped) {
        return;
      }
      stopped = true;
      setSyncDbReady(false);
      syncDb.stop().catch((error: unknown) => {
        console.warn("[syncdb] Failed to stop client", error);
      });
    };
  }, [userId, syncDbStartAttempt]);

  useEffect(() => {
    // Don't redirect while the initial Better Auth session sync is still in
    // flight: userId is momentarily undefined on every fresh load (including
    // deep links to routes like /profile or /admin), and redirecting to
    // /login now would bounce straight back to the hardcoded /(tabs) root
    // once the session resolves, losing the originally requested route.
    if (isAuthLoading) {
      return;
    }

    const isLoginOrSignup = segments[0] === "login" || segments[0] === "signup";
    const isPublicAuthPage =
      isLoginOrSignup ||
      segments[0] === "forgotPassword" ||
      segments[0] === "resetPassword" ||
      segments[0] === "verifyEmail";

    if (!userId && !isPublicAuthPage) {
      router.replace("/login");
    } else if (userId && isLoginOrSignup) {
      router.replace("/(tabs)");
    }
  }, [userId, segments, router, isAuthLoading]);

  // Hold the navigator until the session (and, for signed-in users, the profile that
  // decides the ConsentNavigator wrapper below) has settled. The wrapper choice changes
  // the Stack's position in the React tree, and re-parenting unmounts and remounts the
  // Stack — a remounted Stack resets to initialRouteName "(tabs)", silently discarding
  // a deep-linked route like /profile or /admin. Rendering only once the tree shape is
  // final means the Stack mounts exactly once per auth state and keeps the requested URL.
  if (isAuthLoading || (Boolean(userId) && isProfileLoading)) {
    return (
      <Box alignItems="center" flex="grow" justifyContent="center" testID="app-auth-loading">
        <ThemedStatusBar />
        <Spinner />
      </Box>
    );
  }

  if (isRequired) {
    return (
      <>
        <ThemedStatusBar />
        <UpgradeRequiredScreen
          canUpdate={canUpdate}
          message={
            requiredMessage ?? "This version is no longer supported. Please update to continue."
          }
          onUpdate={onUpdate}
        />
      </>
    );
  }

  const warningBanner = isWarning ? (
    <Banner
      buttonOnClick={onUpdate}
      buttonText="Update"
      dismissible
      key={warningCheckCount}
      status="warning"
      text={warningMessage ?? "A new version is available. Please update for the best experience."}
    />
  ) : null;

  const stack = (
    <Stack
      screenOptions={{
        contentStyle: {backgroundColor: theme.surface.base},
        headerShown: false,
      }}
    >
      <Stack.Screen name="(tabs)" />
      <Stack.Screen name="admin" />
      <Stack.Screen name="login" />
      <Stack.Screen name="signup" />
      <Stack.Screen name="forgotPassword" />
      <Stack.Screen name="resetPassword" />
      <Stack.Screen name="verifyEmail" />
      <Stack.Screen name="syncdb-debug" options={{presentation: "modal"}} />
      <Stack.Screen name="settings" />
      <Stack.Screen name="notifications" />
      <Stack.Screen name="todo-windows/index" />
    </Stack>
  );

  const syncDbStartErrorBanner =
    userId && syncDbStartError ? (
      <Box
        alignItems="center"
        color="error"
        direction="row"
        gap={3}
        justifyContent="between"
        paddingX={4}
        paddingY={3}
        testID="syncdb-start-error"
        wrap
      >
        <Box flex="grow">
          <Text bold color="inverted">
            Offline sync could not start
          </Text>
          <Text color="inverted" size="sm">
            Your changes can't be saved until it does. {syncDbStartError}
          </Text>
        </Box>
        <Button
          onClick={handleRetrySyncDbStart}
          testID="syncdb-start-retry"
          text="Retry"
          variant="secondary"
        />
      </Box>
    ) : null;

  const content = (
    <SyncConflictsProvider>
      {warningBanner}
      {syncDbStartErrorBanner}
      {userId ? (
        <SyncDbProvider client={syncDb}>
          <PushTokenRegistrar />
          <SyncLabRuntime />
          <SyncHealthToast
            collectionLabels={{todos: "Todos"}}
            renderConflictsModal={({collection, conflicts, onDismiss, resolve, visible}) => (
              <ConflictSheet
                conflicts={conflicts}
                onDismiss={onDismiss}
                onResolve={resolve}
                title={
                  collection === "todos"
                    ? "These todos don't match"
                    : collection
                      ? `These ${collection} don't match`
                      : undefined
                }
                visible={visible}
              />
            )}
          />
          {stack}
        </SyncDbProvider>
      ) : (
        stack
      )}
    </SyncConflictsProvider>
  );

  const frequencyUserId = profile?.id ?? profile?._id ?? userId;

  // skipFirstLaunch: false so seeded interrupts show on first login; default max 1/session
  // is fine because seed archives legacy all-audience modals and targets staff vs patient.
  const announcementWrapped = userId ? (
    <AnnouncementNavigator
      api={terrenoApi}
      frequency={{
        skipFirstLaunch: false,
        userId: frequencyUserId,
      }}
    >
      <OpenFeatureBridge socket={socket}>{content}</OpenFeatureBridge>
    </AnnouncementNavigator>
  ) : (
    <OpenFeatureBridge socket={socket}>{content}</OpenFeatureBridge>
  );

  if (userId && !profile?.admin) {
    console.info("[RootLayout] Non-admin user, wrapping with ConsentNavigator", {
      admin: profile?.admin,
      profileLoaded: !!profile,
      userId,
    });
    return (
      <>
        <ThemedStatusBar />
        <ConsentNavigator api={terrenoApi}>{announcementWrapped}</ConsentNavigator>
      </>
    );
  }

  console.debug("[RootLayout] Skipping ConsentNavigator", {
    admin: profile?.admin,
    profileLoaded: !!profile,
    userId: userId ?? "none",
  });
  return (
    <>
      <ThemedStatusBar />
      {announcementWrapped}
    </>
  );
};

export default RootLayout;
