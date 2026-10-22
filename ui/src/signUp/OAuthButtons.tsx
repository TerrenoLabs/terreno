import {type FC, Fragment, type ReactElement} from "react";

import {Box} from "../Box";
import {Button} from "../Button";
import {LastUsedBadge} from "../login/LastUsedBadge";
import {withLastUsedLabel} from "../login/loginMethods";
import {SOCIAL_PROVIDER_NAMES, SocialLoginButton} from "../SocialLoginButton";
import {Text} from "../Text";
import type {GenericOAuthProviderConfig, OAuthProviderConfig} from "./signUpTypes";

/**
 * Marks one provider as the one this device used last.
 */
interface OAuthButtonsLastUsed {
  /** Provider id: a branded provider or a generic provider's `id`. */
  provider: string;
  /** Badge text. Defaults to "Last used". */
  label?: string;
  /** Badge test ID. Defaults to `${testID}-${provider}-last-used`. */
  testID?: string;
}

interface OAuthButtonsProps {
  /** Branded OAuth provider configurations (Google, GitHub, Apple). */
  providers: OAuthProviderConfig[];
  /** Providers without a branded button, rendered after `providers` as outline buttons. */
  genericProviders?: GenericOAuthProviderConfig[];
  /** Badges this provider and moves it to the front of the list. */
  lastUsed?: OAuthButtonsLastUsed;
  /** Whether all buttons should be disabled. */
  disabled?: boolean;
  /** Divider text displayed next to the OAuth buttons. */
  dividerText?: string;
  /** Where the divider sits: above the buttons (default) or below them. */
  dividerPosition?: "above" | "below";
  /** Test ID prefix for the component. */
  testID?: string;
}

interface ProviderEntry {
  id: string;
  /** The button's visible text, used to build its last-used accessible name. */
  label: string;
  /** Renders the button; `accessibilityLabel` overrides its accessible name. */
  render: (accessibilityLabel?: string) => ReactElement;
}

/**
 * Renders OAuth provider buttons with an optional divider text.
 * Uses SocialLoginButton for branded provider buttons and an outline Button for generic ones.
 */
export const OAuthButtons: FC<OAuthButtonsProps> = ({
  providers,
  genericProviders = [],
  lastUsed,
  disabled = false,
  dividerText = "Or continue with",
  dividerPosition = "above",
  testID = "oauth-buttons",
}) => {
  if (providers.length === 0 && genericProviders.length === 0) {
    return null;
  }

  const entries: ProviderEntry[] = [
    ...providers.map((config) => ({
      id: config.provider,
      label: `Continue with ${SOCIAL_PROVIDER_NAMES[config.provider]}`,
      render: (accessibilityLabel?: string): ReactElement => (
        <SocialLoginButton
          accessibilityLabel={accessibilityLabel}
          disabled={disabled || config.disabled}
          loading={config.loading}
          onPress={config.onPress}
          provider={config.provider}
          testID={`${testID}-${config.provider}`}
        />
      ),
    })),
    ...genericProviders.map((config) => ({
      id: config.id,
      label: `Continue with ${config.label}`,
      render: (accessibilityLabel?: string): ReactElement => (
        <Button
          accessibilityLabel={accessibilityLabel}
          disabled={disabled || config.disabled}
          fullWidth
          iconName={config.iconName}
          loading={config.loading}
          onClick={config.onPress}
          testID={`${testID}-${config.id}`}
          text={`Continue with ${config.label}`}
          variant="outline"
        />
      ),
    })),
  ];

  const lastUsedIndex = lastUsed
    ? entries.findIndex((entry) => entry.id === lastUsed.provider)
    : -1;
  const orderedEntries =
    lastUsedIndex > 0
      ? [entries[lastUsedIndex], ...entries.filter((_, index) => index !== lastUsedIndex)]
      : entries;

  const badgeLabel = lastUsed?.label ?? "Last used";

  const divider =
    dividerPosition === "above" ? (
      <Box alignItems="center" marginTop={6}>
        <Text color="secondaryLight">{dividerText}</Text>
      </Box>
    ) : (
      <Box alignItems="center" marginBottom={2} marginTop={6}>
        <Text color="secondaryLight">{dividerText}</Text>
      </Box>
    );

  return (
    <Box testID={testID} width="100%">
      {dividerPosition === "above" && divider}
      <Box gap={3} marginTop={dividerPosition === "above" ? 4 : undefined}>
        {orderedEntries.map((entry) => {
          if (lastUsedIndex === -1 || entry.id !== lastUsed?.provider) {
            return <Fragment key={entry.id}>{entry.render()}</Fragment>;
          }
          return (
            <Box key={entry.id}>
              <LastUsedBadge
                label={badgeLabel}
                testID={lastUsed.testID ?? `${testID}-${entry.id}-last-used`}
              />
              {entry.render(withLastUsedLabel({label: entry.label, lastUsedLabel: badgeLabel}))}
            </Box>
          );
        })}
      </Box>
      {dividerPosition === "below" && divider}
    </Box>
  );
};
