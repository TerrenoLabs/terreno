import {AdminScreenPage, UserSecurityScreen} from "@terreno/admin-frontend";
import {Box, Spinner, Text} from "@terreno/ui";
import {useLocalSearchParams} from "expo-router";
import React from "react";
import {ADMIN_ROUTE} from "@/constants/adminConstants";
import {useGetMeQuery} from "@/store/sdk";
import {canManageUserSecurity} from "@/utils/userSecurityAccess";

/**
 * Platform account recovery for one user, linked from the admin User record. Only staff holding
 * `user:manageSecurity` (superadmin, operator) see it; the server enforces the same rule.
 */
const AdminUserSecurityRoute: React.FC = () => {
  const {id} = useLocalSearchParams<{id: string}>();
  const {data: profile, isLoading} = useGetMeQuery();

  if (isLoading) {
    return (
      <Box alignItems="center" padding={6} testID="admin-user-security-loading">
        <Spinner />
      </Box>
    );
  }

  if (!canManageUserSecurity({admin: profile?.admin, permissions: profile?.permissions})) {
    return (
      <AdminScreenPage
        backHref={`${ADMIN_ROUTE}/User/${id}`}
        color="transparent"
        maxWidth="100%"
        padding={0}
        testID="admin-user-security-forbidden"
        title="User security"
      >
        <Box padding={4}>
          <Text>
            You do not have permission to manage account security. Grant the user:manageSecurity
            permission.
          </Text>
        </Box>
      </AdminScreenPage>
    );
  }

  return <UserSecurityScreen routeBase={ADMIN_ROUTE} userId={id} userModelName="User" />;
};

export default AdminUserSecurityRoute;
