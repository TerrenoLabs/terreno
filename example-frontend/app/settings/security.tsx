import {TerrenoAccountSecurityScreen} from "@terreno/rtk";
import {Box, Button} from "@terreno/ui";
import {useLocalSearchParams, useRouter} from "expo-router";
import type React from "react";
import {useCallback, useMemo} from "react";
import {betterAuthClient, getSecurityCallbackURL, OAUTH_PROVIDER_LABELS} from "@/lib/betterAuth";

/**
 * The signed-in user's security settings: linked sign-in providers, password, passkeys,
 * two-factor authentication and sessions. `TerrenoAccountSecurityScreen` from @terreno/rtk shows
 * each card only when the server's `/terreno/methods` turns its feature on. Linking a provider
 * leaves for the provider and returns here; a failed link returns with `?error=`, which the
 * screen maps to guidance and never shows as is.
 */
const SecurityScreen: React.FC = () => {
  const router = useRouter();
  const {error} = useLocalSearchParams<{error?: string}>();
  const callbackURL = useMemo((): string => getSecurityCallbackURL(), []);

  // A link that returned from the provider opened this page fresh, with nothing to go back to.
  const handleBack = useCallback((): void => {
    if (router.canGoBack()) {
      router.back();
      return;
    }
    router.replace("/(tabs)/profile");
  }, [router]);

  return (
    <TerrenoAccountSecurityScreen
      callbackURL={callbackURL}
      client={betterAuthClient}
      header={
        <Box alignItems="start">
          <Button
            iconName="arrow-left"
            onClick={handleBack}
            testID="security-screen-back-button"
            text="Back to profile"
            variant="ghost"
          />
        </Box>
      }
      linkError={error}
      providerLabels={OAUTH_PROVIDER_LABELS}
      testID="security-screen"
    />
  );
};

export default SecurityScreen;
