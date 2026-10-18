import React from "react";
import type {AdminScreenWidgetProps, ScreenWidgetComponent} from "../types";
import {JobsDashboardScreen} from "./JobsDashboardScreen";
import {useJobsDashboardUrlFilters} from "./useJobsDashboardUrlFilters";

export const JobsDashboardScreenWidget: React.FC<AdminScreenWidgetProps> = ({routeBase}) => {
  const {filters, onFiltersChange} = useJobsDashboardUrlFilters(routeBase);
  return (
    <JobsDashboardScreen
      filters={filters}
      onFiltersChange={onFiltersChange}
      routeBase={routeBase}
    />
  );
};

export const JOBS_ADMIN_WIDGETS: Record<string, ScreenWidgetComponent> = {
  jobs: JobsDashboardScreenWidget,
};
