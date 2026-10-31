import {Page, ProvisionalConsentSigner, Text} from "@terreno/ui";
import {useLocalSearchParams} from "expo-router";
import type React from "react";
import {apiClient} from "@/store/apiClient";

/**
 * Staff screen for recording consent on a user's behalf. It sits outside /admin so staff with
 * the consentResponse:signOnBehalf role, who are not admins, can reach it.
 */
const ConsentSignScreen: React.FC = () => {
  const {userId} = useLocalSearchParams<{userId: string | string[]}>();
  const targetUserId = typeof userId === "string" ? userId : undefined;
  return (
    <Page backButton maxWidth={800} scroll title="Sign consent on behalf">
      {targetUserId ? (
        <ProvisionalConsentSigner client={apiClient} userId={targetUserId} />
      ) : (
        <Text color="error" testID="consent-sign-missing-user">
          No user selected.
        </Text>
      )}
    </Page>
  );
};

export default ConsentSignScreen;
