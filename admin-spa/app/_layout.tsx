import {
  AdminProvider,
  type OrganizationSummary,
  OrgContextProvider,
  organizationFromPath,
  useAdminConfig,
  useOptionalOrgContext,
} from "@terreno/admin-frontend";
import {createSyncDb, type SyncDb} from "@terreno/syncdb";
import {SyncDbProvider, useConflicts} from "@terreno/syncdb/react";
import {Box, Spinner, TerrenoProvider, Text} from "@terreno/ui";
import {Stack, usePathname} from "expo-router";
import React, {useEffect, useMemo, useState} from "react";
import {AdminGate} from "../components/AdminGate";
import {AppConfigGate, useAppConfig} from "../components/AppConfigGate";
import {isSignedInOnlyRoute} from "../components/adminGateUtils";
import {StoreProvider, useAuth} from "../components/StoreProvider";
import {
  createAdminSpaSyncDbConfig,
  resolveAdminSyncCollections,
  setSpaAdminOrganizationId,
} from "../store/adminSyncDb";
import {terrenoApi} from "../store/sdk";

const SPA_ADMIN_AUTH_HEADERS = (): HeadersInit => ({});

const BindSpaAdminOrganization: React.FC = () => {
  const organizationId = useOptionalOrgContext()?.organizationId;

  // Keep admin-window mutate payloads on the currently selected organization.
  useEffect(() => {
    setSpaAdminOrganizationId(organizationId);
    return (): void => {
      setSpaAdminOrganizationId(undefined);
    };
  }, [organizationId]);

  return null;
};

const SyncEnabledAdminProvider: React.FC<{
  apiBase: string;
  children: React.ReactNode;
  client: SyncDb;
  routeOrganization?: OrganizationSummary;
}> = ({apiBase, children, client, routeOrganization}) => {
  const syncConflicts = useConflicts();
  const [isReady, setIsReady] = useState(false);
  const [startError, setStartError] = useState<string | undefined>();

  // Start the cookie-authenticated window client only while the authorized SPA is mounted.
  useEffect(() => {
    let isStopped = false;
    client
      .start()
      .then(() => {
        if (!isStopped) {
          setIsReady(true);
          setStartError(undefined);
        }
      })
      .catch((error: unknown) => {
        if (!isStopped) {
          setStartError(error instanceof Error ? error.message : String(error));
        }
      });
    return (): void => {
      isStopped = true;
      void client.stop();
    };
  }, [client]);

  if (!isReady) {
    return (
      <Box alignItems="center" justifyContent="center" padding={6}>
        {startError ? (
          <Text testID="admin-spa-sync-error">Admin sync could not start: {startError}</Text>
        ) : (
          <Spinner />
        )}
      </Box>
    );
  }

  return (
    <AdminProvider
      api={terrenoApi}
      apiBase={apiBase}
      credentials="same-origin"
      getAuthHeaders={SPA_ADMIN_AUTH_HEADERS}
      routeBase=""
      syncConflicts={syncConflicts}
      syncDb={client}
    >
      <OrgContextProvider initialOrganization={routeOrganization}>
        <BindSpaAdminOrganization />
        {children}
      </OrgContextProvider>
    </AdminProvider>
  );
};

const AdminProviderBridge: React.FC<{children: React.ReactNode}> = ({children}) => {
  const {appConfig} = useAppConfig();
  const {authClient} = useAuth();
  const pathname = usePathname();
  const routeOrganization = useMemo(() => organizationFromPath(pathname), [pathname]);
  const apiBase = appConfig.adminApiBasePath ?? "/admin";
  const {config} = useAdminConfig(terrenoApi, apiBase);
  const syncCollections = useMemo(
    (): string[] => resolveAdminSyncCollections(config?.models ?? []),
    [config?.models]
  );
  const syncCollectionsKey = syncCollections.join("|");
  const client = useMemo((): SyncDb | undefined => {
    const collections = syncCollectionsKey.split("|").filter(Boolean);
    if (collections.length === 0) {
      return undefined;
    }
    return createSyncDb(
      createAdminSpaSyncDbConfig({
        authClient,
        collections,
        origin: typeof window === "undefined" ? "http://localhost:4000" : window.location.origin,
      })
    );
  }, [authClient, syncCollectionsKey]);

  if (client) {
    return (
      <SyncDbProvider client={client}>
        <SyncEnabledAdminProvider
          apiBase={apiBase}
          client={client}
          routeOrganization={routeOrganization}
        >
          {children}
        </SyncEnabledAdminProvider>
      </SyncDbProvider>
    );
  }

  return (
    <AdminProvider
      api={terrenoApi}
      apiBase={apiBase}
      credentials="same-origin"
      getAuthHeaders={SPA_ADMIN_AUTH_HEADERS}
      routeBase=""
    >
      <OrgContextProvider initialOrganization={routeOrganization}>
        <BindSpaAdminOrganization />
        {children}
      </OrgContextProvider>
    </AdminProvider>
  );
};

/**
 * Signed-in-only routes (MCP OAuth consent) render without the admin providers, so a
 * non-admin never starts the admin sync client or the admin org context.
 */
const AdminChrome: React.FC<{children: React.ReactNode}> = ({children}) => {
  const pathname = usePathname();
  if (isSignedInOnlyRoute(pathname)) {
    return children;
  }
  return <AdminProviderBridge>{children}</AdminProviderBridge>;
};

/**
 * Provider order:
 * - AppConfigGate (outermost): loads app-config.json before anything else, since the
 *   store + auth client are built from it.
 * - StoreProvider: builds the better-auth client + Redux store, mounts <Provider>.
 * - TerrenoProvider: theme/toast context (inside Provider so theme hooks work).
 * - AdminGate: session + admin authorization, gating the route Stack.
 * - AdminChrome (innermost): admin providers, skipped on signed-in-only routes.
 */
const RootLayout: React.FC = () => {
  return (
    <AppConfigGate>
      <StoreProvider>
        <TerrenoProvider>
          <AdminGate>
            <AdminChrome>
              <Stack screenOptions={{headerShown: false}} />
            </AdminChrome>
          </AdminGate>
        </TerrenoProvider>
      </StoreProvider>
    </AppConfigGate>
  );
};

export default RootLayout;
