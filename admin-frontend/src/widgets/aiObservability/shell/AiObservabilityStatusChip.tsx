import {Badge} from "@terreno/ui";
import React from "react";
import {
  formatObservabilityStatusChip,
  type ObservabilityStatusPayload,
  unwrapObservabilityStatus,
} from "./aiObservabilityNav";
import {OBSERVABILITY_STATUS_URL, useObservabilityQuery} from "./observabilityRequest";

export interface AiObservabilityStatusChipProps {
  error?: boolean;
  isLoading?: boolean;
  status?: ObservabilityStatusPayload;
}

const StatusChipView: React.FC<{
  error?: boolean;
  isLoading?: boolean;
  status?: ObservabilityStatusPayload;
}> = ({error, isLoading, status}) => {
  if (isLoading) {
    return (
      <Badge
        secondary
        status="neutral"
        testID="ai-observability-status-chip"
        value="Checking observability…"
      />
    );
  }

  if (error || !status) {
    return (
      <Badge
        secondary
        status="error"
        testID="ai-observability-status-chip"
        value="Observability unavailable"
      />
    );
  }

  return (
    <Badge
      iconName={status.localOn ? "circle-check" : "circle-minus"}
      secondary
      status={status.localOn ? "success" : "neutral"}
      testID="ai-observability-status-chip"
      value={formatObservabilityStatusChip(status)}
    />
  );
};

/** Reads plugin status through the host-bound admin client when the screen has none. */
const FetchedStatusChip: React.FC = () => {
  const query = useObservabilityQuery<
    {data: ObservabilityStatusPayload} | ObservabilityStatusPayload
  >({url: OBSERVABILITY_STATUS_URL});
  return (
    <StatusChipView
      error={query.isError}
      isLoading={query.isLoading}
      status={unwrapObservabilityStatus(query.data)}
    />
  );
};

export const AiObservabilityStatusChip: React.FC<AiObservabilityStatusChipProps> = ({
  error,
  isLoading,
  status,
}) => {
  if (status || isLoading || error) {
    return <StatusChipView error={error} isLoading={isLoading} status={status} />;
  }
  return <FetchedStatusChip />;
};
