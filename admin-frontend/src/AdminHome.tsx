import {Box, Heading, isSupportedDesktopWidth, Page, Spinner, Text} from "@terreno/ui";
import React, {useMemo} from "react";
import {useWindowDimensions} from "react-native";
import {useHomeWidget} from "./AdminProvider";
import {isAuditLogModel} from "./isAuditLogModel";
import type {AdminApi, AdminModelConfig} from "./types";
import {resolveAdminBases} from "./types";
import {useAdminConfig} from "./useAdminConfig";
import {normalizeSidebarWidgets, normalizeWidgetIds} from "./widgets/homeWidgetUtils";
import {MissingWidget} from "./widgets/MissingWidget";

interface AdminHomeProps {
  /** @deprecated Use `apiBase`/`routeBase`. */
  baseUrl?: string;
  apiBase?: string;
  routeBase?: string;
  api: AdminApi;
  /**
   * When true, omits the outer {@link Page} wrapper so the dashboard can sit under a parent
   * screen (for example, the Expo admin index together with tools and model cards).
   */
  embedded?: boolean;
}

const HomeSlotWidget: React.FC<{
  api: AdminApi;
  apiBase: string;
  auditModel?: AdminModelConfig;
  config: NonNullable<ReturnType<typeof useAdminConfig>["config"]>;
  featureFlagModel?: AdminModelConfig;
  models: AdminModelConfig[];
  routeBase: string;
  widgetId: string;
}> = ({api, apiBase, auditModel, config, featureFlagModel, models, routeBase, widgetId}) => {
  const Widget = useHomeWidget(widgetId);
  if (!Widget) {
    return <MissingWidget bucket="home" widgetId={widgetId} />;
  }
  return (
    <Widget
      api={api}
      apiBase={apiBase}
      auditModel={auditModel}
      config={config}
      featureFlagModel={featureFlagModel}
      models={models}
      routeBase={routeBase}
    />
  );
};

/**
 * Config-driven admin home dashboard: renders `home.slots` from `/admin/config` using the
 * three-bucket widget registry (`AdminProvider.widgets.home` + built-ins).
 */
export const AdminHome: React.FC<AdminHomeProps> = ({
  baseUrl,
  apiBase,
  routeBase,
  api,
  embedded = false,
}) => {
  const {width: windowWidth} = useWindowDimensions();
  const isDesktopLayout = !embedded && isSupportedDesktopWidth({width: windowWidth});
  const {apiBase: resolvedApiBase, routeBase: resolvedRouteBase} = resolveAdminBases({
    apiBase,
    baseUrl,
    routeBase,
  });
  const {config, error, isLoading} = useAdminConfig(api, resolvedApiBase);

  const models = (config?.models ?? []) as AdminModelConfig[];
  const auditModel = useMemo(() => models.find(isAuditLogModel), [models]);
  const featureFlagModel = useMemo(
    () => models.find((m) => m.name === "FeatureFlag" || m.displayName === "Feature Flags"),
    [models]
  );

  const slots = config?.home?.slots;
  const navGlobal = normalizeWidgetIds(slots?.navGlobal);
  const contentTop = normalizeWidgetIds(slots?.contentTop);
  const topBandWidgetIds = useMemo(() => [...navGlobal, ...contentTop], [navGlobal, contentTop]);
  const main = normalizeWidgetIds(slots?.main);
  const sidebar = normalizeSidebarWidgets(slots?.sidebar);

  if (isLoading) {
    const loadingBody = (
      <Box alignItems="center" justifyContent="center" padding={6} testID="admin-home-loading">
        <Spinner />
      </Box>
    );
    if (embedded) {
      return loadingBody;
    }
    return (
      <Page color="transparent" maxWidth="100%" padding={0} title={config?.home?.title ?? "Admin"}>
        {loadingBody}
      </Page>
    );
  }

  if (error || !config) {
    const errorBody = (
      <Box padding={4} testID="admin-home-error">
        <Text color="error">Failed to load admin configuration.</Text>
      </Box>
    );
    if (embedded) {
      return errorBody;
    }
    return (
      <Page color="transparent" maxWidth="100%" padding={0} title="Admin">
        {errorBody}
      </Page>
    );
  }

  const title = config.home?.title ?? "Admin";

  const slotWidgetProps = {
    api,
    apiBase: resolvedApiBase,
    auditModel,
    config,
    featureFlagModel,
    models,
    routeBase: resolvedRouteBase,
  };

  const dashboardBody = (
    <Box gap={4} padding={0} width="100%">
      {!embedded ? <Heading size="md">{title}</Heading> : null}

      {topBandWidgetIds.length > 0 ? (
        <Box direction="row" gap={3} testID="admin-home-slot-top" wrap>
          {topBandWidgetIds.map((id) => (
            <Box key={`top-${id}`}>
              <HomeSlotWidget {...slotWidgetProps} widgetId={id} />
            </Box>
          ))}
        </Box>
      ) : null}

      <Box
        alignItems="start"
        direction={isDesktopLayout ? "row" : "column"}
        gap={4}
        testID="admin-home-columns"
      >
        {main.length > 0 ? (
          <Box
            flex="grow"
            gap={3}
            minWidth={isDesktopLayout ? 280 : 0}
            testID="admin-home-slot-main"
            {...(isDesktopLayout ? {} : {width: "100%"})}
          >
            {main.map((id) => (
              <Box key={`mn-${id}`}>
                <HomeSlotWidget {...slotWidgetProps} widgetId={id} />
              </Box>
            ))}
          </Box>
        ) : null}
        {sidebar.length > 0 ? (
          <Box
            direction="column"
            gap={3}
            minWidth={isDesktopLayout ? 280 : 0}
            testID="admin-home-slot-sidebar"
            width={isDesktopLayout ? 320 : "100%"}
          >
            {sidebar.map((id) => (
              <Box key={`sb-${id}`}>
                <HomeSlotWidget {...slotWidgetProps} widgetId={id} />
              </Box>
            ))}
          </Box>
        ) : null}
      </Box>
    </Box>
  );

  if (embedded) {
    return dashboardBody;
  }

  return (
    <Page color="transparent" maxWidth="100%" padding={0} scroll title={title}>
      {dashboardBody}
    </Page>
  );
};
