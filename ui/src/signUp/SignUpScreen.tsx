import type {FC} from "react";
import {memo, useCallback, useRef, useState} from "react";
import type {TextInputInstance} from "react-native";

import {Box} from "../Box";
import {Button} from "../Button";
import type {TextFieldProps} from "../Common";
import {FormContainer, type FormContainerHandle} from "../FormContainer";
import {Heading} from "../Heading";
import {Page} from "../Page";
import {Text} from "../Text";
import {TextField} from "../TextField";
import {OAuthButtons} from "./OAuthButtons";
import {PasswordRequirements} from "./PasswordRequirements";
import {Swiper} from "./Swiper";
import type {SignUpFieldConfig, SignUpScreenProps} from "./signUpTypes";

/**
 * The autofill hint for a field: its own hint, else "username" for the email field (password
 * managers save it with the new password) and "new-password" for password fields (browsers and
 * iOS then offer a strong password).
 */
const getFieldAutoComplete = (field: SignUpFieldConfig): TextFieldProps["autoComplete"] => {
  if (field.autoComplete) {
    return field.autoComplete;
  }
  if (field.type === "email" || field.name === "email") {
    return "username";
  }
  return field.type === "password" ? "new-password" : undefined;
};

interface SignUpFieldProps {
  field: SignUpFieldConfig;
  /** The field Enter moves to; undefined on the last field, where Enter submits. */
  nextFieldName?: string;
  disabled: boolean;
  value: string;
  /** The screen's testID. */
  testID: string;
  onChange: (fieldName: string, value: string) => void;
  onFocusField: (fieldName: string) => void;
  /** Passed to the last field only. */
  onRequestSubmit?: () => void | Promise<void>;
  onInputRef: (fieldName: string, ref: TextInputInstance | null) => void;
}

// Memoized so typing in one field re-renders that field, not every field in the form.
const SignUpField: FC<SignUpFieldProps> = memo(
  ({
    field,
    nextFieldName,
    disabled,
    value,
    testID,
    onChange,
    onFocusField,
    onRequestSubmit,
    onInputRef,
  }) => {
    const {name} = field;
    const handleChange = useCallback(
      (newValue: string): void => {
        onChange(name, newValue);
      },
      [name, onChange]
    );
    const handleInputRef = useCallback(
      (ref: TextInputInstance | null): void => {
        onInputRef(name, ref);
      },
      [name, onInputRef]
    );
    const handleFocusNext = useCallback((): void => {
      if (nextFieldName !== undefined) {
        onFocusField(nextFieldName);
      }
    }, [nextFieldName, onFocusField]);
    const hasNextField = nextFieldName !== undefined;

    return (
      <TextField
        accessibilityLabel={field.label}
        autoComplete={getFieldAutoComplete(field)}
        blurOnSubmit={!hasNextField}
        disabled={disabled}
        id={`${testID}-${name}-input`}
        inputRef={handleInputRef}
        onChange={handleChange}
        onEnter={hasNextField ? handleFocusNext : onRequestSubmit}
        placeholder={field.placeholder ?? field.label}
        returnKeyType={hasNextField ? "next" : "go"}
        testID={`${testID}-${name}-input`}
        title={field.label}
        type={field.type === "email" ? "email" : field.type === "password" ? "password" : "text"}
        value={value}
      />
    );
  }
);
SignUpField.displayName = "SignUpField";

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

  const handleFieldChange = useCallback((fieldName: string, value: string): void => {
    setFormValues((prev) => ({...prev, [fieldName]: value}));
  }, []);

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

  const formRef = useRef<FormContainerHandle>(null);
  const inputRefs = useRef<Record<string, TextInputInstance | null>>({});
  // Blocks a second submission (Enter plus a press, or a double Enter) before `loading` lands.
  const isSubmittingRef = useRef(false);

  // Every submission (Enter, the Sign Up button, or the browser) arrives here through the form.
  const handleSubmit = useCallback(async (): Promise<void> => {
    if (isSubmitDisabled || isSubmittingRef.current) {
      return;
    }
    isSubmittingRef.current = true;
    try {
      await onSubmit(formValues);
    } finally {
      isSubmittingRef.current = false;
    }
  }, [formValues, isSubmitDisabled, onSubmit]);

  // On web this goes through the <form>, so password managers see a real submit.
  const requestSubmit = useCallback(async (): Promise<void> => {
    if (isSubmitDisabled) {
      return;
    }
    await formRef.current?.requestSubmit();
  }, [isSubmitDisabled]);

  const focusField = useCallback((fieldName: string): void => {
    inputRefs.current[fieldName]?.focus();
  }, []);

  const handleInputRef = useCallback((fieldName: string, ref: TextInputInstance | null): void => {
    inputRefs.current[fieldName] = ref;
  }, []);

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

        <FormContainer
          accessibilityLabel={title}
          gap={4}
          onSubmit={handleSubmit}
          ref={formRef}
          testID={`${testID}-form`}
          width="100%"
        >
          {fields.map((field, index) => {
            // Enter moves to the next field; in the last field it submits.
            const nextField = fields[index + 1];
            return (
              <SignUpField
                disabled={loading}
                field={field}
                key={field.name}
                nextFieldName={nextField?.name}
                onChange={handleFieldChange}
                onFocusField={focusField}
                onInputRef={handleInputRef}
                onRequestSubmit={nextField ? undefined : requestSubmit}
                testID={testID}
                value={formValues[field.name]}
              />
            );
          })}

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
              onClick={requestSubmit}
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
        </FormContainer>
      </Box>
    </Page>
  );
};
