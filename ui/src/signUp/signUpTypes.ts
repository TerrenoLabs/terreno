import type {ReactNode} from "react";

import type {IconName} from "../Common";

/**
 * Supported OAuth providers for social login buttons.
 */
export type OAuthProvider = "google" | "github" | "apple";

/**
 * Configuration for an OAuth provider button.
 */
export interface OAuthProviderConfig {
  /** The OAuth provider identifier. */
  provider: OAuthProvider;
  /** Callback triggered when the provider button is pressed. */
  onPress: () => Promise<void>;
  /** Whether the button is in a loading state. */
  loading?: boolean;
  /** Whether the button is disabled. */
  disabled?: boolean;
}

/**
 * Configuration for a sign-in provider without a branded `SocialLoginButton`, such as a Better
 * Auth generic OAuth/OIDC provider (`mock-oidc`, a company SSO). It renders as an outline
 * `Button` reading "Continue with {label}".
 */
export interface GenericOAuthProviderConfig {
  /** Provider id, matching the id passed to `signIn.social` and to `lastUsedMethod`. */
  id: string;
  /** Display name. The button reads "Continue with {label}". */
  label: string;
  /** Callback triggered when the provider button is pressed. */
  onPress: () => Promise<void>;
  /** Whether the button is in a loading state. */
  loading?: boolean;
  /** Whether the button is disabled. */
  disabled?: boolean;
  /** Optional FontAwesome icon shown before the label. */
  iconName?: IconName;
}

/**
 * Configuration for a sign-up form field.
 */
export interface SignUpFieldConfig {
  /** Unique field name used as the key in form state. */
  name: string;
  /** Display label for the field. */
  label: string;
  /** Placeholder text shown when the field is empty. */
  placeholder?: string;
  /** Input type for the field. */
  type?: "text" | "email" | "password";
  /** Whether the field is required. */
  required?: boolean;
  /** Auto-complete hint for the field. */
  autoComplete?: "current-password" | "email" | "new-password" | "on" | "off" | "username";
}

/**
 * A single password requirement with a label and validation function.
 */
export interface PasswordRequirement {
  /** Unique key for the requirement. */
  key: string;
  /** Display label for the requirement. */
  label: string;
  /** Returns true if the password meets this requirement. */
  validate: (password: string) => boolean;
}

/**
 * Configuration for a single onboarding page in the swiper.
 */
export interface OnboardingPage {
  /** Title text displayed on the page. */
  title: string;
  /** Subtitle or description text. */
  subtitle?: string;
  /** Custom content to render on the page. */
  content?: ReactNode;
  /** Image source for the page. */
  image?: number | {uri: string};
}

/**
 * Props for the SignUpScreen component.
 */
export interface SignUpScreenProps {
  /** Form field configurations. */
  fields: SignUpFieldConfig[];
  /** Callback triggered on form submission. Receives field values as a record. */
  onSubmit: (values: Record<string, string>) => Promise<void>;
  /** Optional OAuth provider configurations for social login buttons. */
  oauthProviders?: OAuthProviderConfig[];
  /** Password requirements to validate against. */
  passwordRequirements?: PasswordRequirement[];
  /** Onboarding pages to display before the sign-up form. */
  onboardingPages?: OnboardingPage[];
  /** Custom logo or banner to display above the form. */
  logo?: ReactNode;
  /** Title text for the sign-up form. */
  title?: string;
  /** Whether the form is in a loading state. */
  loading?: boolean;
  /** Error message to display. */
  error?: string;
  /** Text for the link to navigate to login. */
  loginLinkText?: string;
  /** Callback triggered when the login link is pressed. */
  onLoginPress?: () => void;
  /** Test ID for the root element. */
  testID?: string;
}
