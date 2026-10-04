import {Accordion, Box, Button, Text, TextField} from "@terreno/ui";
import React, {useCallback, useMemo, useState} from "react";
import {
  formatPlaygroundMetrics,
  type PlaygroundRunResult,
  type PromptDetail,
  type PromptVersionDetail,
  variableNamesFromVersion,
} from "./promptTypes";

export interface AiPromptPlaygroundViewProps {
  blockedMessage?: string;
  detail: PromptDetail;
  isApiKeyLoading?: boolean;
  isRunning: boolean;
  onRun: (variables: Record<string, string>) => Promise<void>;
  result: PlaygroundRunResult | undefined;
  runError: string | undefined;
  selectedVersion: PromptVersionDetail;
}

export const AiPromptPlaygroundView: React.FC<AiPromptPlaygroundViewProps> = ({
  blockedMessage,
  detail,
  isApiKeyLoading = false,
  isRunning,
  onRun,
  result,
  runError,
  selectedVersion,
}) => {
  const names = useMemo(() => variableNamesFromVersion(selectedVersion), [selectedVersion]);
  const [values, setValues] = useState<Record<string, string>>({});

  const handleChange = useCallback((name: string, text: string): void => {
    setValues((prev) => ({...prev, [name]: text}));
  }, []);

  const handleRun = useCallback(async (): Promise<void> => {
    if (blockedMessage || isApiKeyLoading) {
      return;
    }
    const payload: Record<string, string> = {};
    for (const name of names) {
      payload[name] = values[name] ?? "";
    }
    await onRun(payload);
  }, [blockedMessage, isApiKeyLoading, names, onRun, values]);

  const runDisabled = isRunning || isApiKeyLoading || Boolean(blockedMessage);
  const runLabel = isApiKeyLoading ? "Loading API key…" : isRunning ? "Running…" : "Run once";

  return (
    <Box gap={3} testID="ai-prompt-playground">
      <Text color="secondaryDark">
        {`Runs ${detail.name} version ${selectedVersion.version}. Playground does not create a version.`}
      </Text>
      {blockedMessage ? (
        <Text color="secondaryDark" testID="ai-prompt-playground-blocked">
          {blockedMessage}
        </Text>
      ) : undefined}
      {names.length === 0 ? (
        <Text color="secondaryDark">This version has no template variables.</Text>
      ) : (
        names.map((name) => (
          <TextField
            key={name}
            onChange={(text) => {
              handleChange(name, text);
            }}
            testID={`ai-prompt-var-${name}`}
            title={name}
            value={values[name] ?? ""}
          />
        ))
      )}
      <Button
        disabled={runDisabled}
        iconName="play"
        onClick={handleRun}
        testID="ai-prompt-run-once"
        text={runLabel}
      />
      {runError ? (
        <Text color="error" testID="ai-prompt-run-error">
          {runError}
        </Text>
      ) : undefined}
      {result ? (
        <Box gap={2} testID="ai-prompt-run-result">
          {result.compiledMessages.length > 0 ? (
            <Accordion title="Compiled messages">
              <Box gap={2}>
                {result.compiledMessages.map((message, index) => (
                  <Box gap={1} key={`${message.role}-${index}`}>
                    <Text bold size="sm">
                      {message.role}
                    </Text>
                    <Text size="sm">{message.content}</Text>
                  </Box>
                ))}
              </Box>
            </Accordion>
          ) : undefined}
          <Text testID="ai-prompt-run-output">{result.output}</Text>
          <Text color="secondaryDark" size="sm" testID="ai-prompt-run-metrics">
            {formatPlaygroundMetrics(result)}
          </Text>
        </Box>
      ) : undefined}
      <Button
        disabled
        onClick={async () => undefined}
        testID="ai-prompt-save-run-dataset"
        text="Save this run to dataset"
        variant="secondary"
      />
      <Text color="secondaryDark" size="sm">
        Dataset save lands in phase 2.
      </Text>
    </Box>
  );
};
