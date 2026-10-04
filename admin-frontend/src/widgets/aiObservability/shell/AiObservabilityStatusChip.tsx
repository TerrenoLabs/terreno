import {Badge} from "@terreno/ui";
import React, {useMemo} from "react";
import {asDynamicHookApi} from "../../../dynamicHookApi";
import type {AdminApi, EndpointBuilder} from "../../../types";
import {
  formatObservabilityStatusChip,
  type ObservabilityStatusPayload,
  unwrapObservabilityStatus,
} from "./aiObservabilityNav";

const STATUS_ENDPOINT_KEY = "aiObservabilityStatus";

interface StatusResponse {
  data: ObservabilityStatusPayload;
}

export interface AiObservabilityStatusChipProps {
  api?: AdminApi;
  error?: boolean;
  isLoading?: boolean;
  status?: ObservabilityStatusPayload;
}

const createStatusApi = (api: AdminApi) => {
  return api.injectEndpoints({
    endpoints: (build: EndpointBuilder) => ({
      [STATUS_ENDPOINT_KEY]: build.query({
        query: () => ({
          method: "GET",
          url: "/ai/observability/status",
        }),
      }),
    }),
    overrideExisting: true,
  });
};

const StatusChipView: React.FC<{
  error?: boolean;
  isLoading?: boolean;
  status?: ObservabilityStatusPayload;
}> = ({error, isLoading, status}) => {
  if (isLoading) {
    return (
      <Badge status="info" testID="ai-observability-status-chip" value="Checking observability…" />
    );
  }

  if (error || !status) {
    return (
      <Badge
        status="error"
        testID="ai-observability-status-chip"
        value="Observability unavailable"
      />
    );
  }

  return (
    <Badge
      status={status.localOn ? "success" : "warning"}
      testID="ai-observability-status-chip"
      value={formatObservabilityStatusChip(status)}
    />
  );
};

const FetchedStatusChip: React.FC<{api: AdminApi}> = ({api}) => {
  const enhancedApi = useMemo(() => {
    return createStatusApi(api);
  }, [api]);
  const query = asDynamicHookApi(enhancedApi).useAiObservabilityStatusQuery() as {
    data?: StatusResponse | ObservabilityStatusPayload;
    isError: boolean;
    isLoading: boolean;
  };
  return (
    <StatusChipView
      error={query.isError}
      isLoading={query.isLoading}
      status={unwrapObservabilityStatus(query.data)}
    />
  );
};

export const AiObservabilityStatusChip: React.FC<AiObservabilityStatusChipProps> = ({
  api,
  error,
  isLoading,
  status,
}) => {
  if (status || isLoading || error || !api) {
    return <StatusChipView error={error} isLoading={isLoading} status={status} />;
  }
  return <FetchedStatusChip api={api} />;
};
