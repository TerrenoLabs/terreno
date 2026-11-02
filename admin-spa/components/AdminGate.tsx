import {useAdminConfig} from "@terreno/admin-frontend";
import {selectBetterAuthIsAuthenticated, selectBetterAuthIsLoading} from "@terreno/rtk";
import {Box, Spinner} from "@terreno/ui";
import {useGlobalSearchParams, usePathname, useRouter} from "expo-router";
import React, {useEffect, useMemo} from "react";
import {useDispatch, useSelector} from "react-redux";
import {terrenoApi} from "../store/sdk";
import {useAppConfig} from "./AppConfigGate";
import {
  type AdminGateDecision,
  buildRoutePath,
  isForbiddenAdminConfigError,
  resolveAdminGate,
} from "./adminGateUtils";
import {useAuth} from "./StoreProvider";

interface RtkError {
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
 * Auth + authorization gate. Syncs the better-auth session on mount, then:
 * - unauthenticated → redirect to /login
 * - authenticated but NOT an admin (admin API returns 403) → redirect to /forbidden
 * - authenticated admin sitting on /login or /forbidden → redirect to /
 * - authenticated user on /login?returnTo=<in-app path> → redirect to that path
 * - signed-in-only routes (MCP OAuth consent) → any signed-in user, no admin check;
 *   signed-out users go to /login?returnTo=<this route> and come back
 *
 * Admin status is determined by the backend's own authorization on `${adminApiBase}/config`
 * (200 = admin, 403 = forbidden), since the better-auth session does not carry the
 * Terreno `admin` flag.
 */
export const AdminGate: React.FC<{children: React.ReactNode}> = ({children}) => {
  const dispatch = useDispatch();
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useGlobalSearchParams<Record<string, string | string[]>>();
  const {appConfig} = useAppConfig();
  const {syncSession} = useAuth();

  const isAuthLoading = useSelector(selectBetterAuthIsLoading);
  const isAuthenticated = useSelector(selectBetterAuthIsAuthenticated);

  const apiBase = appConfig.adminApiBasePath ?? "/admin";
  const {config, isLoading: isConfigLoading, error} = useAdminConfig(terrenoApi, apiBase);
  const status = (error as RtkError | undefined)?.status;
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

  // Sync the better-auth session into Redux once on mount.
  useEffect(() => {
    void syncSession(dispatch);
  }, [dispatch, syncSession]);

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
  return children;
};
