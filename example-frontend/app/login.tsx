import {baseUrl} from "@terreno/rtk";
import type {LoginScreenProps} from "@terreno/ui";
import {Box, Button, LoginScreen} from "@terreno/ui";
import {useLocalSearchParams, useRouter} from "expo-router";
import type React from "react";
import {useCallback, useMemo, useState} from "react";
import {
  betterAuthClient,
  isMockOidcSignInEnabled,
  MOCK_OIDC_PROVIDER_ID,
  signInWithSocial,
} from "@/lib/betterAuth";
import {getOAuthErrorMessage} from "@/lib/oauthErrorMessage";
import {syncBetterAuthSession, useAppDispatch} from "@/store/index";

const Login: React.FC = () => {
  const router = useRouter();
  const dispatch = useAppDispatch();
  // index.js hides any handoff token before Expo Router loads, and app/_layout.tsx exchanges it,
  // so `error` here is a provider's failed return, never a half-read handoff.
  const {error: oauthError} = useLocalSearchParams<{error?: string}>();
  const [socialLoading, setSocialLoading] = useState<string | null>(null);
  const [errorMessage, setErrorMessage] = useState<string | undefined>(() =>
    getOAuthErrorMessage(oauthError)
  );
  const [isSubmitting, setIsSubmitting] = useState(false);

  const handleSubmit = useCallback(
    async (values: Record<string, string>): Promise<void> => {
      const {email, password} = values;
      setErrorMessage(undefined);
      setIsSubmitting(true);
      try {
        const result = await betterAuthClient.signIn.email({email, password});
        if (result.error) {
          setErrorMessage(result.error.message ?? "Sign in failed.");
          return;
        }
        await syncBetterAuthSession(dispatch);
        router.replace("/(tabs)");
      } catch (error: unknown) {
        // A thrown error here is a transport failure rather than rejected credentials
        // (those come back as result.error above), so log the cause: on native it is
        // usually an unreachable API base URL.
        console.error("[login] Email sign in threw", {baseUrl, error});
        setErrorMessage("Sign in failed. Please try again.");
      } finally {
        setIsSubmitting(false);
      }
    },
    [dispatch, router]
  );

  const handleSocialLogin = useCallback(
    async (provider: string): Promise<void> => {
      setSocialLoading(provider);
      setErrorMessage(undefined);
      try {
        const isRedirecting = await signInWithSocial(provider);
        if (isRedirecting) {
          // The page is leaving for the provider; the session is read when it comes back.
          return;
        }
        await syncBetterAuthSession(dispatch);
        router.replace("/(tabs)");
      } catch (error: unknown) {
        console.error("[login] Social sign in threw", {baseUrl, error, provider});
        setErrorMessage("Sign in failed. Please try again.");
      } finally {
        // Also clears it when the page is leaving, so a Back from the provider that restores
        // this page from the browser's cache shows usable buttons.
        setSocialLoading(null);
      }
    },
    [dispatch, router]
  );

  const handleMockOidcLogin = useCallback((): Promise<void> => {
    return handleSocialLogin(MOCK_OIDC_PROVIDER_ID);
  }, [handleSocialLogin]);

  const oauthProviders = useMemo((): LoginScreenProps["oauthProviders"] => {
    return (["google", "github", "apple"] as const).map((provider) => ({
      disabled: isSubmitting || Boolean(socialLoading),
      loading: socialLoading === provider,
      onPress: () => handleSocialLogin(provider),
      provider,
    }));
  }, [isSubmitting, socialLoading, handleSocialLogin]);

  const handleSignUpPress = useCallback((): void => {
    router.push("/signup");
  }, [router]);

  const handleForgotPassword = useCallback((): void => {
    router.push("/forgotPassword");
  }, [router]);

  const isLoading = isSubmitting || Boolean(socialLoading);

  const loginScreen = (
    <LoginScreen
      error={errorMessage}
      fields={[
        {autoComplete: "off", label: "Email", name: "email", required: true, type: "email"},
        {label: "Password", name: "password", required: true, type: "password"},
      ]}
      loading={isLoading}
      oauthProviders={oauthProviders}
      onForgotPassword={handleForgotPassword}
      onSignUpPress={handleSignUpPress}
      onSubmit={handleSubmit}
      testID="login-screen"
    />
  );

  if (!isMockOidcSignInEnabled) {
    return loginScreen;
  }

  // Dev and e2e only: @terreno/ui's SocialLoginButton brands Google, GitHub and Apple, so the
  // local mock OIDC provider gets a plain button below the form.
  return (
    <Box flex="grow">
      {loginScreen}
      <Box alignItems="center" paddingY={4}>
        <Box maxWidth={400} paddingX={4} width="100%">
          <Button
            disabled={isLoading}
            fullWidth
            iconName="key"
            loading={socialLoading === MOCK_OIDC_PROVIDER_ID}
            onClick={handleMockOidcLogin}
            testID="login-mock-oidc-button"
            text="Continue with Mock OIDC"
            variant="outline"
          />
        </Box>
      </Box>
    </Box>
  );
};

export default Login;
