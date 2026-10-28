import {Box, Text} from "@terreno/ui";
import React from "react";
import {AdminBreadcrumbs} from "../../../AdminBreadcrumbs";
import {AdminScreenPage} from "../../../AdminScreenPage";
import type {AdminScreenWidgetProps} from "../../../types";
import {AiObservabilityStatusChip} from "./AiObservabilityStatusChip";
import {
  AI_OBSERVABILITY_SCREENS,
  buildAiObservabilityBreadcrumbs,
  type ObservabilityStatusPayload,
} from "./aiObservabilityNav";

export interface AiObservabilityChromeProps extends AdminScreenWidgetProps {
  backHref?: string;
  children?: React.ReactNode;
  error?: boolean;
  isLoading?: boolean;
  status?: ObservabilityStatusPayload;
}

export const AiObservabilityChrome: React.FC<AiObservabilityChromeProps> = ({
  api,
  backHref,
  children,
  error,
  isLoading,
  routeBase,
  screenName,
  status,
}) => {
  const meta = AI_OBSERVABILITY_SCREENS[screenName];
  const resolvedRouteBase = routeBase ?? "";
  const breadcrumbs = buildAiObservabilityBreadcrumbs({
    routeBase: resolvedRouteBase,
    screenName,
  });
  const localOffReview =
    (screenName === "ai-review" || screenName === "ai-review-item") && status && !status.localOn;

  return (
    <AdminScreenPage
      backHref={backHref ?? resolvedRouteBase}
      maxWidth="100%"
      scroll
      title={meta?.title ?? screenName}
    >
      <Box direction="row" gap={3} justifyContent="between" wrap>
        <AdminBreadcrumbs segments={breadcrumbs} />
        <AiObservabilityStatusChip api={api} error={error} isLoading={isLoading} status={status} />
      </Box>
      {localOffReview ? (
        <Box padding={2} testID="ai-observability-review-hidden">
          <Text color="secondaryDark">Review queue is hidden because the local plugin is off.</Text>
        </Box>
      ) : (
        children
      )}
    </AdminScreenPage>
  );
};
