import {Box, Spinner, Text} from "@terreno/ui";
import {useLocalSearchParams} from "expo-router";
import {DateTime} from "luxon";
import React, {useMemo} from "react";
import type {AdminScreenWidgetProps} from "../../../types";
import {unwrapExperimentList} from "../experiments/experimentTypes";
import {useAiObservabilityExperimentsApi} from "../experiments/useAiObservabilityExperimentsApi";
import {judgeOutputSchemaFromDetail, unwrapPromptDetail} from "../prompts/promptTypes";
import {useAiObservabilityPromptsApi} from "../prompts/useAiObservabilityPromptsApi";
import {AiObservabilityChrome} from "../shell/AiObservabilityChrome";
import {AiEvaluatorDetailView} from "./AiEvaluatorPanels";
import {type EvaluatorUsageRow, unwrapEvaluatorRecord} from "./evaluatorTypes";
import {useAiObservabilityEvaluatorsApi} from "./useAiObservabilityEvaluatorsApi";

export const AiEvaluatorDetailScreenWidget: React.FC<AdminScreenWidgetProps> = (props) => {
  const {api, routeBase} = props;
  const params = useLocalSearchParams<{id?: string | string[]}>();
  const idParam = params.id;
  const id = Array.isArray(idParam) ? idParam[0] : idParam;
  const {useDetailQuery} = useAiObservabilityEvaluatorsApi(api);
  const {useListQuery: useExperimentsQuery} = useAiObservabilityExperimentsApi(api);
  const {useDetailQuery: usePromptDetailQuery} = useAiObservabilityPromptsApi(api);
  const {data, isError, isLoading} = useDetailQuery(id ?? "", {skip: !id});
  const {data: experimentsRaw, isError: isExperimentsError} = useExperimentsQuery();
  const evaluator = useMemo(() => unwrapEvaluatorRecord(data), [data]);
  const prefix = (routeBase ?? "").replace(/\/$/, "");
  const backHref = `${prefix}/ai-evaluators`;

  const {
    data: promptDetailRaw,
    isError: isPromptError,
    isLoading: isPromptLoading,
  } = usePromptDetailQuery(
    {name: evaluator?.judgePromptName ?? ""},
    {
      skip: !evaluator?.judgePromptName,
    }
  );
  const promptDetail = useMemo(() => unwrapPromptDetail(promptDetailRaw), [promptDetailRaw]);
  const judgePromptStatus = isPromptLoading
    ? ("loading" as const)
    : isPromptError || !promptDetail
      ? ("error" as const)
      : ("ready" as const);
  const judgeOutputSchema = useMemo(() => {
    if (!promptDetail) {
      return undefined;
    }
    return judgeOutputSchemaFromDetail(promptDetail);
  }, [promptDetail]);

  const usageRows = useMemo((): EvaluatorUsageRow[] => {
    if (!evaluator) {
      return [];
    }
    const experiments = unwrapExperimentList(experimentsRaw);
    const cutoff = DateTime.utc().minus({days: 30});
    return experiments
      .filter((experiment) => {
        const created = DateTime.fromISO(experiment.created);
        return (
          experiment.evaluatorIds.includes(evaluator.id) &&
          created.isValid &&
          created.toMillis() >= cutoff.toMillis()
        );
      })
      .map((experiment) => {
        return {
          costUsd: experiment.results?.totalCostUsd,
          experimentId: experiment.id,
          experimentName: experiment.name,
          runs: experiment.results?.progress.total ?? 0,
        };
      });
  }, [evaluator, experimentsRaw]);

  if (!id) {
    return (
      <AiObservabilityChrome {...props} backHref={backHref} screenName="ai-evaluator-detail">
        <Box padding={4}>
          <Text>Missing evaluator id.</Text>
        </Box>
      </AiObservabilityChrome>
    );
  }

  if (isLoading) {
    return (
      <AiObservabilityChrome {...props} backHref={backHref} screenName="ai-evaluator-detail">
        <Box alignItems="center" padding={4} testID="ai-evaluator-detail-loading">
          <Spinner />
        </Box>
      </AiObservabilityChrome>
    );
  }

  if (isError || !evaluator) {
    return (
      <AiObservabilityChrome {...props} backHref={backHref} screenName="ai-evaluator-detail">
        <Box padding={4}>
          <Text color="error">Failed to load evaluator.</Text>
        </Box>
      </AiObservabilityChrome>
    );
  }

  return (
    <AiObservabilityChrome {...props} backHref={backHref} screenName="ai-evaluator-detail">
      <AiEvaluatorDetailView
        evaluator={evaluator}
        judgeOutputSchema={judgeOutputSchema}
        judgePromptStatus={judgePromptStatus}
        routeBase={prefix}
        usageError={isExperimentsError ? "Could not load experiments." : undefined}
        usageRows={usageRows}
      />
    </AiObservabilityChrome>
  );
};
