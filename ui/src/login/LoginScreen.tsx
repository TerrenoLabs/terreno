import type {FC, ReactElement, ReactNode} from "react";
import {useCallback, useEffect, useRef, useState} from "react";
import {Platform, Pressable, type TextInputInstance, View} from "react-native";

import {Avatar} from "../Avatar";
import {Box} from "../Box";
import {Button} from "../Button";
import type {IconName, TextFieldProps} from "../Common";
import {FormContainer, type FormContainerHandle} from "../FormContainer";
import {Heading} from "../Heading";
import {Icon} from "../Icon";
import {Page} from "../Page";
import {OAuthButtons} from "../signUp/OAuthButtons";
import {Text} from "../Text";
import {TextField} from "../TextField";
import {useTheme} from "../Theme";
import {LastUsedPill} from "./LastUsedBadge";
import {LoginAccountList} from "./LoginAccountList";
import {getLoginMethodLabels, withLastUsedLabel} from "./loginMethods";
import type {
  LoginAccountOption,
  LoginFieldConfig,
  LoginNotice,
  LoginScreenProps,
} from "./loginTypes";
import {OutlinePill} from "./OutlinePill";

const DEFAULT_LAST_USED_LABEL = "Last used";
const DEFAULT_SIGN_UP_LINK = "Create an account";
const DEFAULT_FORGOT_PASSWORD = "Forgot password?";

const isEmailField = (field: LoginFieldConfig): boolean => {
  return field.type === "email" || field.name === "email";
};

const isPasswordField = (field: LoginFieldConfig): boolean => {
  return field.type === "password" || field.name === "password";
};

/**
 * The autofill hint for a field: passkey autofill on a web email field, else the field's own hint,
 * else "username" for the email field and "current-password" for password fields, so password
 * managers pair the two.
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
  if (isEmailField(field)) {
    return "username";
  }
  return field.type === "password" ? "current-password" : undefined;
};

/** A labelled rule between two groups of sign-in methods. */
const MethodDivider: FC<{text: string}> = ({text}) => {
  const {theme} = useTheme();
  if (!theme) {
    return null;
  }
  return (
    <View style={{alignItems: "center", flexDirection: "row", gap: 12, width: "100%"}}>
      <View style={{backgroundColor: theme.border.default, flex: 1, height: 1}} />
      <Text color="secondaryLight" size="sm">
        {text}
      </Text>
      <View style={{backgroundColor: theme.border.default, flex: 1, height: 1}} />
    </View>
  );
};

const TextLink: FC<{
  text: string;
  onPress: () => void;
  testID: string;
  disabled?: boolean;
  color?: "link" | "secondaryLight";
}> = ({text, onPress, testID, disabled = false, color = "link"}) => {
  return (
    <Pressable
      accessibilityRole="link"
      accessibilityState={{disabled}}
      disabled={disabled}
      onPress={onPress}
      testID={testID}
    >
      <Text bold color={color} size="sm">
        {text}
      </Text>
    </Pressable>
  );
};

const NoticeBox: FC<{
  notice: LoginNotice;
  onAction: () => void;
  onDismiss?: () => void;
  testID: string;
}> = ({notice, onAction, onDismiss, testID}) => {
  const {theme} = useTheme();
  if (!theme) {
    return null;
  }
  const tone = notice.tone;
  const isInfo = tone === "info";
  const fill =
    tone === "error"
      ? theme.surface.errorLight
      : tone === "warning"
        ? theme.surface.warningLight
        : theme.surface.secondaryExtraLight;
  const border =
    tone === "error"
      ? theme.border.error
      : tone === "warning"
        ? theme.border.warning
        : theme.surface.secondaryLight;
  const iconName: IconName =
    tone === "error"
      ? "circle-exclamation"
      : tone === "warning"
        ? "triangle-exclamation"
        : "circle-info";
  const iconColor = tone === "error" ? "error" : tone === "warning" ? "warning" : "secondaryDark";
  const textColor = isInfo ? "secondaryDark" : "primary";
  return (
    <View role={isInfo ? "status" : "alert"} style={{width: "100%"}} testID={testID}>
      <View
        style={{
          backgroundColor: fill,
          borderColor: border,
          borderRadius: theme.radius.full,
          borderWidth: 1,
          gap: 12,
          paddingHorizontal: 16,
          paddingVertical: 12,
          width: "100%",
        }}
      >
        <Box alignItems="start" direction="row" gap={3}>
          <Icon color={iconColor} iconName={iconName} size="lg" />
          <Box flex="shrink" gap={1}>
            {Boolean(notice.title) && (
              <Text bold color={textColor}>
                {notice.title}
              </Text>
            )}
            <Text color={textColor}>{notice.text}</Text>
          </Box>
          {isInfo && Boolean(onDismiss) && (
            <Pressable
              accessibilityLabel="Dismiss"
              accessibilityRole="button"
              onPress={onDismiss}
              testID={`${testID}-dismiss`}
            >
              <Icon color="secondaryDark" iconName="xmark" size="md" />
            </Pressable>
          )}
        </Box>
        {Boolean(notice.actionLabel) && (
          <Box alignItems="start">
            <Button
              onClick={onAction}
              testID={`${testID}-action`}
              text={notice.actionLabel!}
              variant="outline"
            />
          </Box>
        )}
      </View>
    </View>
  );
};

/**
 * A configurable login screen. It is presentational: it renders the methods and accounts it is
 * given and reports presses through callbacks.
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
 *   lastUsedMethod="google"
 *   onPasskeyPress={signInWithPasskey}
 *   onSignUpPress={() => router.push("/signup")}
 * />
 * ```
 */
export const LoginScreen: FC<LoginScreenProps> = ({
  fields,
  onSubmit,
  oauthProviders,
  genericProviders,
  logo,
  title,
  subtitle,
  loading = false,
  error,
  passwordError,
  signUpLinkText = DEFAULT_SIGN_UP_LINK,
  onSignUpPress,
  forgotPasswordText = DEFAULT_FORGOT_PASSWORD,
  onForgotPasswordPress,
  onForgotPassword,
  lastUsedMethod,
  lastUsedLabel = DEFAULT_LAST_USED_LABEL,
  currentSessions,
  rememberedAccounts,
  onContinue,
  onForget,
  continuingAccount,
  onCancelContinue,
  initialMethodsExpanded = false,
  initialAccountsEditing = false,
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
  const [methodsExpanded, setMethodsExpanded] = useState(initialMethodsExpanded);
  const [dismissedNotice, setDismissedNotice] = useState<string | undefined>();
  const [pendingFocus, setPendingFocus] = useState<string | undefined>();

  // Applies a new initialValues object over the form; the first render already used it.
  const appliedInitialValues = useRef(initialValues);
  useEffect(() => {
    if (!initialValues || appliedInitialValues.current === initialValues) {
      return;
    }
    appliedInitialValues.current = initialValues;
    setFormValues((prev) => ({...prev, ...initialValues}));
  }, [initialValues]);

  const noticeText = notice?.text;
  // A replaced notice is shown again. Dismiss only hides the notice currently on screen.
  useEffect(() => {
    if (noticeText === undefined) {
      setDismissedNotice(undefined);
      return;
    }
    setDismissedNotice(undefined);
  }, [noticeText]);

  const onForgotPasswordAction = onForgotPasswordPress ?? onForgotPassword;

  const handleFieldChange = useCallback((fieldName: string, value: string) => {
    setFormValues((prev) => ({...prev, [fieldName]: value}));
  }, []);

  const formRef = useRef<FormContainerHandle>(null);
  const inputRefs = useRef<Record<string, TextInputInstance | null>>({});
  const isSubmittingRef = useRef(false);

  const handlePasskeyPress = useCallback(async (): Promise<void> => {
    await onPasskeyPress?.();
  }, [onPasskeyPress]);

  const passwordField = fields.find((field) => isPasswordField(field));
  const requiredFieldsFilled = fields
    .filter((field) => field.required)
    .every((field) => {
      if (continuingAccount?.email && isEmailField(field)) {
        return true;
      }
      return (formValues[field.name] ?? "").trim().length > 0;
    });

  const isSubmitDisabled = loading || !requiredFieldsFilled;

  const handleSubmit = useCallback(async (): Promise<void> => {
    if (isSubmitDisabled || isSubmittingRef.current) {
      return;
    }
    isSubmittingRef.current = true;
    try {
      const values = {...formValues};
      if (continuingAccount?.email) {
        values.email = continuingAccount.email;
      }
      await onSubmit(values);
    } finally {
      isSubmittingRef.current = false;
    }
  }, [continuingAccount?.email, formValues, isSubmitDisabled, onSubmit]);

  const requestSubmit = useCallback(async (): Promise<void> => {
    if (isSubmitDisabled) {
      return;
    }
    await formRef.current?.requestSubmit();
  }, [isSubmitDisabled]);

  const focusField = useCallback((fieldName: string): void => {
    inputRefs.current[fieldName]?.focus();
  }, []);

  // The password step opens with the password field focused so the user can type at once.
  useEffect(() => {
    if (!continuingAccount) {
      return;
    }
    focusField("password");
  }, [continuingAccount, focusField]);

  // An account-not-linked action expands the methods, then focuses email once the field is mounted.
  useEffect(() => {
    if (pendingFocus !== "email") {
      return;
    }
    const emailInput = inputRefs.current.email;
    if (!emailInput) {
      return;
    }
    emailInput.focus();
    setPendingFocus(undefined);
  }, [pendingFocus]);

  const brandedProviders = oauthProviders ?? [];
  const otherProviders = genericProviders ?? [];
  const hasProviders = brandedProviders.length > 0 || otherProviders.length > 0;
  const hasPasskey = Boolean(onPasskeyPress);
  const hasMethods = hasProviders || hasPasskey;
  const hasForm = fields.length > 0;
  const isProviderLastUsed =
    Boolean(lastUsedMethod) &&
    (brandedProviders.some((config) => config.provider === lastUsedMethod) ||
      otherProviders.some((config) => config.id === lastUsedMethod));
  const isPasskeyLastUsed = lastUsedMethod === "passkey" && hasPasskey;
  const isEmailLastUsed = lastUsedMethod === "email";

  const accountEntries =
    onContinue === undefined
      ? []
      : [
          ...(currentSessions ?? []).map((account) => ({
            account,
            method: getLoginMethodLabels({
              genericProviders: otherProviders,
              method: account.method,
            }),
            source: "session" as const,
          })),
          ...(rememberedAccounts ?? []).map((account) => ({
            account,
            method: getLoginMethodLabels({
              genericProviders: otherProviders,
              method: account.method,
            }),
            source: "remembered" as const,
          })),
        ];
  const hasAccounts = accountEntries.length > 0;
  const showMethods = !hasAccounts || methodsExpanded;
  const resolvedTitle = title ?? (hasAccounts ? "Welcome back" : "Sign in");
  const resolvedSubtitle =
    subtitle ?? (hasAccounts ? "Pick up where you left off." : "Choose how you want to sign in.");

  const visibleNotice =
    notice && dismissedNotice !== `${notice.tone}:${notice.title ?? ""}:${notice.text}`
      ? notice
      : undefined;
  const banner: LoginNotice | undefined = visibleNotice
    ? visibleNotice
    : error
      ? {text: error, tone: "error"}
      : undefined;

  const handleNoticeAction = useCallback((): void => {
    if (notice?.focusMethod) {
      setMethodsExpanded(true);
      setPendingFocus(notice.focusMethod);
    }
    void notice?.onAction?.();
  }, [notice]);

  const handleDismissNotice = useCallback((): void => {
    if (!notice) {
      return;
    }
    setDismissedNotice(`${notice.tone}:${notice.title ?? ""}:${notice.text}`);
  }, [notice]);

  const expandMethods = useCallback((): void => {
    setMethodsExpanded(true);
  }, []);

  const handleCancelContinue = useCallback((): void => {
    onCancelContinue?.();
  }, [onCancelContinue]);

  const renderPasskey = (): ReactElement => (
    <OutlinePill
      accessibilityLabel={
        isPasskeyLastUsed
          ? withLastUsedLabel({label: passkeyButtonText, lastUsedLabel})
          : passkeyButtonText
      }
      disabled={loading}
      icon={<Icon color={loading ? "secondaryLight" : "primary"} iconName="key" size="md" />}
      lastUsedLabel={isPasskeyLastUsed ? lastUsedLabel : undefined}
      lastUsedTestID={`${testID}-last-used-passkey`}
      onPress={handlePasskeyPress}
      testID={`${testID}-passkey-button`}
      text={passkeyButtonText}
    />
  );

  const renderMethodStack = (): ReactElement => (
    <Box gap={3} width="100%">
      {isPasskeyLastUsed && renderPasskey()}
      {hasProviders && (
        <OAuthButtons
          appearance="pill"
          disabled={loading}
          dividerPosition="none"
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
      )}
      {hasPasskey && !isPasskeyLastUsed && renderPasskey()}
    </Box>
  );

  const renderField = (
    field: LoginFieldConfig,
    index: number,
    visibleFields: LoginFieldConfig[]
  ): ReactElement => {
    const nextField = visibleFields[index + 1];
    const emailLastUsed = isEmailLastUsed && isEmailField(field);
    const showForgot = isPasswordField(field) && Boolean(onForgotPasswordAction);
    const fieldError = isPasswordField(field) ? passwordError : undefined;
    const placeholder = isPasswordField(field)
      ? undefined
      : isEmailField(field)
        ? (field.placeholder ?? "you@example.com")
        : (field.placeholder ?? field.label);
    return (
      <Box gap={2} key={field.name} width="100%">
        <Box alignItems="center" direction="row" justifyContent="between" width="100%">
          <Box alignItems="center" direction="row" gap={2}>
            <Text bold>{field.label}</Text>
            {emailLastUsed && (
              <LastUsedPill label={lastUsedLabel} testID={`${testID}-last-used-email`} />
            )}
          </Box>
          {showForgot && (
            <TextLink
              disabled={loading}
              onPress={onForgotPasswordAction!}
              testID={`${testID}-forgot-password`}
              text={forgotPasswordText}
            />
          )}
        </Box>
        <TextField
          accessibilityLabel={
            emailLastUsed ? withLastUsedLabel({label: field.label, lastUsedLabel}) : field.label
          }
          autoComplete={getFieldAutoComplete({field, passkeyAutofill})}
          blurOnSubmit={!nextField}
          disabled={loading}
          errorPosition="below"
          errorText={fieldError}
          id={`${testID}-${field.name}-input`}
          inputRef={(ref) => {
            inputRefs.current[field.name] = ref;
          }}
          onChange={(value: string) => handleFieldChange(field.name, value)}
          onEnter={nextField ? () => focusField(nextField.name) : requestSubmit}
          placeholder={placeholder}
          returnKeyType={nextField ? "next" : "go"}
          testID={`${testID}-${field.name}-input`}
          type={field.type === "email" ? "email" : field.type === "password" ? "password" : "text"}
          value={formValues[field.name]}
        />
      </Box>
    );
  };

  const renderFooter = (): ReactNode => {
    if (!onSignUpPress) {
      return null;
    }
    return (
      <Box alignItems="center" direction="row" gap={1} justifyContent="center" paddingY={2}>
        <Text color="secondaryLight">New here?</Text>
        <Pressable
          accessibilityRole="link"
          disabled={loading}
          onPress={onSignUpPress}
          testID={`${testID}-signup-link`}
        >
          <Text bold color="link">
            {signUpLinkText}
          </Text>
        </Pressable>
      </Box>
    );
  };

  const renderContinueStep = (): ReactElement => {
    const account = continuingAccount!;
    const who = account.name ?? account.email ?? "this account";
    return (
      <Box gap={6} width="100%">
        <Pressable
          accessibilityRole="link"
          disabled={loading}
          onPress={handleCancelContinue}
          testID={`${testID}-continue-back`}
        >
          <Box alignItems="center" direction="row" gap={1}>
            <Icon color="link" iconName="chevron-left" size="md" />
            <Text bold color="link">
              All sign-in options
            </Text>
          </Box>
        </Pressable>
        <Heading size="xl">Enter your password</Heading>
        <IdentityChip
          account={account}
          disabled={loading}
          onNotYou={handleCancelContinue}
          testID={`${testID}-continue-not-you`}
          who={who}
        />
        <FormContainer
          accessibilityLabel="Enter your password"
          gap={4}
          onSubmit={handleSubmit}
          ref={formRef}
          testID={`${testID}-form`}
          width="100%"
        >
          <View
            accessibilityElementsHidden
            importantForAccessibility="no-hide-descendants"
            style={{height: 0, overflow: "hidden", width: "100%"}}
          >
            <TextField
              accessibilityLabel="Email"
              autoComplete="username"
              onChange={() => {}}
              testID={`${testID}-email-input`}
              type="email"
              value={account.email ?? ""}
            />
          </View>
          {passwordField && renderField(passwordField, 0, [passwordField])}
          <Button
            disabled={isSubmitDisabled}
            fullWidth
            loading={loading}
            onClick={requestSubmit}
            testID={`${testID}-submit-button`}
            text={loading ? "Signing in" : "Sign in"}
          />
        </FormContainer>
      </Box>
    );
  };

  const visibleFields = continuingAccount ? [] : fields;

  return (
    <Page navigation={undefined}>
      <View
        accessibilityState={{busy: loading}}
        aria-busy={loading}
        style={{alignItems: "center", flexGrow: 1, width: "100%"}}
      >
        <Box alignSelf="center" flex="grow" maxWidth={400} padding={4} testID={testID} width="100%">
          <Box flex="grow" gap={5} width="100%">
            {Boolean(logo) && <Box>{logo}</Box>}
            {!continuingAccount && (
              <Box gap={1}>
                <Heading size="xl" testID={`${testID}-title`}>
                  {resolvedTitle}
                </Heading>
                <Text color="secondaryLight" testID={`${testID}-subtitle`}>
                  {resolvedSubtitle}
                </Text>
              </Box>
            )}
            {Boolean(banner) && (
              <NoticeBox
                notice={banner!}
                onAction={handleNoticeAction}
                onDismiss={banner?.tone === "info" ? handleDismissNotice : undefined}
                testID={
                  banner?.tone === "error" && !visibleNotice
                    ? `${testID}-error`
                    : `${testID}-notice`
                }
              />
            )}
            {continuingAccount ? (
              renderContinueStep()
            ) : (
              <Box gap={5} width="100%">
                {hasAccounts && (
                  <LoginAccountList
                    accounts={accountEntries}
                    disabled={loading}
                    initialEditing={initialAccountsEditing}
                    lastUsedLabel={lastUsedLabel}
                    lastUsedMethod={lastUsedMethod}
                    onContinue={onContinue!}
                    onForget={onForget}
                    testID={testID}
                  />
                )}
                {hasAccounts && (hasMethods || hasForm) && !showMethods && (
                  <Button
                    disabled={loading}
                    fullWidth
                    onClick={expandMethods}
                    testID={`${testID}-another-way`}
                    text="Sign in another way"
                    variant="muted"
                  />
                )}
                {showMethods && hasAccounts && hasMethods && (
                  <MethodDivider text="or sign in another way" />
                )}
                {showMethods && hasMethods && renderMethodStack()}
                {showMethods && hasForm && hasMethods && <MethodDivider text="or use your email" />}
                {showMethods && hasForm && (
                  <FormContainer
                    accessibilityLabel={resolvedTitle}
                    gap={4}
                    onSubmit={handleSubmit}
                    ref={formRef}
                    testID={`${testID}-form`}
                    width="100%"
                  >
                    {visibleFields.map((field, index) => renderField(field, index, visibleFields))}
                    <Button
                      accessibilityLabel={
                        isEmailLastUsed
                          ? withLastUsedLabel({label: "Sign in", lastUsedLabel})
                          : undefined
                      }
                      disabled={isSubmitDisabled}
                      fullWidth
                      loading={loading}
                      onClick={requestSubmit}
                      testID={`${testID}-submit-button`}
                      text={loading ? "Signing in" : "Sign in"}
                    />
                  </FormContainer>
                )}
              </Box>
            )}
          </Box>
          {renderFooter()}
        </Box>
      </View>
    </Page>
  );
};

const IdentityChip: FC<{
  account: LoginAccountOption;
  who: string;
  onNotYou: () => void;
  disabled: boolean;
  testID: string;
}> = ({account, who, onNotYou, disabled, testID}) => {
  const {theme} = useTheme();
  if (!theme) {
    return null;
  }
  return (
    <View
      style={{
        alignItems: "center",
        backgroundColor: theme.surface.secondaryExtraLight,
        borderColor: theme.surface.secondaryLight,
        borderRadius: theme.radius.full,
        borderWidth: 1,
        flexDirection: "row",
        gap: 12,
        paddingHorizontal: 16,
        paddingVertical: 12,
        width: "100%",
      }}
    >
      <AvatarOrIcon account={account} who={who} />
      <Box flex="shrink">
        <Text bold>{account.name ?? who}</Text>
        {Boolean(account.email) && (
          <Text color="secondaryLight" size="sm">
            {account.email}
          </Text>
        )}
      </Box>
      <TextLink disabled={disabled} onPress={onNotYou} testID={testID} text="Not you?" />
    </View>
  );
};

const AvatarOrIcon: FC<{account: LoginAccountOption; who: string}> = ({account, who}) => {
  if (account.name || account.email) {
    return <Avatar name={account.name ?? account.email ?? who} size="sm" src={account.image} />;
  }
  return <Icon color="secondaryLight" iconName="circle-user" size="xl" />;
};
