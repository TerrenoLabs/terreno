import {Box, Card, Heading, Page, Spinner, Text} from "@terreno/ui";
import type {Href} from "expo-router";
import {router} from "expo-router";
import React, {useCallback} from "react";
import {useDeprecatedCustomScreensProp} from "./AdminProvider";
import {type AdminCustomScreen, type AdminModelConfig, resolveAdminBases} from "./types";
import {useAdminConfig} from "./useAdminConfig";

interface AdminModelListProps {
  /** @deprecated Use `apiBase`/`routeBase`. Kept as a backward-compatible alias. */
  baseUrl?: string;
  /** Base path where admin API requests are sent. Falls back to `baseUrl`. */
  apiBase?: string;
  /** Base path used for in-app navigation. Falls back to `baseUrl`. */
  routeBase?: string;
  /** Path to navigate to for the configuration screen. When provided, a Configuration card is shown. */
  configurationPath?: string;
  /** Additional custom screens to display as cards. Merged with any custom screens from the backend config.
   * @deprecated When using {@link AdminProvider}, register screens via `widgets.screens` instead. */
  customScreens?: AdminCustomScreen[];
  /** When true, omits the outer {@link Page} wrapper for composition under a parent screen. */
  embedded?: boolean;
  /** When true, hides the model grid (for example when models are shown in {@link AdminHome}). */
  hideModelsSection?: boolean;
}

const ScriptsCard: React.FC<{count: number; onPress: () => void}> = ({count, onPress}) => (
  <Card padding={4} testID="admin-scripts-card">
    <Box
      accessibilityHint="Navigate to admin scripts"
      accessibilityLabel="Scripts"
      gap={2}
      onClick={onPress}
      width={240}
    >
      <Heading size="md">Scripts</Heading>
      <Text color="secondaryDark" size="sm">
        {count} script{count !== 1 ? "s" : ""}
      </Text>
    </Box>
  </Card>
);

const ConfigurationCard: React.FC<{onPress: () => void}> = ({onPress}) => (
  <Card padding={4} testID="admin-configuration-card">
    <Box
      accessibilityHint="Navigate to application configuration"
      accessibilityLabel="Configuration"
      gap={2}
      onClick={onPress}
      width={240}
    >
      <Heading size="md">Configuration</Heading>
      <Text color="secondaryDark" size="sm">
        Manage application settings
      </Text>
    </Box>
  </Card>
);

const ModelCard: React.FC<{model: AdminModelConfig; onPress: (name: string) => void}> = ({
  model,
  onPress,
}) => {
  const fieldCount = Object.keys(model.fields).length;
  return (
    <Card key={model.name} padding={4} testID={`admin-model-card-${model.name}`}>
      <Box
        accessibilityHint={`Navigate to ${model.displayName} admin`}
        accessibilityLabel={model.displayName}
        gap={2}
        onClick={() => onPress(model.name)}
        width={240}
      >
        <Heading size="md">{model.displayName}</Heading>
        <Text color="secondaryDark" size="sm">
          {fieldCount} field{fieldCount !== 1 ? "s" : ""}
        </Text>
      </Box>
    </Card>
  );
};

const CustomScreenCard: React.FC<{screen: AdminCustomScreen; onPress: () => void}> = ({
  screen,
  onPress,
}) => (
  <Card padding={4} testID={`admin-custom-screen-card-${screen.name}`}>
    <Box
      accessibilityHint={`Navigate to ${screen.displayName}`}
      accessibilityLabel={screen.displayName}
      gap={2}
      onClick={onPress}
      width={240}
    >
      <Heading size="md">{screen.displayName}</Heading>
      <Text color="secondaryDark" size="sm">
        {screen.description ?? "Custom screen"}
      </Text>
    </Box>
  </Card>
);

/**
 * Admin panel entry screen that displays all available models as clickable cards.
 *
 * Fetches the admin configuration from the backend and renders a grid of model cards.
 * Each card shows the model's display name and field count. Clicking a card navigates
 * to the model's table view.
 *
 * @param props - Component props
 * @param props.baseUrl - Base URL for admin routes (e.g., "/admin")
 * @param props.customScreens - Additional custom screens to display as cards
 *
 * @example
 * ```typescript
 * import {AdminModelList} from "@terreno/admin-frontend";
 * import {} from "@/store/openApiSdk";
 *
 * function AdminIndexScreen() {
 *   return <AdminModelList baseUrl="/admin" />;
 * }
 * ```
 *
 * @see AdminModelTable for the table view that this navigates to
 * @see useAdminConfig for the configuration hook
 */
export const AdminModelList: React.FC<AdminModelListProps> = ({
  baseUrl,
  apiBase,
  routeBase,
  configurationPath,
  customScreens: propCustomScreens,
  embedded = false,
  hideModelsSection = false,
}) => {
  const {apiBase: resolvedApiBase, routeBase: resolvedRouteBase} = resolveAdminBases({
    apiBase,
    baseUrl,
    routeBase,
  });
  const {config, isLoading, error} = useAdminConfig(resolvedApiBase);
  useDeprecatedCustomScreensProp(propCustomScreens);

  const handlePress = useCallback(
    (modelName: string) => {
      router.push(`${resolvedRouteBase}/${modelName}` as Href);
    },
    [resolvedRouteBase]
  );

  if (isLoading) {
    const loadingBody = (
      <Box alignItems="center" justifyContent="center" padding={6}>
        <Spinner />
      </Box>
    );
    if (embedded) {
      return loadingBody;
    }
    return (
      <Page color="transparent" maxWidth="100%" padding={0} title="Admin">
        {loadingBody}
      </Page>
    );
  }

  if (error || !config) {
    const errorBody = (
      <Box padding={4}>
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

  const backendScreens = config.customScreens ?? [];
  const allCustomScreens = config.platformTools
    ? backendScreens
    : [...backendScreens, ...(propCustomScreens ?? [])];
  const scripts = config.scripts ?? [];
  const hasToolCards = allCustomScreens.length > 0 || scripts.length > 0 || !!configurationPath;

  const toolsSection = hasToolCards ? (
    <Box gap={2} width="100%">
      <Heading size="sm">Tools</Heading>
      <Box direction="row" gap={4} width="100%" wrap>
        {allCustomScreens.map((screen) => (
          <CustomScreenCard
            key={screen.name}
            onPress={() => handlePress(screen.name)}
            screen={screen}
          />
        ))}
        {scripts.length > 0 ? (
          <ScriptsCard count={scripts.length} onPress={() => handlePress("__scripts")} />
        ) : null}
        {configurationPath ? (
          <ConfigurationCard onPress={() => router.push(configurationPath as Href)} />
        ) : null}
      </Box>
    </Box>
  ) : null;

  const modelsSection = !hideModelsSection ? (
    <Box gap={2} width="100%">
      <Heading size="sm">Models</Heading>
      <Box direction="row" gap={4} width="100%" wrap>
        {config.models.map((model: AdminModelConfig) => (
          <ModelCard key={model.name} model={model} onPress={handlePress} />
        ))}
      </Box>
    </Box>
  ) : null;

  /** Models first so embedded home + list layouts read top-to-bottom; tools stay full-width below. */
  const listBody = (
    <Box gap={4} padding={embedded ? 0 : 4} width="100%">
      {modelsSection}
      {toolsSection}
    </Box>
  );

  if (embedded) {
    return listBody;
  }

  return (
    <Page color="transparent" maxWidth="100%" padding={0} scroll title="Admin">
      {listBody}
    </Page>
  );
};
