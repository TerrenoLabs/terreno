import {Page, ProvisionalConsentSigner} from "@terreno/ui";
import {useLocalSearchParams} from "expo-router";
import type React from "react";
import {terrenoApi} from "@/store/sdk";

/**
 * Staff screen for recording consent on a user's behalf. It sits outside /admin so staff with
 * the consentResponse:signOnBehalf role, who are not admins, can reach it.
 */
const ConsentSignScreen: React.FC = () => {
  const {userId} = useLocalSearchParams<{userId: string}>();
  return (
    <Page backButton maxWidth={800} scroll title="Sign consent on behalf">
      <ProvisionalConsentSigner api={terrenoApi} userId={userId} />
    </Page>
  );
};

export default ConsentSignScreen;
