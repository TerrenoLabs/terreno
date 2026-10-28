import {
  Badge,
  Box,
  Button,
  Heading,
  Modal,
  SegmentedControl,
  SelectField,
  Text,
  TextArea,
  TextField,
} from "@terreno/ui";
import {DateTime} from "luxon";
import React, {useCallback, useState} from "react";
import {AiPromptPlaygroundView} from "./AiPromptPlaygroundView";
import {
  nextVersionFromDetail,
  outgoingProductionCopy,
  type PlaygroundRunResult,
  type PromptDetail,
  type PromptVersionDetail,
  productionVersionFromDetail,
  schemaSummary,
  TEMPERATURE_PRESETS,
} from "./promptTypes";

export interface AiPromptEditorViewProps {
  canPlayground?: boolean;
  canPromote?: boolean;
  canUpdate?: boolean;
  detail: PromptDetail;
  isApiKeyLoading?: boolean;
  isRunningPlayground: boolean;
  isSaving: boolean;
  isSettingProduction: boolean;
  onRunPlayground: (variables: Record<string, string>) => Promise<void>;
  onSaveVersion: (body: {
    config?: Record<string, unknown>;
    system?: string;
    template: string;
    type: "chat" | "text";
    variables?: Array<{key: string; required: boolean}>;
  }) => Promise<void>;
  onSelectVersion: (version: number) => void;
  onSetProduction: (version: number) => Promise<void>;
  playgroundBlockedMessage?: string;
  playgroundError?: string;
  playgroundResult?: PlaygroundRunResult;
  productionError?: string;
  saveError?: string;
  selectedVersion: number;
}

const typeOptions = [
  {label: "Chat", value: "chat"},
  {label: "Text", value: "text"},
];

const formatVersionCreated = (created?: string): string => {
  if (!created) {
    return "Creation time unavailable";
  }
  const parsed = DateTime.fromISO(created);
  if (!parsed.isValid) {
    return "Creation time unavailable";
  }
  return parsed.toLocal().toLocaleString(DateTime.DATETIME_MED);
};

const labelsForVersion = (detail: PromptDetail, version: number): string[] => {
  const labelOrder: Record<string, number> = {latest: 1, production: 0, staging: 2};
  return detail.labels
    .filter((entry) => entry.version === version)
    .map((entry) => entry.label)
    .sort((left, right) => {
      return (labelOrder[left] ?? 3) - (labelOrder[right] ?? 3) || left.localeCompare(right);
    });
};

const labelStatus = (label: string): "info" | "neutral" | "success" | "warning" => {
  if (label === "production") {
    return "success";
  }
  if (label === "latest") {
    return "neutral";
  }
  if (label === "staging") {
    return "warning";
  }
  return "info";
};

const parseVariables = (text: string): Array<{key: string; required: boolean}> => {
  return text
    .split(",")
    .map((part) => part.trim())
    .filter((part) => part.length > 0)
    .map((key) => ({key, required: true}));
};

const AiPromptEditorForm: React.FC<{
  canPromote: boolean;
  canUpdate: boolean;
  current: PromptVersionDetail;
  isSaving: boolean;
  isSettingProduction: boolean;
  nextVersion: number;
  onOpenProduction: () => void;
  onSaveVersion: AiPromptEditorViewProps["onSaveVersion"];
  productionError?: string;
  saveError?: string;
}> = ({
  canPromote,
  canUpdate,
  current,
  isSaving,
  isSettingProduction,
  nextVersion,
  onOpenProduction,
  onSaveVersion,
  productionError,
  saveError,
}) => {
  const [type, setType] = useState<"chat" | "text">(current.type);
  const [system, setSystem] = useState(current.system ?? "");
  const [template, setTemplate] = useState(current.template ?? "");
  const [variablesText, setVariablesText] = useState(
    current.variables.map((entry) => entry.key).join(", ")
  );
  const [temperature, setTemperature] = useState(
    String((current.config?.temperature as number | undefined) ?? 0.3)
  );

  const handleSaveAsNext = useCallback(async (): Promise<void> => {
    await onSaveVersion({
      config: {temperature: Number(temperature)},
      system: type === "chat" ? system : undefined,
      template,
      type,
      variables: parseVariables(variablesText),
    });
  }, [onSaveVersion, system, temperature, template, type, variablesText]);

  return (
    <Box gap={3} testID="ai-prompt-editor-form">
      <SelectField
        disabled={!canUpdate}
        onChange={(value) => {
          setType(value as "chat" | "text");
        }}
        options={typeOptions}
        requireValue
        testID="ai-prompt-type"
        title="Type"
        value={type}
      />
      {type === "chat" ? (
        <TextArea
          disabled={!canUpdate}
          onChange={setSystem}
          rows={6}
          testID="ai-prompt-system"
          title="System"
          value={system}
        />
      ) : undefined}
      <TextArea
        disabled={!canUpdate}
        onChange={setTemplate}
        rows={10}
        testID="ai-prompt-template"
        title="Template"
        value={template}
      />
      <TextField
        disabled={!canUpdate}
        helperText="Comma-separated names. Schema summary of the selected version is read-only below."
        onChange={setVariablesText}
        testID="ai-prompt-variables"
        title="Variables"
        value={variablesText}
      />
      <Text color="secondaryDark" size="sm" testID="ai-prompt-schema-summary">
        {schemaSummary(current)}
      </Text>
      <SelectField
        disabled={!canUpdate}
        onChange={setTemperature}
        options={TEMPERATURE_PRESETS}
        requireValue
        testID="ai-prompt-temperature"
        title="Temperature"
        value={temperature}
      />
      <Text color="secondaryDark" size="sm">
        Model hint: set in version config when the provider requires it. Temperature is the
        operator-facing preset. One production label per prompt.
      </Text>
      {saveError ? <Text color="error">{saveError}</Text> : undefined}
      {productionError ? <Text color="error">{productionError}</Text> : undefined}
      {canUpdate || canPromote ? (
        <Box direction="row" gap={2} wrap>
          {canUpdate ? (
            <Button
              disabled={isSaving || !template.trim()}
              iconName="floppy-disk"
              onClick={handleSaveAsNext}
              testID="ai-prompt-save-next"
              text={`Save as v${nextVersion}`}
            />
          ) : undefined}
          {canPromote ? (
            <Button
              disabled={isSettingProduction}
              onClick={onOpenProduction}
              testID="ai-prompt-set-production"
              text={`Set v${current.version} as production…`}
              variant="secondary"
            />
          ) : undefined}
        </Box>
      ) : undefined}
    </Box>
  );
};

export const AiPromptEditorView: React.FC<AiPromptEditorViewProps> = ({
  canPlayground = true,
  canPromote = true,
  canUpdate = true,
  detail,
  isApiKeyLoading = false,
  isRunningPlayground,
  isSaving,
  isSettingProduction,
  onRunPlayground,
  onSaveVersion,
  onSelectVersion,
  onSetProduction,
  playgroundBlockedMessage,
  playgroundError,
  playgroundResult,
  productionError,
  saveError,
  selectedVersion,
}) => {
  const productionVersion = productionVersionFromDetail(detail);
  const nextVersion = nextVersionFromDetail(detail);
  const current = detail.versions.find((entry) => entry.version === selectedVersion);
  const [tabIndex, setTabIndex] = useState(0);
  const [confirmProduction, setConfirmProduction] = useState(false);

  const handleConfirmProduction = useCallback(async (): Promise<void> => {
    await onSetProduction(selectedVersion);
    setConfirmProduction(false);
  }, [onSetProduction, selectedVersion]);

  if (!current) {
    return (
      <Box padding={4}>
        <Text color="error">{`Version ${selectedVersion} was not found.`}</Text>
      </Box>
    );
  }

  const outgoingCopy = outgoingProductionCopy({detail, selectedVersion});
  const editorTabItems = canPlayground ? ["Editor", "Playground"] : ["Editor"];

  return (
    <Box flex="grow" gap={4} testID="ai-prompt-editor">
      <Box gap={2} testID="ai-prompt-version-list">
        <Heading size="sm">Versions</Heading>
        <Box border="default" rounding="md">
          {detail.versions
            .slice()
            .sort((left, right) => right.version - left.version)
            .map((version, index) => {
              const labels = labelsForVersion(detail, version.version);
              const isSelected = version.version === selectedVersion;
              return (
                <Box
                  alignItems="center"
                  borderBottom={index < detail.versions.length - 1 ? "default" : undefined}
                  color={isSelected ? "secondaryLight" : undefined}
                  direction="row"
                  gap={2}
                  key={version.version}
                  padding={3}
                  testID={`ai-prompt-version-row-${version.version}`}
                  wrap
                >
                  <Button
                    onClick={() => {
                      onSelectVersion(version.version);
                    }}
                    testID={`ai-prompt-version-${version.version}`}
                    text={`v${version.version}`}
                    variant={isSelected ? "primary" : "ghost"}
                  />
                  <Box direction="row" gap={1} wrap>
                    {labels.map((label) => (
                      <Badge
                        key={label}
                        status={labelStatus(label)}
                        testID={`ai-prompt-label-${label}-${version.version}`}
                        value={label}
                      />
                    ))}
                  </Box>
                  <Box flex="grow" minWidth={8} />
                  <Text
                    color="secondaryDark"
                    size="sm"
                    testID={`ai-prompt-version-created-${version.version}`}
                  >
                    {formatVersionCreated(version.created)}
                  </Text>
                </Box>
              );
            })}
        </Box>
        {productionVersion === undefined ? (
          <Badge status="warning" testID="ai-prompt-no-production" value="no production" />
        ) : undefined}
      </Box>
      <Box flex="grow" gap={3}>
        <Heading size="md">{detail.name}</Heading>
        <Text color="secondaryDark">
          {`${detail.folder} · immutable versions — save creates v${nextVersion}`}
        </Text>
        <Text color="secondaryDark" size="sm" testID="ai-prompt-outgoing-version">
          {outgoingCopy}
        </Text>
        <SegmentedControl
          items={editorTabItems}
          onChange={setTabIndex}
          selectedIndex={tabIndex}
          testID="ai-prompt-editor-tabs"
        />
        {canPlayground && tabIndex === 1 ? (
          <AiPromptPlaygroundView
            blockedMessage={playgroundBlockedMessage}
            detail={detail}
            isApiKeyLoading={isApiKeyLoading}
            isRunning={isRunningPlayground}
            onRun={onRunPlayground}
            result={playgroundResult}
            runError={playgroundBlockedMessage ? undefined : playgroundError}
            selectedVersion={current}
          />
        ) : (
          <AiPromptEditorForm
            canPromote={canPromote}
            canUpdate={canUpdate}
            current={current}
            isSaving={isSaving}
            isSettingProduction={isSettingProduction}
            key={`${detail.name}-${current.version}-${detail.versions.length}`}
            nextVersion={nextVersion}
            onOpenProduction={() => {
              setConfirmProduction(true);
            }}
            onSaveVersion={onSaveVersion}
            productionError={productionError}
            saveError={saveError}
          />
        )}
      </Box>
      {canPromote ? (
        <Modal
          onDismiss={() => {
            setConfirmProduction(false);
          }}
          primaryButtonOnClick={handleConfirmProduction}
          primaryButtonText="Set production"
          secondaryButtonOnClick={() => {
            setConfirmProduction(false);
          }}
          secondaryButtonText="Cancel"
          testID="ai-prompt-production-modal"
          title="Set production version"
          visible={confirmProduction}
        >
          <Text testID="ai-prompt-production-modal-copy">{outgoingCopy}</Text>
        </Modal>
      ) : undefined}
    </Box>
  );
};
