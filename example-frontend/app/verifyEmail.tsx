import {useApiClient} from "@terreno/syncdb/react";
import {Box, Button, Heading, Page, Text} from "@terreno/ui";
import {useLocalSearchParams, useRouter} from "expo-router";
import type React from "react";
import {useCallback, useMemo, useState} from "react";
import {submitEmailVerification} from "@/lib/authRecoveryActions";
import {parseAuthTokenFromRouteParam} from "@/lib/authRecoveryParams";
import {verifyEmailWithToken} from "@/lib/betterAuth";
import {usePostAuthVerifyEmailMutation} from "@/store/apiSdk";

const VerifyEmailScreen: React.FC = () => {
  const router = useRouter();
  const params = useLocalSearchParams<{token?: string | string[]}>();
  const token = useMemo(
    (): string | undefined => parseAuthTokenFromRouteParam(params.token),
    [params.token]
  );
  const [errorMessage, setErrorMessage] = useState<string | undefined>(undefined);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [isComplete, setIsComplete] = useState(false);
  const [verifyEmail] = usePostAuthVerifyEmailMutation();
  const apiClient = useApiClient();

  const handleVerify = useCallback(async (): Promise<void> => {
    setIsSubmitting(true);
    try {
      const result = await submitEmailVerification({
        token,
        verifyEmailWithToken,
        verifyJwtEmail: async (verifyToken) => {
          await verifyEmail({token: verifyToken}).unwrap();
        },
      });
      if (result.errorMessage) {
        setErrorMessage(result.errorMessage);
        return;
      }
      setErrorMessage(undefined);
      setIsComplete(true);
      // The Better Auth path never touches the request client, so refresh the cached profile.
      apiClient.invalidateTags(["auth"]);
    } finally {
      setIsSubmitting(false);
    }
  }, [apiClient, token, verifyEmail]);

  const handleBackToLogin = useCallback((): void => {
    router.replace("/login");
  }, [router]);

  return (
    <Page backButton navigation={undefined} scroll title="Verify email">
      <Box gap={4} padding={4} testID="verify-email-screen">
        {isComplete ? (
          <>
            <Heading size="lg">Email verified</Heading>
            <Text testID="verify-email-success">Your email address is confirmed.</Text>
            <Button
              onClick={handleBackToLogin}
              testID="verify-email-back-to-login"
              text="Back to login"
            />
          </>
        ) : (
          <>
            {!token ? (
              <Text color="error" testID="verify-email-missing-token">
                This verification link is missing a token. Request a new email from your profile.
              </Text>
            ) : (
              <Text>Tap confirm to finish verifying this email address.</Text>
            )}
            {errorMessage ? (
              <Text color="error" testID="verify-email-error">
                {errorMessage}
              </Text>
            ) : null}
            <Button
              disabled={!token}
              loading={isSubmitting}
              onClick={handleVerify}
              testID="verify-email-submit"
              text="Confirm email"
            />
            <Button
              onClick={handleBackToLogin}
              testID="verify-email-login-link"
              text="Back to login"
              variant="ghost"
            />
          </>
        )}
      </Box>
    </Page>
  );
};

export default VerifyEmailScreen;
