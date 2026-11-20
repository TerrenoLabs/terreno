import {Box, Button, CheckBox, Heading, SelectField, Text} from "@terreno/ui";
import React, {useCallback, useMemo} from "react";
import {ExpectedOutputForm} from "./ExpectedOutputForm";
import {buildForm, type JsonSchema} from "./expectedOutputModel";

const REVIEW_STEPS = [
  "Read the input. It is exactly what the model received.",
  "Fix the expected output to the answer this feature should give, not the answer it gave.",
  "Set the outcome class if this feature is a flag. Leave it blank otherwise.",
  "Tick Proofread once the expected output is right.",
  "Save and next. Unticked items stay in Needs review.",
];

const OUTCOME_OPTIONS = [
  {label: "True positive", value: "tp"},
  {label: "False positive", value: "fp"},
  {label: "True negative", value: "tn"},
  {label: "False negative", value: "fn"},
];

export interface AiDatasetItemViewProps {
  canSave?: boolean;
  error?: string;
  expected: unknown;
  expectedSchema?: JsonSchema;
  input: unknown;
  inputEditable?: boolean;
  isSaving?: boolean;
  onExpectedChange: (value: unknown) => void;
  onInputChange: (value: unknown) => void;
  onOpenTrace?: () => void;
  onOutcomeChange: (value: string) => void;
  onProofreadChange: (value: boolean) => void;
  onSave: () => void;
  outcomeClass: string;
  proofread: boolean;
  reviewing?: boolean;
  saveLabel: string;
}

export const AiDatasetItemView: React.FC<AiDatasetItemViewProps> = ({
  canSave = true,
  error,
  expected,
  expectedSchema,
  input,
  inputEditable = false,
  isSaving,
  onExpectedChange,
  onInputChange,
  onOpenTrace,
  onOutcomeChange,
  onProofreadChange,
  onSave,
  outcomeClass,
  proofread,
  reviewing = false,
  saveLabel,
}) => {
  const inputNode = useMemo(() => buildForm(undefined, input), [input]);
  const expectedNode = useMemo(
    () => buildForm(expectedSchema, expected),
    [expected, expectedSchema]
  );

  const handleProofread = useCallback((): void => {
    onProofreadChange(!proofread);
  }, [onProofreadChange, proofread]);

  return (
    <Box gap={5} testID="ai-dataset-item">
      {reviewing ? (
        <Box
          border="default"
          gap={2}
          padding={4}
          rounding="md"
          testID="ai-dataset-item-review-steps"
        >
          <Heading size="sm">How to review this item</Heading>
          {REVIEW_STEPS.map((step, index) => (
            <Text key={step} size="sm">
              {`${index + 1}. ${step}`}
            </Text>
          ))}
        </Box>
      ) : null}
      <Box border="default" gap={3} padding={4} rounding="md">
        <Heading size="sm">Input</Heading>
        <Text color="secondaryDark" size="sm">
          {inputEditable
            ? "The model sees this input. Each field is one part of the JSON."
            : "The model saw this input. Edit the expected output below to set the golden label."}
        </Text>
        <ExpectedOutputForm
          disabled={!inputEditable}
          idPrefix="ai-dataset-item-input"
          node={inputNode}
          onChange={onInputChange}
          value={input}
        />
      </Box>
      <Box border="default" gap={3} padding={4} rounding="md" testID="ai-dataset-item-expected">
        <Heading size="sm">Expected output (golden label)</Heading>
        <Text color="secondaryDark" size="sm">
          The golden label is the answer this feature must give for this input. Experiments score
          the live feature against proofread golden labels only.
        </Text>
        <Text color="secondaryDark" size="sm">
          {expectedSchema
            ? "Fields come from this dataset's expected output schema."
            : "Fields come from the JSON stored on this item."}
        </Text>
        <ExpectedOutputForm
          disabled={!canSave}
          idPrefix="ai-dataset-item-expected"
          node={expectedNode}
          onChange={onExpectedChange}
          value={expected}
        />
      </Box>
      <SelectField
        disabled={!canSave}
        helperText="Use this when the feature is a flag."
        onChange={onOutcomeChange}
        options={OUTCOME_OPTIONS}
        testID="ai-dataset-item-outcome"
        title="Outcome class"
        value={outcomeClass}
      />
      <Box
        accessibilityHint="Marks this item as a golden label"
        accessibilityLabel="Proofread"
        accessibilityRole="checkbox"
        alignItems="center"
        direction="row"
        gap={2}
        onClick={canSave ? handleProofread : undefined}
        testID="ai-dataset-item-proofread"
      >
        <CheckBox selected={proofread} />
        <Text>Proofread — this expected output is a golden label</Text>
      </Box>
      <Text color="secondaryDark" size="sm">
        Unticked items stay in Needs review and do not count toward experiments.
      </Text>
      {onOpenTrace ? (
        <Button
          onClick={onOpenTrace}
          testID="ai-dataset-item-open-trace"
          text="Open source trace"
          variant="secondary"
        />
      ) : null}
      {error ? (
        <Text color="error" testID="ai-dataset-item-error">
          {error}
        </Text>
      ) : null}
      {canSave ? (
        <Box alignItems="start">
          <Button
            loading={isSaving}
            onClick={onSave}
            testID="ai-dataset-item-save"
            text={saveLabel}
          />
        </Box>
      ) : (
        <Text color="secondaryDark">You can view this item. Saving needs dataset update.</Text>
      )}
    </Box>
  );
};
