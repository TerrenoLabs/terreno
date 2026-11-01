import {Box, Button, FormContainer, Heading, Page, Text, TextField} from "@terreno/ui";
import {useLocalSearchParams, useRouter} from "expo-router";
import type React from "react";
import {useCallback, useMemo, useState} from "react";
import {submitPasswordReset} from "@/lib/authRecoveryActions";
import {parseAuthTokenFromRouteParam} from "@/lib/authRecoveryParams";
import {resetPasswordWithToken} from "@/lib/betterAuth";
import {useResetPasswordMutation} from "@/store/sdk";

const ResetPasswordScreen: React.FC = () => {
  const router = useRouter();
  const params = useLocalSearchParams<{token?: string | string[]}>();
  const token = useMemo(
    (): string | undefined => parseAuthTokenFromRouteParam(params.token),
    [params.token]
  );
  const [password, setPassword] = useState<string>("");
  const [errorMessage, setErrorMessage] = useState<string | undefined>(undefined);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [isComplete, setIsComplete] = useState(false);
  const [resetPassword] = useResetPasswordMutation();

  const canSubmit = Boolean(token) && password.length >= 6;

  const handleSubmit = useCallback(async (): Promise<void> => {
    if (!canSubmit || isSubmitting) {
      return;
    }
    setIsSubmitting(true);
    try {
      const result = await submitPasswordReset({
        password,
        resetJwtPassword: async ({password: nextPassword, token: resetToken}) => {
          await resetPassword({email: "", password: nextPassword, token: resetToken}).unwrap();
        },
        resetPasswordWithToken,
        token,
      });
      if (result.errorMessage) {
        setErrorMessage(result.errorMessage);
        return;
      }
      setErrorMessage(undefined);
      setIsComplete(true);
    } finally {
      setIsSubmitting(false);
    }
  }, [canSubmit, isSubmitting, password, resetPassword, token]);

  const handleBackToLogin = useCallback((): void => {
    router.replace("/login");
  }, [router]);

  return (
    <Page backButton navigation={undefined} scroll title="Reset password">
      <Box gap={4} padding={4} testID="reset-password-screen">
        {isComplete ? (
          <>
            <Heading size="lg">Password updated</Heading>
            <Text testID="reset-password-success">You can sign in with your new password.</Text>
            <Button
              onClick={handleBackToLogin}
              testID="reset-password-back-to-login"
              text="Back to login"
            />
          </>
        ) : (
          <FormContainer gap={4} onSubmit={handleSubmit} testID="reset-password-form">
            {!token ? (
              <Text color="error" testID="reset-password-missing-token">
                This reset link is missing a token. Request a new email from the login page.
              </Text>
            ) : null}
            <TextField
              accessibilityLabel="New password"
              autoComplete="new-password"
              onChange={setPassword}
              onEnter={handleSubmit}
              returnKeyType="go"
              testID="reset-password-password"
              title="New password"
              type="password"
              value={password}
            />
            {errorMessage ? (
              <Text color="error" testID="reset-password-error">
                {errorMessage}
              </Text>
            ) : null}
            <Button
              disabled={!canSubmit}
              loading={isSubmitting}
              onClick={handleSubmit}
              testID="reset-password-submit"
              text="Save new password"
            />
            <Button
              onClick={handleBackToLogin}
              testID="reset-password-login-link"
              text="Back to login"
              variant="ghost"
            />
          </FormContainer>
        )}
      </Box>
    </Page>
  );
};

export default ResetPasswordScreen;
