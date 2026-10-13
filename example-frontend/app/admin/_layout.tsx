import {
  AdminProvider,
  type AdminScreenWidgetProps,
  AdminShellLayout,
  AiPromptEditorScreenWidget,
  AiTracesScreenWidget,
  OrgContextProvider,
  OrgSwitcher,
  organizationFromPath,
  useOptionalOrgContext,
} from "@terreno/admin-frontend";
import {baseUrl, canOpenAdminPage, selectBetterAuthUserId} from "@terreno/rtk";
import {SyncDbProvider, useConflicts} from "@terreno/syncdb/react";
import {Box, Spinner, Text, useStoredState} from "@terreno/ui";
import {Stack, usePathname} from "expo-router";
import React, {useEffect, useMemo, useState} from "react";
import {useSelector} from "react-redux";
import {ADMIN_ROUTE} from "@/constants/adminConstants";
import {getAdminAuthHeaders} from "@/store/betterAuthApi";
import {terrenoApi, useGetMeQuery} from "@/store/sdk";
import {adminSyncDb, setAdminSyncOrganizationId} from "@/store/syncdb";
import SyncLabScreen from "./SyncLabScreen";

const PLAYGROUND_GEMINI_KEY_HINT =
  "Save a Gemini API key on the Profile tab, then return here to run the playground.";

const MULTI_STAGE_GEMINI_KEY_HINT =
  "Save a Gemini API key on the Profile tab, then return here to run the multi-stage trace test.";

const ExamplePromptEditorScreen: React.FC<AdminScreenWidgetProps> = (props) => {
  const [geminiApiKey, , isGeminiApiKeyLoading] = useStoredState<string>("geminiApiKey", "");
  return (
    <AiPromptEditorScreenWidget
      {...props}
      apiKey={geminiApiKey || undefined}
      apiKeyLoading={isGeminiApiKeyLoading}
      playgroundApiKeyHint={PLAYGROUND_GEMINI_KEY_HINT}
    />
  );
};

const ExampleTracesScreen: React.FC<AdminScreenWidgetProps> = (props) => {
  const [geminiApiKey, , isGeminiApiKeyLoading] = useStoredState<string>("geminiApiKey", "");
  return (
    <AiTracesScreenWidget
      {...props}
      apiKey={geminiApiKey || undefined}
      apiKeyHint={MULTI_STAGE_GEMINI_KEY_HINT}
      apiKeyLoading={isGeminiApiKeyLoading}
    />
  );
};

const BindAdminSyncOrganization: React.FC = () => {
  const organizationId = useOptionalOrgContext()?.organizationId;

  // Keep admin-window mutate payloads on the currently selected organization.
  useEffect(() => {
    setAdminSyncOrganizationId(organizationId);
    return (): void => {
      setAdminSyncOrganizationId(undefined);
    };
  }, [organizationId]);

  return null;
};

/**
 * Admin UI v2 shell for the whole `/admin/**` stack: sidebar (models, tools, screens) + main
 * column (stack navigator). `admin:access` is the only permission that opens this page.
 */
const AdminLayoutContent: React.FC = () => {
  const userId = useSelector(selectBetterAuthUserId);
  const {data: profile, isLoading} = useGetMeQuery(undefined, {skip: !userId});
  const syncConflicts = useConflicts();
  const [isAdminSyncReady, setIsAdminSyncReady] = useState(false);
  const [adminSyncError, setAdminSyncError] = useState<string | undefined>();
  const canOpen = canOpenAdminPage({
    admin: profile?.admin,
    permissions: profile?.permissions,
  });
  const roles = profile?.roles ?? [];
  const isOrganizationOperator = roles.includes("operator") || roles.includes("superadmin");
  const pathname = usePathname();
  const routeOrganization = useMemo(() => organizationFromPath(pathname), [pathname]);

  // Admin uses a separate window-mode client so admin rows never pollute the
  // owner-scoped product store and the socket can join `{collection}|admin`.
  useEffect(() => {
    if (!userId || isLoading || !canOpen) {
      return;
    }
    let isStopped = false;
    setIsAdminSyncReady(false);
    setAdminSyncError(undefined);
    adminSyncDb
      .start()
      .then(() => {
        if (!isStopped) {
          setAdminSyncError(undefined);
          setIsAdminSyncReady(true);
        }
      })
      .catch((error: unknown) => {
        if (!isStopped) {
          setAdminSyncError(error instanceof Error ? error.message : String(error));
        }
      });
    return (): void => {
      isStopped = true;
      void adminSyncDb.stop();
    };
  }, [canOpen, isLoading, userId]);

  if (userId && isLoading) {
    return (
      <Box
        alignItems="center"
        flex="grow"
        justifyContent="center"
        padding={6}
        testID="admin-page-loading"
      >
        <Spinner />
      </Box>
    );
  }

  if (userId && !canOpen) {
    return (
      <Box padding={4} testID="admin-page-forbidden">
        <Text>
          You do not have permission to open the admin page. Grant the admin:access permission.
        </Text>
      </Box>
    );
  }

  if (userId && !isAdminSyncReady) {
    return (
      <Box alignItems="center" flex="grow" justifyContent="center" padding={6}>
        {adminSyncError ? (
          <Text testID="admin-sync-error">Admin sync could not start: {adminSyncError}</Text>
        ) : (
          <Spinner />
        )}
      </Box>
    );
  }

  return (
    <AdminProvider
      api={terrenoApi}
      apiBase={ADMIN_ROUTE}
      apiOrigin={baseUrl}
      getAuthHeaders={getAdminAuthHeaders}
      routeBase={ADMIN_ROUTE}
      syncConflicts={syncConflicts}
      syncDb={adminSyncDb}
      widgets={{
        screens: {
          "ai-prompt-editor": ExamplePromptEditorScreen,
          "ai-traces": ExampleTracesScreen,
          "sync-lab": SyncLabScreen,
        },
      }}
    >
      <OrgContextProvider initialOrganization={routeOrganization}>
        <BindAdminSyncOrganization />
        <AdminShellLayout
          api={terrenoApi}
          apiBase={ADMIN_ROUTE}
          configurationPath="/admin/configuration"
          isOrganizationOperator={isOrganizationOperator}
          organizationDirectoryPath="/orgs"
          organizationSwitcher={<OrgSwitcher api={terrenoApi} routeBase={ADMIN_ROUTE} />}
          rolesPath="/roles"
          routeBase={ADMIN_ROUTE}
          versionConfigPath="/version-config"
        >
          <Stack
            screenOptions={{
              contentStyle: {flex: 1},
              headerShown: false,
            }}
          >
            <Stack.Screen name="index" options={{title: "Admin"}} />
            <Stack.Screen name="showcase" options={{title: "Admin UI v2 map"}} />
            <Stack.Screen name="configuration" options={{title: "Configuration"}} />
            <Stack.Screen name="roles" options={{title: "Roles"}} />
            <Stack.Screen name="announcements/index" options={{title: "Announcements"}} />
            <Stack.Screen name="consent-forms/index" options={{title: "Consent forms"}} />
            <Stack.Screen name="consent-responses/index" options={{title: "Consent responses"}} />
            <Stack.Screen name="orgs/index" options={{title: "Organizations"}} />
            <Stack.Screen name="orgs/[orgId]/index" options={{title: "Organization settings"}} />
            <Stack.Screen name="orgs/[orgId]/members" options={{title: "Organization members"}} />
            <Stack.Screen name="[model]" options={{title: "Model"}} />
          </Stack>
        </AdminShellLayout>
      </OrgContextProvider>
    </AdminProvider>
  );
};

const AdminLayout: React.FC = () => (
  <SyncDbProvider client={adminSyncDb}>
    <AdminLayoutContent />
  </SyncDbProvider>
);

export default AdminLayout;
