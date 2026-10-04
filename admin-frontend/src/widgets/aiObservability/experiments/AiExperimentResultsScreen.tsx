import {Box, Spinner, Text} from "@terreno/ui";
import {useLocalSearchParams} from "expo-router";
import React, {useCallback, useEffect, useMemo, useRef, useState} from "react";
import type {AdminScreenWidgetProps} from "../../../types";
import {AiObservabilityChrome} from "../shell/AiObservabilityChrome";
import {AiExperimentResultsView} from "./AiExperimentResultsView";
import {gatesForVersion, parsePromoteBlockedTitle, unwrapExperimentRecord} from "./experimentTypes";
import {useAiObservabilityExperimentsApi} from "./useAiObservabilityExperimentsApi";

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

  const [selectedVersion, setSelectedVersion] = useState(0);
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
    const latest = experiment.versions[experiment.versions.length - 1] ?? 0;
    initializedExperimentId.current = experiment.id;
    setSelectedVersion(latest);
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

  const blockedGate = useMemo(() => {
    if (!experiment) {
      return undefined;
    }
    return gatesForVersion(experiment, promoteVersion).find((gate) => !gate.passed);
  }, [experiment, promoteVersion]);

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
        setPromoteError(parsePromoteBlockedTitle(error) ?? "Promote failed.");
      }
    },
    [id, promote, refetch]
  );

  if (!id) {
    return (
      <AiObservabilityChrome {...props} backHref={backHref} screenName="ai-experiment-results">
        <Box padding={4}>
          <Text>Missing experiment id.</Text>
        </Box>
      </AiObservabilityChrome>
    );
  }

  if (isLoading) {
    return (
      <AiObservabilityChrome {...props} backHref={backHref} screenName="ai-experiment-results">
        <Box alignItems="center" padding={4} testID="ai-experiment-results-loading">
          <Spinner />
        </Box>
      </AiObservabilityChrome>
    );
  }

  if (isError || !experiment) {
    return (
      <AiObservabilityChrome {...props} backHref={backHref} screenName="ai-experiment-results">
        <Box padding={4}>
          <Text color="error">Failed to load experiment results.</Text>
        </Box>
      </AiObservabilityChrome>
    );
  }

  return (
    <AiObservabilityChrome {...props} backHref={backHref} screenName="ai-experiment-results">
      <AiExperimentResultsView
        experiment={experiment}
        isPromoting={promoteState.isLoading}
        onDismissPromoteConfirm={() => {
          setPromoteConfirmOpen(false);
        }}
        onOpenPromoteConfirm={() => {
          setPromoteConfirmOpen(true);
        }}
        onPromote={handlePromote}
        onSelectVersion={(version) => {
          setSelectedVersion(version);
          setPromoteVersion(version);
        }}
        promoteBlockedMessage={
          blockedGate
            ? `gate failed for v${promoteVersion} ${blockedGate.evaluatorName}.${blockedGate.dimension}`
            : undefined
        }
        promoteConfirmOpen={promoteConfirmOpen}
        promoteError={promoteError}
        promoteVersion={promoteVersion}
        selectedVersion={selectedVersion}
      />
    </AiObservabilityChrome>
  );
};
