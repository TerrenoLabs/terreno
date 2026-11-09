import {Box, Button, Heading, Page, Text, TextField} from "@terreno/ui";
import {useRouter} from "expo-router";
import type React from "react";
import {useCallback, useState} from "react";
import {submitPasswordResetRequest} from "@/lib/authRecoveryActions";
import {requestPasswordReset} from "@/lib/betterAuth";
import {usePostAuthForgotPasswordMutation} from "@/store/apiSdk";

const ForgotPasswordScreen: React.FC = () => {
  const router = useRouter();
  const [email, setEmail] = useState<string>("");
  const [errorMessage, setErrorMessage] = useState<string | undefined>(undefined);
  const [isSubmitted, setIsSubmitted] = useState(false);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [requestJwtPasswordReset] = usePostAuthForgotPasswordMutation();

  const handleSubmit = useCallback(async (): Promise<void> => {
    setIsSubmitting(true);
    try {
      const result = await submitPasswordResetRequest({
        email,
        requestJwtPasswordReset: async (trimmedEmail) => {
          await requestJwtPasswordReset({email: trimmedEmail}).unwrap();
        },
        requestPasswordReset,
      });
      if (result.errorMessage) {
        setErrorMessage(result.errorMessage);
        return;
      }
      setErrorMessage(undefined);
      setIsSubmitted(true);
    } finally {
      setIsSubmitting(false);
    }
  }, [email, requestJwtPasswordReset]);

  const handleBackToLogin = useCallback((): void => {
    router.replace("/login");
  }, [router]);

  return (
    <Page backButton navigation={undefined} scroll title="Forgot password">
      <Box gap={4} padding={4} testID="forgot-password-screen">
        {isSubmitted ? (
          <>
            <Heading size="lg">Check your email</Heading>
            <Text testID="forgot-password-sent">
              If an account exists for that address, we sent a reset link. Check your inbox (and
              spam) or the server console in development.
            </Text>
            <Button
              onClick={handleBackToLogin}
              testID="forgot-password-back-to-login"
              text="Back to login"
              variant="secondary"
            />
          </>
        ) : (
          <>
            <Text>
              Enter your email and we will send a link to choose a new password. The confirmation is
              the same whether or not the account exists.
            </Text>
            <TextField
              autoComplete="email"
              onChange={setEmail}
              testID="forgot-password-email"
              title="Email"
              type="email"
              value={email}
            />
            {errorMessage ? (
              <Text color="error" testID="forgot-password-error">
                {errorMessage}
              </Text>
            ) : null}
            <Button
              disabled={!email.trim()}
              loading={isSubmitting}
              onClick={handleSubmit}
              testID="forgot-password-submit"
              text="Send reset link"
            />
          </>
        )}
      </Box>
    </Page>
  );
};

export default ForgotPasswordScreen;
