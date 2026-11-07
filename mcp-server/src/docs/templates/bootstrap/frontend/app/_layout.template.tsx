import {SessionProvider, useSession} from "@terreno/syncdb/auth";
import {baseUrl} from "@terreno/syncdb/config";
import {ApiClientProvider, SyncDbProvider} from "@terreno/syncdb/react";
import {Spinner, TerrenoProvider} from "@terreno/ui";
import {Stack} from "expo-router";
import {DefaultTheme, ThemeProvider} from "expo-router/react-navigation";
import type React from "react";
import {useEffect} from "react";
import "react-native-reanimated";
import {installDevConsoleLogger} from "@terreno/syncdb/app";
import {betterAuthClient} from "@/lib/betterAuth";
import {apiClient} from "@/store/apiClient";
import {setSyncDbReady, syncDb} from "@/store/syncdb";

installDevConsoleLogger({baseUrl});

export {ErrorBoundary} from "expo-router";

export const unstable_settings = {
  initialRouteName: "(tabs)",
};

// Logging out signs syncDb out (stop + wipe) and drops cached API responses so the next
// user never sees the previous user's data.
const SYNC_DBS = [syncDb];

// TerrenoProvider loads the Nunito/Titillium Web families @terreno/ui renders with, so this
// app ships no font assets of its own. Add `useFonts` here only for extra custom faces.
// SessionProvider owns the Better Auth session (`useSession()`); ApiClientProvider gives the
// generated hooks in store/apiSdk.ts their request client. No Redux store.
export default function RootLayout(): React.ReactElement {
  return (
    <TerrenoProvider openAPISpecUrl={`${baseUrl}/openapi.json`}>
      <ApiClientProvider client={apiClient}>
        <SessionProvider
          authClient={betterAuthClient}
          onLogout={apiClient.reset}
          syncDbs={SYNC_DBS}
        >
          <RootLayoutNav />
        </SessionProvider>
      </ApiClientProvider>
    </TerrenoProvider>
  );
}

function RootLayoutNav(): React.ReactElement {
  const {userId, isLoading: isAuthLoading} = useSession();

  // Start syncdb after login; stop on logout or user switch.
  useEffect(() => {
    if (!userId) {
      setSyncDbReady(false);
      return;
    }
    let stopped = false;
    void syncDb
      .start()
      .then(() => {
        if (!stopped) {
          setSyncDbReady(true);
        }
      })
      .catch((startError: unknown) => {
        console.error("[syncdb] start failed", startError);
        setSyncDbReady(false);
      });
    return () => {
      stopped = true;
      setSyncDbReady(false);
      void syncDb.stop();
    };
  }, [userId]);

  if (isAuthLoading) {
    return <Spinner />;
  }

  return (
    <SyncDbProvider client={syncDb}>
      <ThemeProvider value={DefaultTheme}>
        {/* Stack.Protected is the supported way to gate routes on auth state. Rendering
            Stack.Screen children behind a raw conditional (or a fragment) crashes the
            navigator, because Stack reads its screen config off the child elements. */}
        <Stack>
          <Stack.Protected guard={!userId}>
            <Stack.Screen name="login" options={{headerShown: false}} />
            <Stack.Screen name="signup" options={{headerShown: false}} />
          </Stack.Protected>
          <Stack.Protected guard={Boolean(userId)}>
            <Stack.Screen name="(tabs)" options={{headerShown: false}} />
          </Stack.Protected>
        </Stack>
      </ThemeProvider>
    </SyncDbProvider>
  );
}
