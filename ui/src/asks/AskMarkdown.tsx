import {
  type AskResponse,
  type AskValidationError,
  type MarkdownAskInput,
  markdownLengthBounds,
  validateAskResponse,
} from "@terreno/blocks";
import type React from "react";
import {useCallback, useMemo, useState} from "react";

import {Box} from "../Box";
import {Button} from "../Button";
import {MarkdownEditorField} from "../MarkdownEditorField";
import {MarkdownView} from "../MarkdownView";
import {type AskControlProps, AskErrors, SkipButton, useAnswerButton} from "./askControls";
import {formatCount} from "./askSummary";
import type {ChatAsk} from "./askTypes";

const SUBMIT_ACTION_ID = "submit";

/** Answers longer than this show a preview in the transcript until the user expands them. */
export const MARKDOWN_ANSWER_PREVIEW_LENGTH = 280;

const WORD_BOUNDARY = /\s\S*$/;

export interface AskMarkdownProps extends AskControlProps {
  ask: Extract<ChatAsk, {kind: "markdown"}>;
}

/** "120 / 2,000 characters. At least 20." from the draft's length and the ask's bounds. */
const lengthHint = (input: MarkdownAskInput, markdown: string): string => {
  const {max, min} = markdownLengthBounds(input);
  const count = `${formatCount(markdown.length)} / ${formatCount(max)} characters.`;
  return min > 0 ? `${count} At least ${formatCount(min)}.` : count;
};

const editorErrorText = ({
  errors,
  input,
  markdown,
}: {
  errors?: AskValidationError[];
  input: MarkdownAskInput;
  markdown: string;
}): string | undefined => {
  const {max} = markdownLengthBounds(input);
  if (markdown.length > max) {
    return `Keep this to ${formatCount(max)} characters or fewer.`;
  }
  return errors?.find((error) => error.path === "content.markdown")?.message;
};

/**
 * Edit a markdown draft and send it back. The editor starts from the ask's `initial` draft, and
 * Submit is enabled once the text meets the ask's length rules. The answer's `changed` says whether
 * the text differs from the draft.
 */
export const AskMarkdown: React.FC<AskMarkdownProps> = ({
  ask,
  errors,
  isDisabled,
  onAnswer,
  pendingActionId,
  testID,
}) => {
  const {input} = ask;
  const initial = input.initial ?? "";
  const [markdown, setMarkdown] = useState<string>(initial);
  const isAnswering = pendingActionId !== undefined;
  const renderButton = useAnswerButton({isDisabled, onAnswer, pendingActionId, testID});

  const draft = useMemo(
    (): AskResponse => ({action: "accept", content: {changed: markdown !== initial, markdown}}),
    [initial, markdown]
  );
  const isDraftValid = useMemo(
    () => validateAskResponse({input, kind: "markdown", response: draft}).length === 0,
    [draft, input]
  );

  const handleChange = useCallback(
    (value: string): void => {
      if (isDisabled || isAnswering) {
        return;
      }
      setMarkdown(value);
    },
    [isAnswering, isDisabled]
  );

  const handleSubmit = useCallback(
    (): void | Promise<void> => onAnswer({actionId: SUBMIT_ACTION_ID, response: draft}),
    [draft, onAnswer]
  );

  return (
    <Box gap={3}>
      <MarkdownEditorField
        disabled={isDisabled || isAnswering}
        errorText={editorErrorText({errors, input, markdown})}
        helperText={lengthHint(input, markdown)}
        maxHeight={320}
        onChange={handleChange}
        placeholder={input.placeholder}
        testID={`${testID}-editor`}
        value={markdown}
      />
      <AskErrors
        errors={errors?.filter((error) => error.path !== "content.markdown")}
        testID={`${testID}-errors`}
      />
      <Box direction="row" gap={2} wrap>
        <Button
          disabled={
            isDisabled || !isDraftValid || (isAnswering && pendingActionId !== SUBMIT_ACTION_ID)
          }
          loading={pendingActionId === SUBMIT_ACTION_ID}
          onClick={handleSubmit}
          testID={`${testID}-submit`}
          text={input.submitLabel ?? "Submit"}
          wrapText
        />
        <SkipButton ask={ask} renderButton={renderButton} />
      </Box>
    </Box>
  );
};

/** The start of a long answer, cut at a word boundary when one falls in its second half. */
const previewOf = (markdown: string): string => {
  let kept = markdown.slice(0, MARKDOWN_ANSWER_PREVIEW_LENGTH);
  const boundary = kept.search(WORD_BOUNDARY);
  if (boundary >= MARKDOWN_ANSWER_PREVIEW_LENGTH / 2) {
    kept = kept.slice(0, boundary);
  }
  return `${kept.trimEnd()}…`;
};

/**
 * The text an answered `markdown` ask sent back, under its summary line. A long answer shows a
 * preview with Show all, so it does not push the rest of the transcript out of view.
 */
export const AskMarkdownAnswer = ({
  markdown,
  testID,
}: {
  markdown: string;
  testID: string;
}): React.ReactElement | null => {
  const [isExpanded, setIsExpanded] = useState(false);
  const isLong = markdown.length > MARKDOWN_ANSWER_PREVIEW_LENGTH;

  const handleToggle = useCallback((): void => {
    setIsExpanded((wasExpanded) => !wasExpanded);
  }, []);

  if (markdown.trim() === "") {
    return null;
  }
  return (
    <Box border="default" gap={2} padding={3} rounding="md" testID={`${testID}-answer`}>
      <MarkdownView>{isLong && !isExpanded ? previewOf(markdown) : markdown}</MarkdownView>
      {isLong ? (
        <Box alignSelf="start">
          <Button
            iconName={isExpanded ? "chevron-up" : "chevron-down"}
            onClick={handleToggle}
            testID={`${testID}-answer-toggle`}
            text={isExpanded ? "Show less" : "Show all"}
            variant="ghost"
          />
        </Box>
      ) : null}
    </Box>
  );
};
