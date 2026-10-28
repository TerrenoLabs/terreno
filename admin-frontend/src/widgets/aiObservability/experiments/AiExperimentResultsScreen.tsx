import {Box, Button, Spinner, Text} from "@terreno/ui";
import {router, useLocalSearchParams} from "expo-router";
import {DateTime} from "luxon";
import React, {useCallback, useEffect, useMemo, useRef, useState} from "react";
import type {AdminScreenWidgetProps} from "../../../types";
import {AiObservabilityChrome} from "../shell/AiObservabilityChrome";
import {ObservabilityErrorState} from "../shell/ObservabilityStates";
import {ObservabilityStatusBadge} from "../shell/ObservabilityStatusBadge";
import {AiExperimentResultsView} from "./AiExperimentResultsView";
import {
  type ExperimentRecord,
  experimentKind,
  formatExperimentCost,
  formatPromoteBlockedReason,
  parsePromoteBlockedTitle,
  summarizeGatesByVersion,
  unwrapExperimentRecord,
} from "./experimentTypes";
import {useAiObservabilityExperimentsApi} from "./useAiObservabilityExperimentsApi";

const formatRunDate = (iso: string): string => {
  const parsed = DateTime.fromISO(iso);
  if (!parsed.isValid) {
    return iso;
  }
  return parsed.toLocal().toLocaleString(DateTime.DATETIME_MED);
};

/** Status badge, prompt, dataset, run date, and cost under the experiment name. */
const ResultsMeta: React.FC<{experiment: ExperimentRecord}> = ({experiment}) => {
  const cost = experiment.results?.totalCostUsd ?? experiment.estimate?.costUsd;
  const details = [
    `Prompt ${experiment.promptName}`,
    `Dataset ${experiment.datasetName ?? experiment.datasetId}`,
    formatRunDate(experiment.created),
    cost !== undefined ? formatExperimentCost(cost) : undefined,
  ].filter((entry): entry is string => Boolean(entry));
  return (
    <>
      <ObservabilityStatusBadge status={experiment.status} testID="ai-experiment-results-status" />
      <Text color="secondaryLight" size="sm" testID="ai-experiment-results-meta">
        {details.join(" · ")}
      </Text>
    </>
  );
};

export const AiExperimentResultsScreenWidget: React.FC<AdminScreenWidgetProps> = (props) => {
  const {api, routeBase} = props;
  const params = useLocalSearchParams<{id?: string | string[]}>();
  const idParam = params.id;
  const id = Array.isArray(idParam) ? idParam[0] : idParam;
  const {useDetailQuery, usePromoteMutation} = useAiObservabilityExperimentsApi(api);
  const {data, isError, isLoading, refetch} = useDetailQuery(id ?? "", {skip: !id});
  const [promote, promoteState] = usePromoteMutation();
  const experiment = useMemo(() => unwrapExperimentRecord(data), [data]);
  const prefix = (routeBase ?? "").replace(/\/$/, "");
  const backHref = `${prefix}/ai-experiments`;

  const [promoteVersion, setPromoteVersion] = useState(0);
  const [promoteConfirmOpen, setPromoteConfirmOpen] = useState(false);
  const [promoteError, setPromoteError] = useState("");
  const initializedExperimentId = useRef<string | undefined>(undefined);

  // Default promote version to the highest compared version once results load.
  useEffect(() => {
    if (!experiment || experiment.versions.length === 0) {
      return;
    }
    if (initializedExperimentId.current === experiment.id) {
      return;
    }
    const passing = summarizeGatesByVersion(experiment).filter((summary) => summary.passed);
    const latest =
      passing[passing.length - 1]?.version ??
      experiment.versions[experiment.versions.length - 1] ??
      0;
    initializedExperimentId.current = experiment.id;
    setPromoteVersion(latest);
  }, [experiment]);

  // Poll while the experiment is still pending or running so progress and gates stay current.
  useEffect(() => {
    if (!experiment || (experiment.status !== "pending" && experiment.status !== "running")) {
      return;
    }
    const timer = setInterval(() => {
      refetch();
    }, 3000);
    return () => {
      clearInterval(timer);
    };
  }, [experiment, refetch]);

  const handlePromote = useCallback(
    async (version: number): Promise<void> => {
      if (!id) {
        return;
      }
      setPromoteError("");
      try {
        await promote({id, version}).unwrap();
        setPromoteConfirmOpen(false);
        refetch();
      } catch (error) {
        setPromoteError(parsePromoteBlockedTitle(error) ?? "Could not promote this version.");
      }
    },
    [id, promote, refetch]
  );

  const handleRunAgain = useCallback((): void => {
    if (!experiment) {
      return;
    }
    const query = `datasetId=${encodeURIComponent(experiment.datasetId)}&pipeline=${experimentKind(experiment)}`;
    router.push(`${prefix}/ai-experiment-new?${query}`);
  }, [experiment, prefix]);

  if (!id) {
    return (
      <AiObservabilityChrome {...props} backHref={backHref} screenName="ai-experiment-results">
        <Box padding={4}>
          <Text color="secondaryLight">Missing experiment id.</Text>
        </Box>
      </AiObservabilityChrome>
    );
  }

  if (isLoading) {
    return (
      <AiObservabilityChrome {...props} backHref={backHref} screenName="ai-experiment-results">
        <Box alignItems="center" padding={5} testID="ai-experiment-results-loading">
          <Spinner />
        </Box>
      </AiObservabilityChrome>
    );
  }

  if (isError || !experiment) {
    return (
      <AiObservabilityChrome {...props} backHref={backHref} screenName="ai-experiment-results">
        <ObservabilityErrorState
          onRetry={refetch}
          testID="ai-experiment-results-error"
          text="Could not load experiment results."
        />
      </AiObservabilityChrome>
    );
  }

  const promoteSummary = summarizeGatesByVersion(experiment).find(
    (summary) => summary.version === promoteVersion
  );
  const isPromoteBlocked = !promoteSummary || Boolean(formatPromoteBlockedReason(promoteSummary));
  const isRunning = experiment.status === "running" || experiment.status === "pending";

  return (
    <AiObservabilityChrome
      {...props}
      actions={
        <>
          {isRunning ? null : (
            <Button
              iconName="rotate"
              onClick={handleRunAgain}
              testID="ai-experiment-run-again"
              text="Run again"
              variant="outline"
            />
          )}
          <Button
            disabled={isPromoteBlocked || isRunning}
            iconName="rocket"
            onClick={() => {
              setPromoteConfirmOpen(true);
            }}
            testID="ai-experiment-promote"
            text={`Promote v${promoteVersion} to production`}
          />
        </>
      }
      backHref={backHref}
      meta={<ResultsMeta experiment={experiment} />}
      screenName="ai-experiment-results"
      title={experiment.name}
    >
      <AiExperimentResultsView
        experiment={experiment}
        isPromoting={promoteState.isLoading}
        onDismissPromoteConfirm={() => {
          setPromoteConfirmOpen(false);
        }}
        onPromote={handlePromote}
        onSelectVersion={(version) => {
          setPromoteVersion(version);
          setPromoteError("");
        }}
        promoteConfirmOpen={promoteConfirmOpen}
        promoteError={promoteError}
        promoteVersion={promoteVersion}
      />
    </AiObservabilityChrome>
  );
};
