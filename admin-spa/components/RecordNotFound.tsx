import {AdminScreenPage} from "@terreno/admin-frontend";
import {Box, Text} from "@terreno/ui";
import type React from "react";

/**
 * The page a record route shows when the server render found no such record (the backend
 * answered 404). The HTTP status stays 200: expo-server 58 sets another status only by throwing,
 * which replaces the page with an error body.
 */
export const RecordNotFound: React.FC<{backHref: string; message: string}> = ({
  backHref,
  message,
}) => (
  <AdminScreenPage
    backHref={backHref}
    color="transparent"
    maxWidth="100%"
    padding={4}
    title="Not found"
  >
    <Box testID="admin-screen-not-found">
      <Text color="error">{message}</Text>
    </Box>
  </AdminScreenPage>
);
