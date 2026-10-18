import React from "react";
import type {AdminScreenWidgetProps, ScreenWidgetComponent} from "../types";
import {CommsDashboardScreen} from "./CommsDashboardScreen";
import {useCommsDashboardUrlFilters} from "./useCommsDashboardUrlFilters";

export const CommsDashboardScreenWidget: React.FC<AdminScreenWidgetProps> = ({routeBase}) => {
  const {filters, onFiltersChange} = useCommsDashboardUrlFilters(routeBase);
  return (
    <CommsDashboardScreen
      filters={filters}
      onFiltersChange={onFiltersChange}
      routeBase={routeBase}
    />
  );
};

export const COMMS_ADMIN_WIDGETS: Record<string, ScreenWidgetComponent> = {
  comms: CommsDashboardScreenWidget,
};
