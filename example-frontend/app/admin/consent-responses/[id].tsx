import {ConsentResponseViewer} from "@terreno/admin-frontend";
import {Box, Button} from "@terreno/ui";
import {type Href, useLocalSearchParams, useRouter} from "expo-router";
import type React from "react";
import {useCallback} from "react";
import {useGetAdminConsentResponsesByIdQuery} from "@/store/openApiSdk";
import {terrenoApi} from "@/store/sdk";

const ADMIN_BASE_URL = "/admin";

const ConsentResponseScreen: React.FC = () => {
  const {id} = useLocalSearchParams<{id: string}>();
  const router = useRouter();
  const {data: response} = useGetAdminConsentResponsesByIdQuery(id, {skip: !id});
  const responseUser = response?.userId as {_id?: string} | string | undefined;
  const userId = typeof responseUser === "object" ? responseUser?._id : responseUser;

  const handleOpenSigner = useCallback((): void => {
    if (!userId) {
      return;
    }
    router.push(`/consent-sign/${userId}` as Href);
  }, [router, userId]);

  return (
    <Box flex="grow">
      {Boolean(userId) && (
        <Box alignItems="end" paddingX={4} paddingY={2}>
          <Button
            iconName="file-signature"
            onClick={handleOpenSigner}
            testID="consent-response-sign-on-behalf-button"
            text="Sign consent on behalf of this user"
            variant="outline"
          />
        </Box>
      )}
      <ConsentResponseViewer api={terrenoApi} baseUrl={ADMIN_BASE_URL} id={id} />
    </Box>
  );
};

export default ConsentResponseScreen;
