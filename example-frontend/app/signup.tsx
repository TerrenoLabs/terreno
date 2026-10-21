import type {SignUpScreenProps} from "@terreno/ui";
import {SignUpScreen, simplePasswordRequirements} from "@terreno/ui";
import {useRouter} from "expo-router";
import type React from "react";
import {useCallback, useMemo, useState} from "react";
import {betterAuthClient, signInWithSocial} from "@/lib/betterAuth";
import {syncBetterAuthSession, useAppDispatch} from "@/store/index";

const SignUp: React.FC = () => {
  const router = useRouter();
  const dispatch = useAppDispatch();
  const [socialLoading, setSocialLoading] = useState<string | null>(null);
  const [errorMessage, setErrorMessage] = useState<string | undefined>(undefined);
  const [isSubmitting, setIsSubmitting] = useState(false);

  const handleSubmit = useCallback(
    async (values: Record<string, string>): Promise<void> => {
      const {email, password, name} = values;
      setErrorMessage(undefined);
      setIsSubmitting(true);
      try {
        const result = await betterAuthClient.signUp.email({email, name, password});
        if (result.error) {
          setErrorMessage(result.error.message ?? "Sign up failed.");
          return;
        }
        await syncBetterAuthSession(dispatch);
        router.replace("/(tabs)");
      } catch {
        setErrorMessage("Sign up failed. Please try again.");
      } finally {
        setIsSubmitting(false);
      }
    },
    [dispatch, router]
  );

  const handleSocialLogin = useCallback(
    async (provider: "google" | "github" | "apple"): Promise<void> => {
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
      } catch {
        setErrorMessage("Sign up failed. Please try again.");
      } finally {
        // Also clears it when the page is leaving, so a Back from the provider that restores
        // this page from the browser's cache shows usable buttons.
        setSocialLoading(null);
      }
    },
    [dispatch, router]
  );

  const oauthProviders = useMemo((): SignUpScreenProps["oauthProviders"] => {
    return (["google", "github", "apple"] as const).map((provider) => ({
      disabled: isSubmitting || Boolean(socialLoading),
      loading: socialLoading === provider,
      onPress: () => handleSocialLogin(provider),
      provider,
    }));
  }, [isSubmitting, socialLoading, handleSocialLogin]);

  const isLoading = isSubmitting || Boolean(socialLoading);

  return (
    <SignUpScreen
      error={errorMessage}
      fields={[
        {label: "Name", name: "name", required: true, type: "text"},
        {autoComplete: "off", label: "Email", name: "email", required: true, type: "email"},
        {label: "Password", name: "password", required: true, type: "password"},
      ]}
      loading={isLoading}
      oauthProviders={oauthProviders}
      onLoginPress={() => router.back()}
      onSubmit={handleSubmit}
      passwordRequirements={simplePasswordRequirements}
      testID="signup-screen"
    />
  );
};

export default SignUp;
