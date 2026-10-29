import type {FC, ReactElement, ReactNode} from "react";
import {ActivityIndicator, useWindowDimensions, View} from "react-native";

import {Box} from "../Box";
import {Button} from "../Button";
import {Card} from "../Card";
import {Heading} from "../Heading";
import {isSupportedDesktopWidth} from "../MediaQuery";
import {Page} from "../Page";
import {Text} from "../Text";
import {useTheme} from "../Theme";
import {LinkedAccountsCard} from "./LinkedAccountsCard";
import {PasskeysCard} from "./PasskeysCard";
import {PasswordCard} from "./PasswordCard";
import {SessionsCard} from "./SessionsCard";
import type {AccountSecurityScreenProps} from "./securityTypes";
import {TwoFactorSettingsCard} from "./TwoFactorSettingsCard";

const LOADING_LABEL = "Loading security settings";

/**
 * A security settings screen built from the account security cards: sign-in methods (linked
 * accounts and password), passkeys, two-factor authentication, and sessions, in that order. Each
 * card renders only when its props are given, so a feature the app turned off hides its card.
 * Presentational: it shows what it is given and reports actions through each card's callbacks.
 */
export const AccountSecurityScreen: FC<AccountSecurityScreenProps> = ({
  linkedAccounts,
  password,
  passkeys,
  twoFactor,
  sessions,
  title = "Security",
  description,
  header,
  children,
  isLoading = false,
  error,
  onRetry,
  withPage = true,
  maxWidth = 720,
  testID = "account-security-screen",
}) => {
  const {theme} = useTheme();
  const {width: windowWidth} = useWindowDimensions();
  // Below the desktop floor, cards run edge to edge, so the screen adds no side padding of its
  // own and insets its text to line up with the cards' content instead.
  const isFullBleed = !isSupportedDesktopWidth({width: windowWidth});
  const textInset = isFullBleed ? 4 : 0;

  const hasSignInMethods = Boolean(linkedAccounts) || Boolean(password);
  const hasCards = hasSignInMethods || Boolean(passkeys) || Boolean(twoFactor) || Boolean(sessions);

  const renderBody = (): ReactNode => {
    if (isLoading) {
      return (
        <View
          accessibilityLabel={LOADING_LABEL}
          accessibilityRole="progressbar"
          aria-busy
          style={{alignItems: "center", gap: 8, paddingVertical: 48}}
          testID={`${testID}-loading`}
        >
          {/* The ui Spinner waits 300ms before showing; a page load wants feedback at once. */}
          <ActivityIndicator color={theme.primitives.neutral400} size="large" />
          <Text color="secondaryLight">Loading your security settings…</Text>
        </View>
      );
    }

    if (error) {
      return (
        <Card>
          <View role="alert" style={{gap: 16}} testID={`${testID}-error`}>
            <Text color="error" testID={`${testID}-error-message`}>
              {error}
            </Text>
            {Boolean(onRetry) && (
              <Box alignItems="start">
                <Button
                  iconName="arrows-rotate"
                  onClick={(): void => onRetry?.()}
                  testID={`${testID}-retry`}
                  text="Try again"
                  variant="secondary"
                />
              </Box>
            )}
          </View>
        </Card>
      );
    }

    if (!hasCards && !children) {
      return (
        <Box paddingX={textInset}>
          <Text color="secondaryLight" testID={`${testID}-empty`}>
            There are no security settings to manage.
          </Text>
        </Box>
      );
    }

    return (
      <>
        {hasSignInMethods && (
          <Box gap={4} testID={`${testID}-sign-in-methods`}>
            {Boolean(linkedAccounts) && <LinkedAccountsCard {...linkedAccounts!} />}
            {Boolean(password) && <PasswordCard {...password!} />}
          </Box>
        )}
        {Boolean(passkeys) && <PasskeysCard {...passkeys!} />}
        {Boolean(twoFactor) && <TwoFactorSettingsCard {...twoFactor!} />}
        {Boolean(sessions) && <SessionsCard {...sessions!} />}
        {children}
      </>
    );
  };

  const content: ReactElement = (
    <Box
      alignSelf="center"
      gap={4}
      maxWidth={maxWidth}
      paddingX={withPage && !isFullBleed ? 4 : 0}
      paddingY={4}
      testID={testID}
      width="100%"
    >
      <Box gap={1} paddingX={textInset} testID={`${testID}-heading`}>
        <Heading level={1} size="lg" testID={`${testID}-title`}>
          {title}
        </Heading>
        {Boolean(description) && (
          <Text color="secondaryLight" testID={`${testID}-description`}>
            {description}
          </Text>
        )}
      </Box>
      {Boolean(header) && <Box paddingX={textInset}>{header}</Box>}
      {renderBody()}
    </Box>
  );

  if (!withPage) {
    return content;
  }

  return (
    // The Page (and its ScrollView) spans the window so the whole width scrolls; the content Box
    // above applies maxWidth.
    <Page maxWidth="100%" navigation={undefined} padding={0}>
      {content}
    </Page>
  );
};
