import {ConsentResponseViewer, useAdminModelApi} from "@terreno/admin-frontend";
import {Box, Button} from "@terreno/ui";
import {type Href, useLocalSearchParams, useRouter} from "expo-router";
import type React from "react";
import {useCallback} from "react";

const ADMIN_BASE_URL = "/admin";

interface ConsentResponseUser {
  _id?: string;
}

const ConsentResponseScreen: React.FC = () => {
  const {id} = useLocalSearchParams<{id: string}>();
  const router = useRouter();
  // The same read the viewer makes: it unwraps the admin `{data}` envelope.
  const {useReadQuery} = useAdminModelApi(`${ADMIN_BASE_URL}/consent-responses`, "ConsentResponse");
  const {data: response} = useReadQuery<{userId?: ConsentResponseUser | string}>(id, {
    skip: !id,
  });
  const responseUser = response?.userId;
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
      <ConsentResponseViewer baseUrl={ADMIN_BASE_URL} id={id} />
    </Box>
  );
};

export default ConsentResponseScreen;
