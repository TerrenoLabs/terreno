import type {LoginAccountOption} from "@terreno/ui";
import {LoginScreen} from "@terreno/ui";
import {type ReactElement, useCallback, useState} from "react";

const fields = [
  {label: "Email", name: "email", required: true, type: "email" as const},
  {label: "Password", name: "password", required: true, type: "password" as const},
];

const noop = async (): Promise<void> => {};

const brandedProviders = [
  {onPress: noop, provider: "google" as const},
  {onPress: noop, provider: "github" as const},
  {onPress: noop, provider: "apple" as const},
];

const genericProviders = [
  {iconName: "key" as const, id: "mock-oidc", label: "Mock OIDC", onPress: noop},
];

export const LoginScreenDemo: React.FC = (): ReactElement => {
  const handleSubmit = useCallback(async (): Promise<void> => {}, []);
  const handleForgotPassword = useCallback((): void => {}, []);

  return (
    <LoginScreen fields={fields} onForgotPassword={handleForgotPassword} onSubmit={handleSubmit} />
  );
};

export const LoginScreenWithProviders: React.FC = (): ReactElement => {
  return (
    <LoginScreen
      fields={fields}
      genericProviders={genericProviders}
      oauthProviders={brandedProviders}
      onSignUpPress={() => {}}
      onSubmit={noop}
    />
  );
};

export const LoginScreenLastUsedProvider: React.FC = (): ReactElement => {
  return (
    <LoginScreen
      fields={fields}
      genericProviders={genericProviders}
      lastUsedMethod="github"
      oauthProviders={brandedProviders}
      onPasskeyPress={noop}
      onSubmit={noop}
    />
  );
};

export const LoginScreenPasskey: React.FC = (): ReactElement => {
  return (
    <LoginScreen
      fields={fields}
      lastUsedMethod="passkey"
      oauthProviders={brandedProviders}
      onPasskeyPress={noop}
      onSubmit={noop}
      passkeyAutofill
    />
  );
};

export const LoginScreenContinueAs: React.FC = (): ReactElement => {
  const [remembered, setRemembered] = useState<LoginAccountOption[]>([
    {email: "grace@example.com", id: "remembered-1", method: "google", name: "Grace Hopper"},
    {id: "remembered-2", method: "passkey"},
  ]);

  const handleForget = useCallback((account: LoginAccountOption): void => {
    setRemembered((current) => current.filter((item) => item.id !== account.id));
  }, []);

  return (
    <LoginScreen
      currentSessions={[
        {email: "ada@example.com", id: "session-1", method: "github", name: "Ada Lovelace"},
      ]}
      fields={fields}
      lastUsedMethod="email"
      oauthProviders={brandedProviders}
      onContinue={() => {}}
      onForget={handleForget}
      onPasskeyPress={noop}
      onSubmit={noop}
      rememberedAccounts={remembered}
    />
  );
};

export const LoginScreenNotice: React.FC = (): ReactElement => {
  return (
    <LoginScreen
      fields={fields}
      lastUsedMethod="google"
      notice={{
        actionLabel: "Continue with Google",
        onAction: () => {},
        text: "This email already has an account. Sign in with Google, then link GitHub from your security settings.",
        tone: "warning",
      }}
      oauthProviders={brandedProviders}
      onSubmit={noop}
    />
  );
};
