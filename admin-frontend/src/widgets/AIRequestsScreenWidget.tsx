import {AIRequestExplorer, type AIRequestExplorerData} from "@terreno/ui";
import React, {useCallback, useState} from "react";
import {AdminScreenPage} from "../AdminScreenPage";
import {withQueryString} from "../adminRpc";
import type {AdminScreenWidgetProps, ScreenWidgetComponent} from "../types";
import {useAdminRpc, useAdminRpcQuery} from "../useAdminRpc";

const EXPLORER_LIMIT = 20;

interface AIRequestsResponse {
  data: AIRequestExplorerData[];
  limit: number;
  more: boolean;
  page: number;
  total: number;
}

export const AIRequestsScreenWidget: React.FC<AdminScreenWidgetProps> = ({routeBase}) => {
  const [page, setPage] = useState(1);
  const [requestTypeFilter, setRequestTypeFilter] = useState<string[]>([]);
  const [startDate, setStartDate] = useState("");
  const [endDate, setEndDate] = useState("");

  const explorerParams = {
    endDate: endDate || undefined,
    limit: EXPLORER_LIMIT,
    page,
    requestType: requestTypeFilter.length > 0 ? requestTypeFilter.join(",") : undefined,
    startDate: startDate || undefined,
  };
  const rpc = useAdminRpc();
  const {data, isLoading} = useAdminRpcQuery<AIRequestsResponse>({
    rpc,
    url: withQueryString({params: explorerParams, url: "/aiRequestsExplorer"}),
  });

  const handlePageChange = useCallback((nextPage: number): void => {
    setPage(nextPage);
  }, []);

  const handleRequestTypeFilterChange = useCallback((types: string[]): void => {
    setRequestTypeFilter(types);
    setPage(1);
  }, []);

  const handleStartDateChange = useCallback((value: string): void => {
    setStartDate(value);
    setPage(1);
  }, []);

  const handleEndDateChange = useCallback((value: string): void => {
    setEndDate(value);
    setPage(1);
  }, []);

  const total = data?.total ?? 0;

  return (
    <AdminScreenPage backHref={routeBase} maxWidth="100%" scroll title="AI Request Explorer">
      <AIRequestExplorer
        data={data?.data ?? []}
        endDate={endDate}
        isLoading={isLoading}
        onEndDateChange={handleEndDateChange}
        onPageChange={handlePageChange}
        onRequestTypeFilterChange={handleRequestTypeFilterChange}
        onStartDateChange={handleStartDateChange}
        page={page}
        requestTypeFilter={requestTypeFilter}
        startDate={startDate}
        testID="admin-ai-explorer"
        totalCount={total}
        totalPages={Math.ceil(total / EXPLORER_LIMIT)}
      />
    </AdminScreenPage>
  );
};

export const AI_ADMIN_WIDGETS: Record<string, ScreenWidgetComponent> = {
  "ai-requests": AIRequestsScreenWidget,
};
