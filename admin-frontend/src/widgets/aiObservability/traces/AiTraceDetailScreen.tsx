import {Box, Button, Spinner, Text} from "@terreno/ui";
import {router, useLocalSearchParams} from "expo-router";
import React, {useCallback, useMemo} from "react";
import type {AdminScreenWidgetProps} from "../../../types";
import {AiObservabilityChrome} from "../shell/AiObservabilityChrome";
import {AiTraceDetailView} from "./AiTraceDetailView";
import {unwrapTraceDetail} from "./traceTypes";
import {useAiObservabilityTracesApi} from "./useAiObservabilityTracesApi";

export const AiTraceDetailScreenWidget: React.FC<AdminScreenWidgetProps> = (props) => {
  const {api, routeBase} = props;
  const params = useLocalSearchParams<{id?: string | string[]}>();
  const idParam = params.id;
  const id = Array.isArray(idParam) ? idParam[0] : idParam;
  const {useDetailQuery} = useAiObservabilityTracesApi(api);
  const {data, isError, isLoading, refetch} = useDetailQuery(id ?? "", {skip: !id});
  const detail = useMemo(() => unwrapTraceDetail(data), [data]);
  const prefix = (routeBase ?? "").replace(/\/$/, "");
  const backHref = `${prefix}/ai-traces`;

  const handleBack = useCallback((): void => {
    router.push(backHref);
  }, [backHref]);

  if (!id) {
    return (
      <AiObservabilityChrome {...props} backHref={backHref} screenName="ai-trace-detail">
        <Box padding={4}>
          <Text>Missing trace id. Open a trace from the list.</Text>
        </Box>
      </AiObservabilityChrome>
    );
  }

  if (isLoading) {
    return (
      <AiObservabilityChrome {...props} backHref={backHref} screenName="ai-trace-detail">
        <Box alignItems="center" padding={4} testID="ai-trace-detail-loading">
          <Spinner />
        </Box>
      </AiObservabilityChrome>
    );
  }

  if (isError || !detail) {
    return (
      <AiObservabilityChrome {...props} backHref={backHref} screenName="ai-trace-detail">
        <Box gap={2} padding={4}>
          <Text color="error">{`Could not load ${id}.`}</Text>
          <Button onClick={() => refetch()} text="Retry" />
        </Box>
      </AiObservabilityChrome>
    );
  }

  return (
    <AiObservabilityChrome {...props} backHref={backHref} screenName="ai-trace-detail">
      <AiTraceDetailView detail={detail} onBack={handleBack} />
    </AiObservabilityChrome>
  );
};
