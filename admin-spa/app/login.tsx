import {useSession} from "@terreno/syncdb/auth";
import {Box, Button, Heading, SocialLoginButton, Text, TextField} from "@terreno/ui";
import {useRouter} from "expo-router";
import React, {useCallback, useState} from "react";
import {useAppConfig} from "../components/AppConfigGate";
import {useAuthClient} from "../components/StoreProvider";

type SocialProvider = "google" | "github" | "apple";

const LoginScreen: React.FC = () => {
  const router = useRouter();
  const {appConfig} = useAppConfig();
  const authClient = useAuthClient();
  const {refresh} = useSession();

  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | undefined>(undefined);
  const [isSubmitting, setIsSubmitting] = useState(false);

  // Resolve the new session now rather than waiting for Better Auth's session signal.
  const onSuccess = useCallback(async (): Promise<void> => {
    await refresh();
    router.replace("/");
  }, [refresh, router]);

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
          {appConfig.brandName}
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
