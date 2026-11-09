import {
  AdminProvider,
  AdminRpcSeed,
  adminRpcSeedKey,
  type OrganizationSummary,
  OrgContextProvider,
  organizationFromPath,
  useOptionalOrgContext,
} from "@terreno/admin-frontend";
import {createSyncDb, type SyncDb} from "@terreno/syncdb";
import {useSession} from "@terreno/syncdb/auth";
import {SyncDbProvider, useConflicts} from "@terreno/syncdb/react";
import {Box, Spinner, TerrenoProvider, Text} from "@terreno/ui";
import {Stack, usePathname} from "expo-router";
import React, {useEffect, useMemo, useState} from "react";
import {AdminGate} from "../components/AdminGate";
import {AppConfigGate, useAppConfig} from "../components/AppConfigGate";
import {useAdminGateConfig} from "../components/adminGateConfig";
import {isSignedInOnlyRoute} from "../components/adminGateUtils";
import {resolveAdminSpaOrigin, StoreProvider, useAuthClient} from "../components/StoreProvider";
import {useSsrPayload} from "../components/ssrPayload";
import {isAdminSpaServerRender} from "../src/serverContext";
import {
  createAdminSpaSyncDbConfig,
  resolveAdminSyncCollections,
  setSpaAdminOrganizationId,
} from "../store/adminSyncDb";

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
  /** A server render already decided access: render the shell now, start sync behind it. */
  isServerRendered: boolean;
  routeOrganization?: OrganizationSummary;
}> = ({apiBase, children, client, isServerRendered, routeOrganization}) => {
  const syncConflicts = useConflicts();
  const [isReady, setIsReady] = useState(false);
  const [startError, setStartError] = useState<string | undefined>();

  // Start the cookie-authenticated window client only while the authorized SPA is mounted
  // in a browser; a server render never opens a socket or local store.
  useEffect(() => {
    if (isAdminSpaServerRender()) {
      return;
    }
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

  // Without a server render, wait for sync as before. With one, show the shell at once.
  if (!isReady && !isServerRendered) {
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
      apiBase={apiBase}
      credentials="same-origin"
      routeBase=""
      syncConflicts={syncConflicts}
      // Windowed tables bind to the sync store only after start() resolves; until then they
      // read the REST list (seeded by the route loader). A window registered before start
      // never receives live updates, and writes must wait for start.
      syncDb={isReady ? client : undefined}
    >
      {startError ? (
        <Text testID="admin-spa-sync-error">Admin sync could not start: {startError}</Text>
      ) : null}
      <OrgContextProvider initialOrganization={routeOrganization}>
        <BindSpaAdminOrganization />
        {children}
      </OrgContextProvider>
    </AdminProvider>
  );
};

const AdminProviderBridge: React.FC<{children: React.ReactNode}> = ({children}) => {
  const {appConfig} = useAppConfig();
  const authClient = useAuthClient();
  const pathname = usePathname();
  const isServerRendered = Boolean(useSsrPayload());
  const routeOrganization = useMemo(() => organizationFromPath(pathname), [pathname]);
  const apiBase = appConfig.adminApiBasePath ?? "/admin";
  // Use the config AdminGate already loaded. Fetching it again here would render the
  // Stack once without syncDb, then swap providers when the response lands, remounting
  // the Stack and resetting deep links like `/Todo` to `/`.
  const config = useAdminGateConfig();
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
        origin: resolveAdminSpaOrigin(),
      })
    );
  }, [authClient, syncCollectionsKey]);

  if (client) {
    return (
      <SyncDbProvider client={client}>
        <SyncEnabledAdminProvider
          apiBase={apiBase}
          client={client}
          isServerRendered={isServerRendered}
          routeOrganization={routeOrganization}
        >
          {children}
        </SyncEnabledAdminProvider>
      </SyncDbProvider>
    );
  }

  return (
    <AdminProvider apiBase={apiBase} credentials="same-origin" routeBase="">
      <OrgContextProvider initialOrganization={routeOrganization}>
        <BindSpaAdminOrganization />
        {children}
      </OrgContextProvider>
    </AdminProvider>
  );
};

/**
 * Seeds `${apiBase}/config` from the server's shell payload, so AdminGate and every config
 * reader below it render from it on the first render instead of fetching it again.
 */
const AdminConfigSeed: React.FC<{children: React.ReactNode}> = ({children}) => {
  const payload = useSsrPayload();
  const {userId} = useSession();
  const {appConfig} = useAppConfig();
  const apiBase = appConfig.adminApiBasePath ?? "/admin";
  // The config is filtered per user: it seeds only while the session it was read for is live,
  // so a later sign-in on the same page fetches its own.
  const isPayloadSession = userId !== null && payload?.session?.userId === userId;
  const adminConfig = isPayloadSession ? payload?.adminConfig : undefined;
  const data = useMemo(
    (): Record<string, unknown> =>
      adminConfig ? {[adminRpcSeedKey(`${apiBase}/config`)]: adminConfig} : {},
    [adminConfig, apiBase]
  );
  return <AdminRpcSeed data={data}>{children}</AdminRpcSeed>;
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
 *   auth client is built from it.
 * - StoreProvider: builds the Better Auth client and same-origin request client, mounts
 *   SessionProvider (`useSession()`) and ApiClientProvider (`useApiQuery`).
 * - TerrenoProvider: theme/toast context.
 * - AdminProvider (cookie-bound): the same-origin fetch client AdminGate uses for
 *   `/admin/config`. AdminProviderBridge nests a second AdminProvider with syncDb.
 * - AdminConfigSeed: seeds `/admin/config` from the server's shell payload.
 * - AdminGate: session + admin authorization, gating the route Stack. It shares the loaded
 *   config with AdminProviderBridge, which picks the syncDb provider from it on first render
 *   so the Stack mounts once.
 * - AdminChrome (innermost): admin providers, skipped on signed-in-only routes.
 */
const RootLayout: React.FC = () => {
  return (
    <AppConfigGate>
      <StoreProvider>
        <TerrenoProvider>
          <AdminProvider credentials="same-origin" routeBase="">
            <AdminConfigSeed>
              <AdminGate>
                <AdminChrome>
                  <Stack screenOptions={{headerShown: false}} />
                </AdminChrome>
              </AdminGate>
            </AdminConfigSeed>
          </AdminProvider>
        </TerrenoProvider>
      </StoreProvider>
    </AppConfigGate>
  );
};

export default RootLayout;
