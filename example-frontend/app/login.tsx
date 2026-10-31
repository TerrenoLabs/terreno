import {
  type LoginControllerStep,
  type LoginSignedInEvent,
  selectBetterAuthUserId,
  TerrenoLoginScreen,
} from "@terreno/rtk";
import {useLocalSearchParams, useRouter} from "expo-router";
import type React from "react";
import {useCallback, useMemo} from "react";
import {useSelector} from "react-redux";
import {
  betterAuthClient,
  getLoginCallbackURL,
  OAUTH_PROVIDER_LABELS,
  rememberedAccounts,
} from "@/lib/betterAuth";
import {syncBetterAuthSession, useAppDispatch} from "@/store/index";

/** Matches Better Auth's default `trustDeviceMaxAge`, which example-backend leaves as is. */
const TRUST_DEVICE_DAYS = 30;

/**
 * The example's login route: `TerrenoLoginScreen` from @terreno/rtk, driven by the server's
 * `/terreno/methods`. It shows the providers the server lists (the mock OIDC provider in e2e),
 * "Continue as" cards and the last used method from this device, the passkey button on web, and
 * the two-factor challenge inline. A social sign-in returns here, so the screen finds the new
 * session, records the method, and navigates on; app/_layout.tsx leaves a signed-in user on this
 * route for that reason.
 */
const Login: React.FC = () => {
  const router = useRouter();
  const dispatch = useAppDispatch();
  // index.js hides any handoff token before Expo Router loads, so `error` here is a provider's
  // failed return, never a half-read handoff. The screen maps known codes to guidance and never
  // shows the raw value.
  const {error} = useLocalSearchParams<{error?: string}>();
  const callbackURL = useMemo((): string => getLoginCallbackURL(), []);

  const userId = useSelector(selectBetterAuthUserId);

  // Expo Router keeps the initial "(tabs)" route under /login, so go back to it rather than
  // adding a second tabs screen on top.
  const leaveLogin = useCallback((): void => {
    router.dismissTo("/(tabs)");
  }, [router]);

  const handleSignedIn = useCallback(
    async ({user}: LoginSignedInEvent): Promise<void> => {
      // Redux already holds this user when the app opened on /login signed in (a social sign-in
      // returning here); syncing again would flip the root layout's spinner and remount the Stack.
      if (userId !== user.id) {
        await syncBetterAuthSession(dispatch);
      }
      leaveLogin();
    },
    [dispatch, leaveLogin, userId]
  );

  // A signed-in user whose session the screen could not confirm (the check threw) would otherwise
  // be left on the form; app/_layout.tsx no longer moves anyone off /login.
  const handleStepChange = useCallback(
    (step: LoginControllerStep): void => {
      if (step === "login" && userId) {
        leaveLogin();
      }
    },
    [leaveLogin, userId]
  );

  const handleSignUpPress = useCallback((): void => {
    router.push("/signup");
  }, [router]);

  const handleForgotPasswordPress = useCallback((): void => {
    router.push("/forgotPassword");
  }, [router]);

  return (
    <TerrenoLoginScreen
      callbackURL={callbackURL}
      client={betterAuthClient}
      error={error}
      onForgotPasswordPress={handleForgotPasswordPress}
      onSignedIn={handleSignedIn}
      onSignUpPress={handleSignUpPress}
      onStepChange={handleStepChange}
      providerLabels={OAUTH_PROVIDER_LABELS}
      rememberedAccounts={rememberedAccounts}
      rememberIdentity
      testID="login-screen"
      trustDeviceDays={TRUST_DEVICE_DAYS}
    />
  );
};

export default Login;
