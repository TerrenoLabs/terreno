import {Box, Card, Heading, IconButton, Spinner, Text} from "@terreno/ui";
import type {Href} from "expo-router";
import {router} from "expo-router";
import React, {useCallback} from "react";
import {shouldSkipOrgScopedAdminQuery} from "../orgs/shouldSkipOrgScopedAdminQuery";
import {useOptionalOrgContext} from "../orgs/useOrgContext";
import type {AdminHomeWidgetProps, AdminModelConfig} from "../types";
import {useAdminModelApi} from "../useAdminModelApi";

const ModelGridCard: React.FC<{
  model: AdminModelConfig;
  routeBase: string;
}> = ({model, routeBase}) => {
  const organizationId = useOptionalOrgContext()?.organizationId;
  const skipOrgScopedQuery = shouldSkipOrgScopedAdminQuery({
    organizationId,
    organizationScoped: model.organizationScoped,
  });
  const {useListQuery} = useAdminModelApi(model.routePath, model.name);
  const {data, isLoading} = useListQuery(
    {limit: 1, page: 1},
    {skip: !model.routePath || skipOrgScopedQuery}
  );
  const total = (data as {total?: number} | undefined)?.total;
  const fieldCount = Object.keys(model.fields).length;
  const createEnabled = model.permissions?.create !== false;

  const onOpen = useCallback((): void => {
    const prefix = routeBase.endsWith("/") ? routeBase.slice(0, -1) : routeBase;
    const href = `${prefix}/${model.name}` as Href;
    router.push(href);
  }, [routeBase, model.name]);

  const onCreate = useCallback((): void => {
    if (!createEnabled) {
      return;
    }
    const prefix = routeBase.endsWith("/") ? routeBase.slice(0, -1) : routeBase;
    router.push(`${prefix}/${model.name}/create` as Href);
  }, [createEnabled, routeBase, model.name]);

  return (
    <Box
      accessibilityHint={`Open ${model.displayName} admin`}
      accessibilityLabel={model.displayName}
      border="default"
      padding={3}
      rounding="md"
      width={220}
    >
      <Box alignItems="start" direction="row" gap={2} justifyContent="between">
        <Box
          accessibilityHint={`View ${model.displayName} list`}
          accessibilityLabel={model.displayName}
          flex="grow"
          minWidth={0}
          onClick={onOpen}
          testID={`admin-home-models-grid-${model.name}`}
        >
          <Text bold>{model.displayName}</Text>
          <Text color="secondaryDark" size="sm">
            {`${fieldCount} fields`}
          </Text>
          <Box marginTop={1}>
            {isLoading ? (
              <Spinner />
            ) : (
              <Text
                color="secondaryDark"
                size="sm"
                testID={`admin-home-model-count-${model.name}`}
              >{`${total != null ? total : "—"} rows`}</Text>
            )}
          </Box>
        </Box>
        {createEnabled ? (
          <IconButton
            accessibilityHint={`Create new ${model.displayName}`}
            accessibilityLabel={`Add ${model.displayName}`}
            iconName="plus"
            onClick={onCreate}
            testID={`admin-home-model-add-${model.name}`}
            tooltipText="Add new"
            variant="secondary"
          />
        ) : null}
      </Box>
    </Box>
  );
};

export const ModelsGridWidget: React.FC<AdminHomeWidgetProps> = ({models, routeBase}) => {
  return (
    <Card padding={4} testID="admin-home-widget-modelsGrid">
      <Heading size="sm">Models</Heading>
      <Box direction="row" gap={3} marginTop={2} wrap>
        {models.map((m) => (
          <ModelGridCard key={m.name} model={m} routeBase={routeBase} />
        ))}
      </Box>
    </Card>
  );
};
