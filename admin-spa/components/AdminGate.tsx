import {type AdminConfigResponse, useAdminRpc, useAdminRpcQuery} from "@terreno/admin-frontend";
import {useSession} from "@terreno/syncdb/auth";
import {Box, Spinner} from "@terreno/ui";
import {usePathname, useRouter} from "expo-router";
import React, {useEffect} from "react";
import {useAppConfig} from "./AppConfigGate";
import {AdminGateConfigProvider} from "./adminGateConfig";
import {isForbiddenAdminConfigError} from "./adminGateUtils";

interface AdminRequestError {
  status?: number;
}

const LoadingScreen: React.FC = () => (
  <Box
    alignItems="center"
    justifyContent="center"
    padding={6}
    testID="admin-spa-admin-gate-loading"
  >
    <Spinner />
  </Box>
);

/**
 * Auth + authorization gate. Reads the Better Auth session from `SessionProvider` (which
 * syncs it on mount and whenever Better Auth's session signal fires), then:
 * - unauthenticated → redirect to /login
 * - authenticated but NOT an admin (admin API returns 403) → redirect to /forbidden
 * - authenticated admin sitting on /login or /forbidden → redirect to /
 *
 * Admin status is determined by the backend's own authorization on `${adminApiBase}/config`
 * (200 = admin, 403 = forbidden), since the better-auth session does not carry the
 * Terreno `admin` flag.
 */
export const AdminGate: React.FC<{children: React.ReactNode}> = ({children}) => {
  const router = useRouter();
  const pathname = usePathname();
  const {appConfig} = useAppConfig();
  const {isAuthenticated, isLoading: isAuthLoading} = useSession();

  const apiBase = appConfig.adminApiBasePath ?? "/admin";
  const rpc = useAdminRpc();
  // Probe `/admin/config` only with a session so signing in starts a fresh request.
  const configQuery = useAdminRpcQuery<AdminConfigResponse>({
    rpc,
    skip: !isAuthenticated,
    url: `${apiBase}/config`,
  });
  const {data: config, error} = configQuery;
  // A signed-in session has no answer yet until the probe resolves or fails.
  const isConfigLoading = configQuery.isLoading || (isAuthenticated && !config && !error);
  const status = (error as AdminRequestError | null | undefined)?.status;
  const isForbidden = isForbiddenAdminConfigError({
    error,
    isAuthenticated,
    isConfigLoading,
    status,
  });
  const isAdmin = isAuthenticated && !isConfigLoading && !error && Boolean(config);

  // Drive redirects from auth + authorization state.
  useEffect(() => {
    if (isAuthLoading) {
      return;
    }
    if (!isAuthenticated || status === 401) {
      if (pathname !== "/login") {
        router.replace("/login");
      }
      return;
    }
    if (isForbidden) {
      if (pathname !== "/forbidden") {
        router.replace("/forbidden");
      }
      return;
    }
    if (isAdmin && (pathname === "/login" || pathname === "/forbidden")) {
      router.replace("/");
    }
  }, [isAuthLoading, isAuthenticated, isForbidden, isAdmin, status, pathname, router]);

  if (isAuthLoading) {
    return <LoadingScreen />;
  }
  if (!isAuthenticated || status === 401) {
    return pathname === "/login" ? (
      <AdminGateConfigProvider config={null}>{children}</AdminGateConfigProvider>
    ) : (
      <LoadingScreen />
    );
  }
  if (isForbidden) {
    return pathname === "/forbidden" ? (
      <AdminGateConfigProvider config={null}>{children}</AdminGateConfigProvider>
    ) : (
      <LoadingScreen />
    );
  }
  if (isConfigLoading) {
    return <LoadingScreen />;
  }
  return <AdminGateConfigProvider config={config ?? null}>{children}</AdminGateConfigProvider>;
};
