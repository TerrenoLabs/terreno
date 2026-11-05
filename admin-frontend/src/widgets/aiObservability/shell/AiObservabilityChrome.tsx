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
import {ObservabilityPageHeader} from "./ObservabilityPageHeader";

export interface AiObservabilityChromeProps extends AdminScreenWidgetProps {
  /** Header buttons on the right. At most one primary. */
  actions?: React.ReactNode;
  backHref?: string;
  children?: React.ReactNode;
  /** One sentence on what the screen is for. */
  description?: string;
  error?: boolean;
  /** Hide the page header when a screen renders its own loading or missing-id state. */
  hideHeader?: boolean;
  isLoading?: boolean;
  /** Badges and timestamps under the title on detail screens. */
  meta?: React.ReactNode;
  status?: ObservabilityStatusPayload;
  /** Overrides the screen's default title, e.g. with a record name. */
  title?: string;
}

export const AiObservabilityChrome: React.FC<AiObservabilityChromeProps> = ({
  actions,
  api,
  backHref,
  children,
  description,
  error,
  hideHeader,
  isLoading,
  meta: headerMeta,
  routeBase,
  screenName,
  status,
  title,
}) => {
  const screenMeta = AI_OBSERVABILITY_SCREENS[screenName];
  const resolvedRouteBase = routeBase ?? "";
  const breadcrumbs = buildAiObservabilityBreadcrumbs({
    routeBase: resolvedRouteBase,
    screenName,
  });
  const localOffReview = screenName.startsWith("ai-review") && status && !status.localOn;

  const pageTitle = title ?? screenMeta?.title ?? screenName;

  return (
    <AdminScreenPage
      backButton={false}
      backHref={backHref ?? resolvedRouteBase}
      maxWidth="100%"
      scroll
    >
      <Box gap={5} maxWidth={1240} width="100%">
        <Box alignItems="center" direction="row" gap={3} justifyContent="between" wrap>
          <AdminBreadcrumbs segments={breadcrumbs} />
          <AiObservabilityStatusChip
            api={api}
            error={error}
            isLoading={isLoading}
            status={status}
          />
        </Box>
        {hideHeader ? null : (
          <ObservabilityPageHeader
            actions={localOffReview ? undefined : actions}
            description={description}
            meta={localOffReview ? undefined : headerMeta}
            title={pageTitle}
          />
        )}
        {localOffReview ? (
          <Box testID="ai-observability-review-hidden">
            <Text color="secondaryLight">
              Review is hidden because the local observability plugin is off.
            </Text>
          </Box>
        ) : (
          children
        )}
      </Box>
    </AdminScreenPage>
  );
};
