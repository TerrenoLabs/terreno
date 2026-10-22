import {Box, Spinner, Text} from "@terreno/ui";
import React, {useMemo} from "react";
import {AdminMigrations} from "./AdminMigrations";
import {AdminModelTable} from "./AdminModelTable";
import {useAdminWidgetRegistry} from "./AdminProvider";
import {AdminScreenPage} from "./AdminScreenPage";
import {AdminScriptList} from "./AdminScriptList";
import type {AdminScreenProps} from "./types";
import {resolveAdminBases} from "./types";
import {useAdminConfig} from "./useAdminConfig";
import {MissingWidget} from "./widgets/MissingWidget";

export interface AdminScreenRouterProps extends AdminScreenProps {
  /** Route segment: model name, custom screen name, `__scripts`, or `__migrations`. */
  name: string;
}

/**
 * Resolves an admin route segment to a registered screen widget, model table, or scripts list.
 *
 * Custom screens require a matching entry in `AdminProvider.widgets.screens`. Model routes
 * fall through to {@link AdminModelTable} when the name matches a configured model.
 */
export const AdminScreenRouter: React.FC<AdminScreenRouterProps> = ({
  name,
  baseUrl,
  apiBase,
  routeBase,
}) => {
  const {apiBase: resolvedApiBase, routeBase: resolvedRouteBase} = resolveAdminBases({
    apiBase,
    baseUrl,
    routeBase,
  });
  const {config, error, isLoading} = useAdminConfig(resolvedApiBase);
  const registry = useAdminWidgetRegistry();

  const model = useMemo(() => {
    return config?.models.find((m) => m.name === name);
  }, [config?.models, name]);

  const customScreen = useMemo(() => {
    return config?.customScreens?.find((screen) => screen.name === name);
  }, [config?.customScreens, name]);

  if (isLoading) {
    return (
      <Box alignItems="center" justifyContent="center" padding={6} testID="admin-screen-loading">
        <Spinner />
      </Box>
    );
  }

  if (error || !config) {
    return (
      <Box padding={4} testID="admin-screen-error">
        <Text color="error">Failed to load admin configuration.</Text>
      </Box>
    );
  }

  if (name === "__scripts") {
    return <AdminScriptList apiBase={resolvedApiBase} routeBase={resolvedRouteBase} />;
  }

  if (name === "__migrations") {
    return <AdminMigrations apiBase={resolvedApiBase} routeBase={resolvedRouteBase} />;
  }

  if (model) {
    return (
      <AdminModelTable apiBase={resolvedApiBase} modelName={name} routeBase={resolvedRouteBase} />
    );
  }

  const ScreenWidget = registry.screens[name];
  if (ScreenWidget) {
    return (
      <ScreenWidget
        apiBase={resolvedApiBase}
        config={config}
        routeBase={resolvedRouteBase}
        screenName={name}
      />
    );
  }

  if (customScreen) {
    return (
      <AdminScreenPage
        backHref={resolvedRouteBase}
        color="transparent"
        maxWidth="100%"
        padding={4}
        title={customScreen.displayName}
      >
        <MissingWidget bucket="screens" widgetId={name} />
      </AdminScreenPage>
    );
  }

  return (
    <AdminScreenPage
      backHref={resolvedRouteBase}
      color="transparent"
      maxWidth="100%"
      padding={4}
      title="Not found"
    >
      <Box testID="admin-screen-not-found">
        <Text color="error">{`No admin screen or model registered for "${name}".`}</Text>
      </Box>
    </AdminScreenPage>
  );
};
