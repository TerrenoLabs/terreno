import {Button} from "@terreno/ui";
import {router} from "expo-router";
import React, {useCallback, useMemo} from "react";
import type {AdminScreenWidgetProps} from "../../../types";
import {useAiObservabilityPromptsApi} from "../prompts/useAiObservabilityPromptsApi";
import {AiObservabilityChrome} from "../shell/AiObservabilityChrome";
import {unwrapObservabilityStatus} from "../shell/aiObservabilityNav";
import {observabilityActionAllowed} from "../shell/observabilityPermissions";
import {AiEvaluatorsListView} from "./AiEvaluatorsListView";
import {unwrapEvaluatorList} from "./evaluatorTypes";
import {useAiObservabilityEvaluatorsApi} from "./useAiObservabilityEvaluatorsApi";

const EVALUATORS_DESCRIPTION =
  "Rules that score AI outputs: questions people answer, LLM judges that answer the same questions, and JSON checks.";

export const AiEvaluatorsScreenWidget: React.FC<AdminScreenWidgetProps> = (props) => {
  const {api, routeBase} = props;
  const {useListQuery} = useAiObservabilityEvaluatorsApi(api);
  const {useStatusQuery} = useAiObservabilityPromptsApi(api);
  const {data, isError, isLoading, refetch} = useListQuery();
  const statusQuery = useStatusQuery();
  const canCreate = observabilityActionAllowed({
    action: "create",
    resource: "aiEvaluator",
    status: unwrapObservabilityStatus(statusQuery.data),
    statusError: statusQuery.isError,
    statusLoading: statusQuery.isLoading,
  });
  const evaluators = useMemo(() => unwrapEvaluatorList(data), [data]);
  const prefix = (routeBase ?? "").replace(/\/$/, "");

  const handleOpen = useCallback(
    (id: string): void => {
      router.push(`${prefix}/ai-evaluator-detail?id=${encodeURIComponent(id)}`);
    },
    [prefix]
  );

  const handleCreate = useCallback((): void => {
    router.push(`${prefix}/ai-evaluator-new`);
  }, [prefix]);

  const loadError = isError ? "Could not load evaluators." : undefined;

  return (
    <AiObservabilityChrome
      {...props}
      actions={
        canCreate ? (
          <Button
            iconName="plus"
            onClick={handleCreate}
            testID="ai-evaluators-create"
            text="New evaluator"
            variant="primary"
          />
        ) : undefined
      }
      description={EVALUATORS_DESCRIPTION}
      screenName="ai-evaluators"
    >
      <AiEvaluatorsListView
        canCreate={canCreate}
        evaluators={evaluators}
        isLoading={isLoading}
        loadError={loadError}
        onCreate={handleCreate}
        onOpen={handleOpen}
        onRetry={refetch}
      />
    </AiObservabilityChrome>
  );
};
