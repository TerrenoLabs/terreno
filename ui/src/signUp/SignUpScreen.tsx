import type {FC} from "react";
import {useCallback, useState} from "react";

import {Box} from "../Box";
import {Button} from "../Button";
import {Heading} from "../Heading";
import {Page} from "../Page";
import {Text} from "../Text";
import {TextField} from "../TextField";
import {OAuthButtons} from "./OAuthButtons";
import {PasswordRequirements} from "./PasswordRequirements";
import {Swiper} from "./Swiper";
import type {SignUpScreenProps} from "./signUpTypes";

/**
 * A configurable sign-up screen component with support for custom fields,
 * password requirements, OAuth providers, and onboarding pages.
 *
 * @example
 * ```tsx
 * <SignUpScreen
 *   fields={[
 *     {name: "name", label: "Name", type: "text", required: true},
 *     {name: "email", label: "Email", type: "email", required: true},
 *     {name: "password", label: "Password", type: "password", required: true},
 *   ]}
 *   onSubmit={async (values) => {
 *     await signUp(values.email, values.password, values.name);
 *   }}
 *   passwordRequirements={defaultPasswordRequirements}
 *   oauthProviders={[
 *     {provider: "google", onPress: () => signInWithSocial("google")},
 *   ]}
 *   onLoginPress={() => router.push("/login")}
 * />
 * ```
 */
export const SignUpScreen: FC<SignUpScreenProps> = ({
  fields,
  onSubmit,
  oauthProviders,
  passwordRequirements,
  onboardingPages,
  logo,
  title = "Create Account",
  loading = false,
  error,
  loginLinkText = "Already have an account? Log in",
  onLoginPress,
  testID = "signup-screen",
}) => {
  const [formValues, setFormValues] = useState<Record<string, string>>(() => {
    const initial: Record<string, string> = {};
    for (const field of fields) {
      initial[field.name] = "";
    }
    return initial;
  });

  const handleFieldChange = useCallback((fieldName: string, value: string) => {
    setFormValues((prev) => ({...prev, [fieldName]: value}));
  }, []);

  const handleSubmit = useCallback(async () => {
    await onSubmit(formValues);
  }, [formValues, onSubmit]);

  const passwordField = fields.find((f) => f.type === "password");
  const passwordValue = passwordField ? (formValues[passwordField.name] ?? "") : "";

  const allRequirementsMet =
    !passwordRequirements ||
    passwordRequirements.length === 0 ||
    passwordRequirements.every((req) => req.validate(passwordValue));

  const requiredFieldsFilled = fields
    .filter((f) => f.required)
    .every((f) => (formValues[f.name] ?? "").trim().length > 0);

  const isSubmitDisabled = loading || !requiredFieldsFilled || !allRequirementsMet;

  return (
    <Page navigation={undefined}>
      <Box
        alignItems="center"
        alignSelf="center"
        flex="grow"
        justifyContent="center"
        maxWidth={400}
        padding={4}
        testID={testID}
        width="100%"
      >
        {Boolean(onboardingPages && onboardingPages.length > 0) && (
          <Box marginBottom={6}>
            <Swiper pages={onboardingPages!} testID={`${testID}-swiper`} />
          </Box>
        )}

        {Boolean(logo) && <Box marginBottom={6}>{logo}</Box>}

        <Box marginBottom={8}>
          <Heading testID={`${testID}-title`}>{title}</Heading>
        </Box>

        <Box gap={4} width="100%">
          {fields.map((field) => (
            <TextField
              autoComplete={
                field.autoComplete ?? (field.type === "password" ? "new-password" : undefined)
              }
              disabled={loading}
              id={`${testID}-${field.name}-input`}
              key={field.name}
              onChange={(value: string) => handleFieldChange(field.name, value)}
              placeholder={field.placeholder ?? field.label}
              testID={`${testID}-${field.name}-input`}
              title={field.label}
              type={
                field.type === "email" ? "email" : field.type === "password" ? "password" : "text"
              }
              value={formValues[field.name]}
            />
          ))}

          {Boolean(passwordRequirements && passwordRequirements.length > 0 && passwordField) && (
            <PasswordRequirements
              password={passwordValue}
              requirements={passwordRequirements!}
              testID={`${testID}-password-requirements`}
            />
          )}

          {Boolean(error) && (
            <Text color="error" testID={`${testID}-error`}>
              {error}
            </Text>
          )}

          <Box marginTop={4}>
            <Button
              disabled={isSubmitDisabled}
              fullWidth
              loading={loading}
              onClick={handleSubmit}
              testID={`${testID}-submit-button`}
              text="Sign Up"
            />
          </Box>

          {Boolean(onLoginPress) && (
            <Box marginTop={2}>
              <Button
                disabled={loading}
                fullWidth
                onClick={onLoginPress!}
                testID={`${testID}-login-link`}
                text={loginLinkText!}
                variant="outline"
              />
            </Box>
          )}

          {Boolean(oauthProviders && oauthProviders.length > 0) && (
            <OAuthButtons
              disabled={loading}
              providers={oauthProviders!}
              testID={`${testID}-oauth`}
            />
          )}
        </Box>
      </Box>
    </Page>
  );
};
