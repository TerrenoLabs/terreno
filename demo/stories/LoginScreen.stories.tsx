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
        actionLabel: "Sign in with Google",
        focusMethod: "google",
        onAction: () => {},
        text: "That email is already used with Google. Sign in with Google, then link GitHub from Security.",
        title: "You already have an account",
        tone: "warning",
      }}
      oauthProviders={brandedProviders}
      onSubmit={noop}
    />
  );
};

const returningAccounts = {
  currentSessions: [
    {email: "ada@example.com", id: "session-1", method: "github", name: "Ada Lovelace"},
  ],
  rememberedAccounts: [
    {email: "grace@example.com", id: "remembered-1", method: "google", name: "Grace Hopper"},
  ],
};

export const LoginScreenReturning: React.FC = (): ReactElement => {
  return (
    <LoginScreen
      currentSessions={returningAccounts.currentSessions}
      fields={fields}
      lastUsedMethod="github"
      oauthProviders={brandedProviders}
      onContinue={() => {}}
      onForget={() => {}}
      onPasskeyPress={noop}
      onSignUpPress={() => {}}
      onSubmit={noop}
      rememberedAccounts={returningAccounts.rememberedAccounts}
    />
  );
};

export const LoginScreenAnotherWay: React.FC = (): ReactElement => {
  return (
    <LoginScreen
      currentSessions={returningAccounts.currentSessions}
      fields={fields}
      initialMethodsExpanded
      lastUsedMethod="github"
      oauthProviders={brandedProviders}
      onContinue={() => {}}
      onForget={() => {}}
      onPasskeyPress={noop}
      onSubmit={noop}
      rememberedAccounts={returningAccounts.rememberedAccounts}
    />
  );
};

export const LoginScreenEditAccounts: React.FC = (): ReactElement => {
  return (
    <LoginScreen
      currentSessions={returningAccounts.currentSessions}
      fields={fields}
      initialAccountsEditing
      oauthProviders={brandedProviders}
      onContinue={() => {}}
      onForget={() => {}}
      onSubmit={noop}
      rememberedAccounts={returningAccounts.rememberedAccounts}
    />
  );
};

export const LoginScreenContinueEmail: React.FC = (): ReactElement => {
  return (
    <LoginScreen
      continuingAccount={{
        email: "grace@example.com",
        id: "remembered-1",
        method: "email",
        name: "Grace Hopper",
      }}
      fields={fields}
      onCancelContinue={() => {}}
      onForgotPassword={() => {}}
      onSubmit={noop}
    />
  );
};

export const LoginScreenSigningIn: React.FC = (): ReactElement => {
  return (
    <LoginScreen
      fields={fields}
      initialValues={{email: "ada@example.com", password: "secret"}}
      loading
      oauthProviders={brandedProviders}
      onSubmit={noop}
    />
  );
};

export const LoginScreenCancelled: React.FC = (): ReactElement => {
  return (
    <LoginScreen
      fields={fields}
      notice={{
        text: "GitHub sign-in was cancelled. Try again or choose another way.",
        tone: "info",
      }}
      oauthProviders={brandedProviders}
      onSubmit={noop}
    />
  );
};

export const LoginScreenWrongPassword: React.FC = (): ReactElement => {
  return (
    <LoginScreen
      fields={fields}
      initialValues={{email: "ada@example.com"}}
      oauthProviders={brandedProviders}
      onForgotPassword={() => {}}
      onSubmit={noop}
      passwordError="That password doesn't match. Try again or reset it."
    />
  );
};
