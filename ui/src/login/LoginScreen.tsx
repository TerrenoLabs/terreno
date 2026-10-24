import type {FC, ReactElement} from "react";
import {useCallback, useEffect, useRef, useState} from "react";
import {Platform, View} from "react-native";

import {Box} from "../Box";
import {Button} from "../Button";
import type {TextFieldProps} from "../Common";
import {Heading} from "../Heading";
import {Icon} from "../Icon";
import {Page} from "../Page";
import {OAuthButtons} from "../signUp/OAuthButtons";
import {Text} from "../Text";
import {TextField} from "../TextField";
import {LastUsedBadge} from "./LastUsedBadge";
import {LoginAccountCard} from "./LoginAccountCard";
import {getLoginMethodLabels, withLastUsedLabel} from "./loginMethods";
import type {LoginFieldConfig, LoginNotice, LoginScreenProps} from "./loginTypes";

const DEFAULT_LAST_USED_LABEL = "Last used";

const isEmailField = (field: LoginFieldConfig): boolean => {
  return field.type === "email" || field.name === "email";
};

/**
 * The autofill hint for a field: passkey autofill on a web email field, else the field's own hint,
 * else "current-password" for password fields.
 */
const getFieldAutoComplete = ({
  field,
  passkeyAutofill,
}: {
  field: LoginFieldConfig;
  passkeyAutofill: boolean;
}): TextFieldProps["autoComplete"] => {
  if (passkeyAutofill && Platform.OS === "web" && isEmailField(field)) {
    return "username webauthn";
  }
  if (field.autoComplete) {
    return field.autoComplete;
  }
  return field.type === "password" ? "current-password" : undefined;
};

/** Centered text that separates one group of sign-in methods from the next. */
const MethodDivider: FC<{text: string}> = ({text}) => {
  return (
    <Box alignItems="center" marginTop={4}>
      <Text color="secondaryLight">{text}</Text>
    </Box>
  );
};

const NoticeBox: FC<{notice: LoginNotice; testID: string}> = ({notice, testID}) => {
  const isWarning = notice.tone === "warning";
  // A warning is an alert so screen readers announce it at once; info is a polite status.
  return (
    <View role={isWarning ? "alert" : "status"} style={{width: "100%"}} testID={testID}>
      <Box
        border={isWarning ? "warning" : "default"}
        color={isWarning ? "warningLight" : "secondaryExtraLight"}
        gap={2}
        padding={3}
        rounding="md"
        width="100%"
      >
        <Box alignItems="start" direction="row" gap={2}>
          <Icon
            color={isWarning ? "warning" : "secondaryDark"}
            iconName={isWarning ? "triangle-exclamation" : "circle-info"}
          />
          <Box flex="shrink">
            <Text>{notice.text}</Text>
          </Box>
        </Box>
        {Boolean(notice.actionLabel && notice.onAction) && (
          <Box alignItems="start">
            <Button
              onClick={notice.onAction!}
              testID={`${testID}-action`}
              text={notice.actionLabel!}
              variant="outline"
            />
          </Box>
        )}
      </Box>
    </View>
  );
};

/**
 * A configurable login screen component with support for custom fields,
 * OAuth providers, passkeys, "Continue as" cards, a last-used method badge,
 * sign-up link, and forgot password link. It is presentational: it renders the
 * methods and accounts it is given and reports presses through callbacks.
 *
 * @example
 * ```tsx
 * <LoginScreen
 *   fields={[
 *     {name: "email", label: "Email", type: "email", required: true},
 *     {name: "password", label: "Password", type: "password", required: true},
 *   ]}
 *   onSubmit={async (values) => {
 *     await signIn(values.email, values.password);
 *   }}
 *   oauthProviders={[
 *     {provider: "google", onPress: () => signInWithSocial("google")},
 *   ]}
 *   genericProviders={[
 *     {id: "mock-oidc", label: "Mock OIDC", onPress: () => signInWithSocial("mock-oidc")},
 *   ]}
 *   lastUsedMethod="google"
 *   onPasskeyPress={signInWithPasskey}
 *   passkeyAutofill
 *   onSignUpPress={() => router.push("/signup")}
 *   onForgotPasswordPress={() => router.push("/forgot-password")}
 * />
 * ```
 */
export const LoginScreen: FC<LoginScreenProps> = ({
  fields,
  onSubmit,
  oauthProviders,
  genericProviders,
  logo,
  title = "Welcome Back",
  loading = false,
  error,
  signUpLinkText = "Need an account? Sign Up",
  onSignUpPress,
  forgotPasswordText = "Forgot password?",
  onForgotPasswordPress,
  onForgotPassword,
  lastUsedMethod,
  lastUsedLabel = DEFAULT_LAST_USED_LABEL,
  currentSessions,
  rememberedAccounts,
  onContinue,
  onForget,
  onPasskeyPress,
  passkeyButtonText = "Sign in with a passkey",
  passkeyAutofill = false,
  notice,
  initialValues,
  testID = "login-screen",
}) => {
  const [formValues, setFormValues] = useState<Record<string, string>>(() => {
    const initial: Record<string, string> = {};
    for (const field of fields) {
      initial[field.name] = initialValues?.[field.name] ?? "";
    }
    return initial;
  });

  // Applies a new initialValues object over the form; the first render already used it.
  const appliedInitialValues = useRef(initialValues);
  useEffect(() => {
    if (!initialValues || appliedInitialValues.current === initialValues) {
      return;
    }
    appliedInitialValues.current = initialValues;
    setFormValues((prev) => ({...prev, ...initialValues}));
  }, [initialValues]);

  const onForgotPasswordAction = onForgotPasswordPress ?? onForgotPassword;

  const handleFieldChange = useCallback((fieldName: string, value: string) => {
    setFormValues((prev) => ({...prev, [fieldName]: value}));
  }, []);

  const handleSubmit = useCallback(async () => {
    await onSubmit(formValues);
  }, [formValues, onSubmit]);

  const handlePasskeyPress = useCallback(async (): Promise<void> => {
    await onPasskeyPress?.();
  }, [onPasskeyPress]);

  const requiredFieldsFilled = fields
    .filter((f) => f.required)
    .every((f) => (formValues[f.name] ?? "").trim().length > 0);

  const isSubmitDisabled = loading || !requiredFieldsFilled;

  const brandedProviders = oauthProviders ?? [];
  const otherProviders = genericProviders ?? [];
  const hasProviders = brandedProviders.length > 0 || otherProviders.length > 0;
  const isProviderLastUsed =
    Boolean(lastUsedMethod) &&
    (brandedProviders.some((config) => config.provider === lastUsedMethod) ||
      otherProviders.some((config) => config.id === lastUsedMethod));
  const isPasskeyLastUsed = lastUsedMethod === "passkey" && Boolean(onPasskeyPress);
  const isEmailLastUsed = lastUsedMethod === "email";

  const accountCards: ReactElement[] = [];
  if (onContinue) {
    const accounts = [
      ...(currentSessions ?? []).map((account) => ({account, source: "session" as const})),
      ...(rememberedAccounts ?? []).map((account) => ({account, source: "remembered" as const})),
    ];
    accounts.forEach(({account, source}, index) => {
      accountCards.push(
        <LoginAccountCard
          account={account}
          continueTestID={`${testID}-continue-${index}`}
          disabled={loading}
          forgetTestID={`${testID}-forget-${index}`}
          key={`${source}-${account.id}`}
          method={getLoginMethodLabels({
            genericProviders: otherProviders,
            method: account.method,
          })}
          onContinue={onContinue}
          onForget={source === "remembered" ? onForget : undefined}
          source={source}
        />
      );
    });
  }

  // "alone" is a screen without a form, where nothing needs dividing from the providers.
  const renderProviders = (placement: "above" | "below" | "alone"): ReactElement => (
    <OAuthButtons
      disabled={loading}
      dividerPosition={placement === "above" ? "below" : placement === "below" ? "above" : "none"}
      dividerText={placement === "above" ? "Or log in with email" : undefined}
      genericProviders={otherProviders}
      lastUsed={
        isProviderLastUsed
          ? {
              label: lastUsedLabel,
              provider: lastUsedMethod!,
              testID: `${testID}-last-used-${lastUsedMethod}`,
            }
          : undefined
      }
      providers={brandedProviders}
      testID={`${testID}-oauth`}
    />
  );

  const renderPasskeyButton = (): ReactElement => (
    <Box width="100%">
      {isPasskeyLastUsed && (
        <LastUsedBadge label={lastUsedLabel} testID={`${testID}-last-used-passkey`} />
      )}
      <Button
        accessibilityLabel={
          isPasskeyLastUsed
            ? withLastUsedLabel({label: passkeyButtonText, lastUsedLabel})
            : undefined
        }
        disabled={loading}
        fullWidth
        iconName="key"
        onClick={handlePasskeyPress}
        testID={`${testID}-passkey-button`}
        text={passkeyButtonText}
        variant="outline"
      />
    </Box>
  );

  // The passkey button below the form needs its own divider when no provider list above it
  // already draws one.
  const isPasskeyBelow = Boolean(onPasskeyPress) && !isPasskeyLastUsed;
  const areProvidersBelow = hasProviders && !isProviderLastUsed;
  // Without fields (the server has email and password off) the whole form block is left out.
  const hasForm = fields.length > 0;

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
        {Boolean(logo) && <Box marginBottom={6}>{logo}</Box>}

        <Box marginBottom={8}>
          <Heading testID={`${testID}-title`}>{title}</Heading>
        </Box>

        <Box gap={4} width="100%">
          {Boolean(notice) && <NoticeBox notice={notice!} testID={`${testID}-notice`} />}

          {accountCards.length > 0 && (
            <Box gap={2} testID={`${testID}-accounts`} width="100%">
              {accountCards}
              <MethodDivider text="Or sign in another way" />
            </Box>
          )}

          {isPasskeyLastUsed && (
            <Box width="100%">
              {renderPasskeyButton()}
              {hasForm && <MethodDivider text="Or log in with email" />}
            </Box>
          )}

          {hasForm && isProviderLastUsed && renderProviders("above")}

          {!hasForm && hasProviders && renderProviders("alone")}

          {!hasForm && isPasskeyBelow && renderPasskeyButton()}

          {hasForm && isEmailLastUsed && (
            <LastUsedBadge label={lastUsedLabel} testID={`${testID}-last-used-email`} />
          )}

          {fields.map((field) => (
            <TextField
              accessibilityLabel={field.label}
              autoComplete={getFieldAutoComplete({field, passkeyAutofill})}
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

          {Boolean(error) && (
            <Text color="error" testID={`${testID}-error`}>
              {error}
            </Text>
          )}

          {hasForm && (
            <Box marginTop={4}>
              <Button
                accessibilityLabel={
                  isEmailLastUsed ? withLastUsedLabel({label: "Log In", lastUsedLabel}) : undefined
                }
                disabled={isSubmitDisabled}
                fullWidth
                loading={loading}
                onClick={handleSubmit}
                testID={`${testID}-submit-button`}
                text="Log In"
              />
            </Box>
          )}

          {hasForm && Boolean(onForgotPasswordAction) && (
            <Box alignItems="center" marginTop={2}>
              <Button
                disabled={loading}
                onClick={onForgotPasswordAction!}
                testID={`${testID}-forgot-password`}
                text={forgotPasswordText!}
                variant="muted"
              />
            </Box>
          )}

          {Boolean(onSignUpPress) && (
            <Box marginTop={2}>
              <Button
                disabled={loading}
                fullWidth
                onClick={onSignUpPress!}
                testID={`${testID}-signup-link`}
                text={signUpLinkText!}
                variant="outline"
              />
            </Box>
          )}

          {hasForm && areProvidersBelow && renderProviders("below")}

          {hasForm && isPasskeyBelow && !areProvidersBelow && (
            <MethodDivider text="Or continue with" />
          )}

          {hasForm && isPasskeyBelow && renderPasskeyButton()}
        </Box>
      </Box>
    </Page>
  );
};
