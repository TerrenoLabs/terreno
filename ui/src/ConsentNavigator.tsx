import React, {useState} from "react";

import {Box} from "./Box";
import {Button} from "./Button";
import {ConsentFormScreen} from "./ConsentFormScreen";
import type {TerrenoRequestClient} from "./requestClient";
import {Spinner} from "./Spinner";
import {Text} from "./Text";
import {detectLocale, useConsentForms} from "./useConsentForms";
import type {SubmitConsentBody} from "./useSubmitConsent";
import {useSubmitConsent} from "./useSubmitConsent";

interface ConsentNavigatorProps {
  /**
   * Request client for the consent routes, usually the app's `@terreno/syncdb/api` client
   * (`createApiClient(...)`). Any object with a matching `request` method works.
   */
  client: TerrenoRequestClient;
  /** Path prefixed to the consent routes (for example `/api`); defaults to none. */
  baseUrl?: string;
  children: React.ReactNode;
  extraScreens?: React.ReactNode[];
  onError?: (error: unknown) => void;
  variables?: Record<string, string>;
}

export const ConsentNavigator: React.FC<ConsentNavigatorProps> = ({
  client,
  baseUrl,
  children,
  extraScreens,
  onError,
  variables,
}) => {
  const [currentIndex, setCurrentIndex] = useState(0);
  const [extraScreenIndex, setExtraScreenIndex] = useState(0);
  const {forms, isLoading, error, refetch} = useConsentForms(client, baseUrl);
  const {submit, isSubmitting} = useSubmitConsent(client, baseUrl);
  const locale = detectLocale();
  const validExtraScreens = extraScreens ?? [];

  if (isLoading) {
    console.debug("[ConsentNavigator] Loading pending consents...");
    return (
      <Box
        alignItems="center"
        flex="grow"
        justifyContent="center"
        testID="consent-navigator-loading"
      >
        <Spinner />
      </Box>
    );
  }

  if (error) {
    const errorObj = error as {status?: number; originalStatus?: number};
    const status = errorObj?.status ?? errorObj?.originalStatus;
    console.warn("[ConsentNavigator] Error fetching pending consents:", {error, status});
    // On auth errors, pass through to let the app handle re-authentication
    if (status === 401 || status === 403) {
      return <>{children}</>;
    }
    onError?.(error);
    return (
      <Box
        alignItems="center"
        direction="column"
        flex="grow"
        gap={3}
        justifyContent="center"
        padding={6}
        testID="consent-navigator-error"
      >
        <Text align="center" color="error" size="lg">
          Failed to load consent forms
        </Text>
        <Button onClick={refetch} text="Retry" />
      </Box>
    );
  }

  if (forms.length === 0 || currentIndex >= forms.length) {
    if (extraScreenIndex < validExtraScreens.length) {
      const currentScreen = validExtraScreens[extraScreenIndex];
      console.debug(
        `[ConsentNavigator] Showing extra screen ${extraScreenIndex + 1}/${validExtraScreens.length}`
      );
      if (React.isValidElement(currentScreen)) {
        return React.cloneElement(currentScreen as React.ReactElement<{onNext?: () => void}>, {
          onNext: () => setExtraScreenIndex((i) => i + 1),
        });
      }
      return <>{currentScreen}</>;
    }
    console.debug("[ConsentNavigator] No pending consents, showing app");
    return <>{children}</>;
  }

  console.info(
    `[ConsentNavigator] Showing consent form ${currentIndex + 1}/${forms.length}: ${forms[currentIndex]?.title}`
  );

  const currentForm = forms[currentIndex];

  const handleAgree = async (data: {
    checkboxValues: Record<string, boolean>;
    signature?: string;
  }) => {
    const body: SubmitConsentBody = {
      agreed: true,
      checkboxValues: data.checkboxValues,
      consentFormId: currentForm.id,
      locale,
      signature: data.signature,
    };

    try {
      await submit(body);
      // Always refetch and reset so we pick up the updated pending list.
      // Advancing currentIndex is racy because the submit invalidation shrinks
      // the forms array in the background.
      setCurrentIndex(0);
      await refetch();
    } catch (err) {
      onError?.(err);
    }
  };

  const handleDecline = async () => {
    try {
      await submit({
        agreed: false,
        consentFormId: currentForm.id,
        locale,
      });
      setCurrentIndex(0);
      await refetch();
    } catch (err) {
      onError?.(err);
    }
  };

  return (
    <ConsentFormScreen
      form={currentForm}
      isSubmitting={isSubmitting}
      locale={locale}
      onAgree={handleAgree}
      onDecline={currentForm.required ? undefined : handleDecline}
      variables={variables}
    />
  );
};
