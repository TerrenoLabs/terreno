import {Box, Button, Heading, Spinner, Text} from "@terreno/ui";
import type {Href} from "expo-router";
import {router} from "expo-router";
import React, {useCallback, useMemo} from "react";
import {AdminScreenPage} from "./AdminScreenPage";
import {useAdminContext} from "./adminContext";
import {MemberSecurityPanel, SecurityAlert} from "./orgs/MemberSecurityPanel";
import type {AdminConfigResponse} from "./types";
import {useAdminRpc, useAdminRpcQuery} from "./useAdminRpc";

const DEFAULT_ADMIN_BASE = "/admin";
const DEFAULT_USER_MODEL_NAME = "User";

export interface UserSecurityScreenProps {
  /** Base path for admin JSON requests (`{apiBase}/config`). Defaults to the AdminProvider's `apiBase`. */
  apiBase?: string;
  /** Where the back arrow goes. Defaults to the admin user record, `{routeBase}/{userModelName}/{userId}`. */
  backHref?: string;
  /** Base path for in-app admin navigation. Defaults to the AdminProvider's `routeBase`. */
  routeBase?: string;
  /** Route prefix of the platform security routes. Defaults to `/users` (`/users/:id/security`). */
  securityBaseURL?: string;
  testID?: string;
  /** The user whose sign-in security is shown. */
  userId: string;
  /** Admin model name of the user record, for the header and back link. Defaults to `User`. */
  userModelName?: string;
}

interface AdminUserRecord {
  email?: unknown;
  name?: unknown;
}

const unwrapData = <T,>(body: unknown): T | undefined => {
  if (body && typeof body === "object" && "data" in body) {
    return (body as {data: T}).data;
  }
  return body as T | undefined;
};

const stringField = (value: unknown): string | undefined =>
  typeof value === "string" && value.trim().length > 0 ? value : undefined;

/**
 * Admin route of a user's security screen: `{routeBase}/users/{userId}/security`. Hosts mount
 * {@link UserSecurityScreen} at this path so {@link UserSecurityLink} reaches it.
 */
export const userSecurityRoute = ({
  routeBase = DEFAULT_ADMIN_BASE,
  userId,
}: {
  routeBase?: string;
  userId: string;
}): string => `${routeBase}/users/${encodeURIComponent(userId)}/security`;

export interface UserSecurityLinkProps {
  /** Overrides the target route. Defaults to {@link userSecurityRoute}. */
  href?: string;
  /** Base path for in-app admin navigation. Defaults to the AdminProvider's `routeBase`. */
  routeBase?: string;
  testID?: string;
  userId: string;
}

/**
 * "Security" button for an admin user record, such as in `AdminModelForm` `footerContent`. Render
 * it only for staff who hold `user:manageSecurity`; the routes refuse everyone else.
 */
export const UserSecurityLink: React.FC<UserSecurityLinkProps> = ({
  href,
  routeBase,
  testID = "admin-user-security-link",
  userId,
}) => {
  const adminContext = useAdminContext();
  const target =
    href ??
    userSecurityRoute({routeBase: routeBase ?? adminContext?.routeBase ?? undefined, userId});
  const handleOpen = useCallback((): void => {
    router.push(target as Href);
  }, [target]);

  return (
    <Box direction="row">
      <Button
        accessibilityLabel="Security: sign-in methods and account recovery"
        iconName="shield-halved"
        onClick={handleOpen}
        testID={testID}
        text="Security"
        variant="outline"
      />
    </Box>
  );
};

/**
 * Platform staff view of one user's sign-in security: a header naming the user from their admin
 * record, then {@link MemberSecurityPanel} against the platform `/users/:id/security` routes.
 * Holders of `user:manageSecurity` (superadmin, operator) reach those routes; the server refuses
 * self-targeting and targets holding permissions the caller lacks.
 */
export const UserSecurityScreen: React.FC<UserSecurityScreenProps> = ({
  apiBase,
  backHref,
  routeBase,
  securityBaseURL,
  testID = "user-security-screen",
  userId,
  userModelName = DEFAULT_USER_MODEL_NAME,
}) => {
  const adminContext = useAdminContext();
  const rpc = useAdminRpc();
  const resolvedApiBase = apiBase ?? adminContext?.apiBase ?? DEFAULT_ADMIN_BASE;
  const resolvedRouteBase = routeBase ?? adminContext?.routeBase ?? DEFAULT_ADMIN_BASE;

  const configQuery = useAdminRpcQuery<AdminConfigResponse>({
    rpc,
    skip: !rpc,
    url: `${resolvedApiBase}/config`,
  });
  const userModel = useMemo(
    () => configQuery.data?.models?.find((model) => model.name === userModelName),
    [configQuery.data, userModelName]
  );
  const userQuery = useAdminRpcQuery<unknown>({
    rpc,
    skip: !rpc || !userModel || !userId,
    url: userModel ? `${userModel.routePath}/${encodeURIComponent(userId)}` : "",
  });
  const record = unwrapData<AdminUserRecord>(userQuery.data);
  const name = stringField(record?.name);
  const email = stringField(record?.email);
  const label = name ?? email ?? userId;
  const isRecordLoading =
    configQuery.isLoading || (Boolean(userModel) && userQuery.isLoading && !record);
  const recordError = configQuery.error || userQuery.error;

  return (
    <AdminScreenPage
      backHref={backHref ?? `${resolvedRouteBase}/${userModelName}/${encodeURIComponent(userId)}`}
      color="transparent"
      maxWidth="100%"
      padding={0}
      testID={testID}
      title="User security"
    >
      <Box gap={4} padding={4}>
        <Box gap={1} testID={`${testID}-header`}>
          {isRecordLoading ? (
            <Box alignItems="start" testID={`${testID}-user-loading`}>
              <Spinner />
            </Box>
          ) : (
            <>
              <Heading size="md" testID={`${testID}-user-name`}>
                {label}
              </Heading>
              {email && email !== label ? (
                <Text color="secondaryDark" testID={`${testID}-user-email`}>
                  {email}
                </Text>
              ) : null}
            </>
          )}
          {recordError && !isRecordLoading ? (
            <SecurityAlert
              message="Could not load the user record."
              testID={`${testID}-user-error`}
            />
          ) : null}
        </Box>
        <MemberSecurityPanel
          baseURL={securityBaseURL}
          focusOnMount={false}
          key={userId}
          testID={`${testID}-panel`}
          userId={userId}
        />
      </Box>
    </AdminScreenPage>
  );
};
