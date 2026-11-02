import {type AdminConfigResponse, useAdminRpc, useAdminRpcQuery} from "@terreno/admin-frontend";
import {useSession} from "@terreno/syncdb/auth";
import {Box, Spinner} from "@terreno/ui";
import {useGlobalSearchParams, usePathname, useRouter} from "expo-router";
import React, {useEffect, useMemo} from "react";
import {useAppConfig} from "./AppConfigGate";
import {AdminGateConfigProvider} from "./adminGateConfig";
import {
  type AdminGateDecision,
  buildRoutePath,
  isForbiddenAdminConfigError,
  resolveAdminGate,
} from "./adminGateUtils";

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
  const searchParams = useGlobalSearchParams<Record<string, string | string[]>>();
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

  const currentPath = buildRoutePath({params: searchParams, pathname});
  const decision = useMemo(
    (): AdminGateDecision =>
      resolveAdminGate({
        currentPath,
        isAdmin,
        isAuthenticated,
        isAuthLoading,
        isConfigLoading,
        isForbidden,
        pathname,
        returnTo: searchParams.returnTo,
        status,
      }),
    [
      currentPath,
      isAdmin,
      isAuthenticated,
      isAuthLoading,
      isConfigLoading,
      isForbidden,
      pathname,
      searchParams.returnTo,
      status,
    ]
  );

  // Drive redirects from auth + authorization state.
  useEffect(() => {
    if (decision.kind === "redirect") {
      router.replace(decision.target);
    }
  }, [decision, router]);

  if (decision.kind === "loading") {
    return <LoadingScreen />;
  }
  if (decision.kind === "redirect" && !decision.render) {
    return <LoadingScreen />;
  }
  // Only a loaded config is shared; login, forbidden, and signed-in-only routes get none.
  return (
    <AdminGateConfigProvider config={isAdmin ? (config ?? null) : null}>
      {children}
    </AdminGateConfigProvider>
  );
};
