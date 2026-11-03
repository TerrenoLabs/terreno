import {useSession} from "@terreno/syncdb/auth";
import {Box, Button, Heading, SocialLoginButton, Text, TextField} from "@terreno/ui";
import {useLoaderData, useLocalSearchParams, useRouter} from "expo-router";
import React, {useCallback, useState} from "react";
import {useAppConfig} from "../components/AppConfigGate";
import {useAuthClient} from "../components/StoreProvider";
import type {AdminSpaAppConfig} from "../src/appConfig";
import {sanitizeReturnTo} from "../src/returnTo";
import {getAdminSpaServerContext} from "../src/serverContext";

type SocialProvider = "google" | "github" | "apple";

interface LoginLoaderData {
  appConfig: AdminSpaAppConfig | null;
}

/**
 * Server loader: the runtime config the serve plugin published, so the brand is in the
 * first HTML and in the JSON a client-side navigation to /login fetches.
 */
export const loader = (): LoginLoaderData => ({
  appConfig: getAdminSpaServerContext()?.appConfig ?? null,
});

const LoginScreen: React.FC = () => {
  const router = useRouter();
  const {returnTo} = useLocalSearchParams<{returnTo?: string | string[]}>();
  const {appConfig} = useAppConfig();
  const loaderData = useLoaderData<typeof loader>();
  const brandName = loaderData?.appConfig?.brandName ?? appConfig.brandName;
  const authClient = useAuthClient();
  const {refresh} = useSession();

  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | undefined>(undefined);
  const [isSubmitting, setIsSubmitting] = useState(false);

  // Resolve the new session now rather than waiting for Better Auth's session signal, then
  // go where the visitor was headed when the gate sent them here.
  const onSuccess = useCallback(async (): Promise<void> => {
    await refresh();
    router.replace(sanitizeReturnTo(returnTo) ?? "/");
  }, [refresh, returnTo, router]);

  const handleEmailLogin = useCallback(async (): Promise<void> => {
    setError(undefined);
    setIsSubmitting(true);
    try {
      const result = await authClient.signIn.email({email, password});
      if (result.error) {
        setError(result.error.message ?? "Sign in failed.");
        return;
      }
      await onSuccess();
    } catch (err) {
      console.error("Login: email sign-in failed", err);
      setError("Sign in failed. Please try again.");
    } finally {
      setIsSubmitting(false);
    }
  }, [authClient, email, password, onSuccess]);

  const handleSocialLogin = useCallback(
    async (provider: SocialProvider): Promise<void> => {
      setError(undefined);
      try {
        await authClient.signIn.social({callbackURL: window.location.href, provider});
      } catch (err) {
        console.error(`Login: ${provider} sign-in failed`, err);
        setError("Sign in failed. Please try again.");
      }
    },
    [authClient]
  );

  const socialProviders = appConfig.providers.filter(
    (provider): provider is SocialProvider => provider !== "email"
  );
  const showEmail = appConfig.providers.includes("email");

  return (
    <Box alignItems="center" color="base" flex="grow" justifyContent="center" padding={6}>
      <Box gap={5} maxWidth={400} width="100%">
        <Heading align="center" size="lg">
          {brandName}
        </Heading>
        {error ? (
          <Text color="error" testID="admin-spa-login-error">
            {error}
          </Text>
        ) : null}
        {showEmail ? (
          <Box gap={3}>
            <TextField
              onChange={setEmail}
              placeholder="you@example.com"
              testID="admin-spa-login-email"
              title="Email"
              type="email"
              value={email}
            />
            <TextField
              onChange={setPassword}
              testID="admin-spa-login-password"
              title="Password"
              type="password"
              value={password}
            />
            <Button
              fullWidth
              loading={isSubmitting}
              onClick={handleEmailLogin}
              testID="admin-spa-login-submit"
              text="Sign in"
              variant="primary"
            />
          </Box>
        ) : null}
        {socialProviders.length > 0 ? (
          <Box gap={2}>
            {socialProviders.map((provider) => (
              <SocialLoginButton
                key={provider}
                onPress={() => handleSocialLogin(provider)}
                provider={provider}
                testID={`admin-spa-login-${provider}`}
              />
            ))}
          </Box>
        ) : null}
      </Box>
    </Box>
  );
};

export default LoginScreen;
