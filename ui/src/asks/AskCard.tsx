import {type AskValidationError, validateAskInput} from "@terreno/blocks";
import type React from "react";
import {useCallback, useRef, useState} from "react";

import {Box} from "../Box";
import type {IconName} from "../Common";
import {Heading} from "../Heading";
import {Icon} from "../Icon";
import {Text} from "../Text";
import {AskChoice} from "./AskChoice";
import {AskConfirm} from "./AskConfirm";
import {AskForm, AskFormAnswer} from "./AskForm";
import {AskMarkdown, AskMarkdownAnswer} from "./AskMarkdown";
import type {AskAction} from "./askControls";
import {askSummary} from "./askSummary";
import type {AskSubmitHandler, ChatAsk} from "./askTypes";

export interface AskCardProps {
  /** The ask to show. Pending asks are interactive; answered and cancelled asks show a summary. */
  ask: ChatAsk;
  /** Errors for the last answer, such as the `fields` of a 400 from the server. Shown inline. */
  errors?: AskValidationError[];
  /**
   * Called with the user's answer. The pressed control shows a loading state until the returned
   * promise settles. Without it, the card cannot be answered: buttons and the select are
   * disabled, and radio options show as plain text.
   */
  onSubmit?: AskSubmitHandler;
  testID?: string;
}

const summaryIcon = (ask: ChatAsk): IconName => {
  if (ask.response?.action === "accept" || (!ask.response && ask.status === "answered")) {
    return "circle-check";
  }
  return "circle-minus";
};

const AskSummaryLine = ({ask, testID}: {ask: ChatAsk; testID: string}): React.ReactElement => (
  <Box alignItems="center" direction="row" gap={2} testID={`${testID}-summary`}>
    <Icon color="secondaryDark" iconName={summaryIcon(ask)} size="sm" />
    <Text color="secondaryDark" size="sm">
      {askSummary(ask)}
    </Text>
  </Box>
);

/** The text an accepted `markdown` answer sent back, or undefined for any other answer. */
const answeredMarkdown = (ask: ChatAsk): string | undefined => {
  if (ask.kind !== "markdown" || ask.response?.action !== "accept") {
    return undefined;
  }
  const {markdown} = ask.response.content;
  return typeof markdown === "string" ? markdown : undefined;
};

/** What an accepted answer sent back, for kinds that show more than the summary line. */
const AnswerDetail = ({ask, testID}: {ask: ChatAsk; testID: string}): React.ReactElement | null => {
  if (ask.response?.action !== "accept") {
    return null;
  }
  const markdown = answeredMarkdown(ask);
  if (markdown !== undefined) {
    return <AskMarkdownAnswer markdown={markdown} testID={testID} />;
  }
  const {values} = ask.response.content;
  if (ask.kind === "form" && values !== null && typeof values === "object") {
    return <AskFormAnswer ask={ask} testID={testID} values={values as Record<string, unknown>} />;
  }
  return null;
};

const AskSummary = ({ask, testID}: {ask: ChatAsk; testID: string}): React.ReactElement => (
  <Box gap={2}>
    <AskSummaryLine ask={ask} testID={testID} />
    <AnswerDetail ask={ask} testID={testID} />
  </Box>
);

const AskBody = ({
  ask,
  errors,
  isDisabled,
  onAnswer,
  pendingActionId,
  testID,
}: {
  ask: ChatAsk;
  errors?: AskValidationError[];
  isDisabled: boolean;
  onAnswer: (action: AskAction) => Promise<void>;
  pendingActionId?: string;
  testID: string;
}): React.ReactElement => {
  switch (ask.kind) {
    case "choice":
      return (
        <AskChoice
          ask={ask}
          errors={errors}
          isDisabled={isDisabled}
          onAnswer={onAnswer}
          pendingActionId={pendingActionId}
          testID={testID}
        />
      );
    case "confirm":
      return (
        <AskConfirm
          ask={ask}
          errors={errors}
          isDisabled={isDisabled}
          onAnswer={onAnswer}
          pendingActionId={pendingActionId}
          testID={testID}
        />
      );
    case "markdown":
      return (
        <AskMarkdown
          ask={ask}
          errors={errors}
          isDisabled={isDisabled}
          onAnswer={onAnswer}
          pendingActionId={pendingActionId}
          testID={testID}
        />
      );
    case "form":
      return (
        <AskForm
          ask={ask}
          errors={errors}
          isDisabled={isDisabled}
          onAnswer={onAnswer}
          pendingActionId={pendingActionId}
          testID={testID}
        />
      );
  }
};

/**
 * A question the agent asked, shown in the transcript. Renders the kind's controls while the ask
 * is pending and a one-line summary of the answer afterwards.
 */
export const AskCard: React.FC<AskCardProps> = ({ask, errors, onSubmit, testID = "ask-card"}) => {
  const [pendingActionId, setPendingActionId] = useState<string | undefined>(undefined);
  const isAnsweringRef = useRef(false);
  const {toolCallId} = ask;

  const handleAnswer = useCallback(
    async ({actionId, response}: AskAction): Promise<void> => {
      if (!onSubmit || isAnsweringRef.current) {
        return;
      }
      isAnsweringRef.current = true;
      setPendingActionId(actionId);
      try {
        await onSubmit({response, toolCallId});
      } catch (error) {
        console.warn("[AskCard] Submitting the answer failed", {error, toolCallId});
      } finally {
        isAnsweringRef.current = false;
        setPendingActionId(undefined);
      }
    },
    [onSubmit, toolCallId]
  );

  if (ask.status !== "pending") {
    return <AskSummary ask={ask} testID={testID} />;
  }

  if (validateAskInput({input: ask.input, kind: ask.kind}).length > 0) {
    return (
      <Box border="default" color="base" padding={3} rounding="md" testID={testID}>
        <Text color="secondaryDark" size="sm" testID={`${testID}-invalid`}>
          This question cannot be shown. Send a message to continue.
        </Text>
      </Box>
    );
  }

  return (
    <Box border="default" color="base" gap={3} padding={3} rounding="md" testID={testID}>
      {ask.input.title ? <Heading size="sm">{ask.input.title}</Heading> : null}
      <Text>{ask.input.prompt}</Text>
      <AskBody
        ask={ask}
        errors={errors}
        isDisabled={!onSubmit}
        onAnswer={handleAnswer}
        pendingActionId={pendingActionId}
        testID={testID}
      />
    </Box>
  );
};
