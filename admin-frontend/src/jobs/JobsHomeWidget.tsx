import {Box, Button, Card, Heading, Spinner, Text} from "@terreno/ui";
import type {Href} from "expo-router";
import {router} from "expo-router";
import React, {useCallback} from "react";
import type {AdminHomeWidgetProps, HomeWidgetComponent} from "../types";
import {useJobsDashboardApi} from "./useJobsDashboardApi";

export const JobsHomeWidget: React.FC<AdminHomeWidgetProps> = ({routeBase}) => {
  const {useStatsQuery} = useJobsDashboardApi();
  const {data, error, isLoading} = useStatsQuery();
  const deadTotal = data?.byStatus?.dead ?? 0;
  const runningTotal = data?.byStatus?.running ?? 0;

  const onOpen = useCallback((): void => {
    const prefix = routeBase.endsWith("/") ? routeBase.slice(0, -1) : routeBase;
    router.push(`${prefix}/jobs` as Href);
  }, [routeBase]);

  return (
    <Card padding={4} testID="admin-home-widget-jobs">
      <Heading size="sm">Jobs</Heading>
      {isLoading ? (
        <Box alignItems="center" marginTop={2} padding={2} testID="jobs-home-widget-loading">
          <Spinner />
        </Box>
      ) : null}
      {error ? (
        <Box marginTop={2}>
          <Text color="error" size="sm" testID="jobs-home-widget-error">
            Failed to load job counts.
          </Text>
        </Box>
      ) : null}
      {!isLoading && !error ? (
        <Box gap={2} marginTop={2}>
          <Text color="secondaryDark" size="sm" testID="jobs-home-widget-counts">
            {`${deadTotal} dead · ${runningTotal} running`}
          </Text>
          <Button
            onClick={onOpen}
            testID="jobs-home-widget-open"
            text="Open jobs"
            variant="outline"
          />
        </Box>
      ) : null}
    </Card>
  );
};

export const JOBS_HOME_WIDGETS: Record<string, HomeWidgetComponent> = {
  jobs: JobsHomeWidget,
};
