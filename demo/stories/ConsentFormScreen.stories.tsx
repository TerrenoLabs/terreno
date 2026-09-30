import {Box, ConsentFormScreen} from "@terreno/ui";
import type React from "react";
import {type ReactElement, useCallback, useContext} from "react";

import {DemoPreviewContext} from "../previewContext";

const consentForm = {
  active: true,
  agreeButtonText: "I agree",
  allowDecline: true,
  captureSignature: true,
  checkboxes: [{label: "I have read and understand this consent form.", required: true}],
  content: {
    en: "Please review this consent form. The signature area should fit within the card and the action buttons should share one row.",
    "en-US": "US English consent copy for the preview locale.",
  },
  declineButtonText: "Decline",
  defaultLocale: "en",
  id: "demo-consent",
  order: 0,
  required: true,
  requireScrollToBottom: false,
  slug: "demo-consent",
  title: "Consent Form",
  type: "agreement",
  version: 1,
};

export const ConsentFormScreenDemo: React.FC = (): ReactElement => {
  const handleAgree = useCallback((): void => {}, []);
  const handleDecline = useCallback((): void => {}, []);
  const preview = useContext(DemoPreviewContext);

  return (
    <>
      <Box accessibilityLabel={preview.locale} height={0} testID="consent-preview-locale" />
      <ConsentFormScreen
        form={consentForm}
        locale={preview.locale}
        onAgree={handleAgree}
        onDecline={handleDecline}
      />
    </>
  );
};
