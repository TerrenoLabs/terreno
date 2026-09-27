import {
  ASK_LIMITS,
  type AskResponse,
  type AskValidationError,
  type ChoiceAskInput,
  type ChoiceOption,
  choiceSelectionBounds,
  type SimpleCard,
  type SimpleCardButton,
  toSimpleCard,
  validateAskResponse,
} from "@terreno/blocks";
import type React from "react";
import {useCallback, useMemo, useState} from "react";

import {Box} from "../Box";
import {Button} from "../Button";
import type {FieldOption} from "../Common";
import {MultiselectField} from "../MultiselectField";
import {RadioField} from "../RadioField";
import {SelectField} from "../SelectField";
import {Text} from "../Text";
import {TextField} from "../TextField";
import type {ChatAsk} from "./askTypes";
import {SIMPLE_CARD_BUTTON_VARIANTS} from "./simpleCardButtonVariants";

/** Above this many options, the choice is a searchable select instead of radio buttons. */
const RADIO_OPTIONS_MAX = 8;

const SUBMIT_ACTION_ID = "submit";

const SKIP_BUTTON: SimpleCardButton = {
  id: "skip",
  label: "Skip",
  response: {action: "decline"},
  style: "cancel",
};

/** An answer from one of the card's controls, named so the card can show that control loading. */
export interface AskAction {
  actionId: string;
  response: AskResponse;
}

export interface AskChoiceProps {
  ask: Extract<ChatAsk, {kind: "choice"}>;
  errors?: AskValidationError[];
  /** True when the host takes no answers: buttons are disabled and radio options are plain text. */
  isDisabled: boolean;
  onAnswer: (action: AskAction) => void | Promise<void>;
  /** The control whose answer the host is still handling. */
  pendingActionId?: string;
  testID: string;
}

/**
 * The simple card's option buttons fit when the card needs no handoff and every label shows in
 * full (D18), so a phone shows the same buttons as a watch.
 */
const fitsQuickReplies = (card: SimpleCard, input: ChoiceAskInput): boolean =>
  !card.handoff &&
  input.options.every(
    (option) => option.label.length <= ASK_LIMITS.simpleCard.buttonLabelMaxLength
  );

const quickReplyButtons = (card: SimpleCard, input: ChoiceAskInput): SimpleCardButton[] => {
  const hasSkip = card.buttons.some((button) => button.response.action === "decline");
  if (hasSkip || input.allowDecline === false) {
    return card.buttons;
  }
  return [...card.buttons, SKIP_BUTTON];
};

const describedLabel = (option: ChoiceOption): string =>
  option.description ? `${option.label} — ${option.description}` : option.label;

const toFieldOptions = (input: ChoiceAskInput, isRadio: boolean): FieldOption[] =>
  input.options.map((option) => {
    if (isRadio) {
      return {key: option.id, label: describedLabel(option), value: option.id};
    }
    return {helperText: option.description, key: option.id, label: option.label, value: option.id};
  });

const AskErrors = ({
  errors,
  testID,
}: {
  errors?: AskValidationError[];
  testID: string;
}): React.ReactElement | null => {
  if (!errors || errors.length === 0) {
    return null;
  }
  return (
    <Box gap={1} testID={testID}>
      {errors.map((error) => (
        <Text color="error" key={`${error.path}:${error.code}`} size="sm">
          {error.message}
        </Text>
      ))}
    </Box>
  );
};

const OptionDescriptions = ({input}: {input: ChoiceAskInput}): React.ReactElement | null => {
  const described = input.options.filter((option) => option.description);
  if (described.length === 0) {
    return null;
  }
  return (
    <Box gap={1}>
      {described.map((option) => (
        <Text color="secondaryDark" key={option.id} size="sm">
          {describedLabel(option)}
        </Text>
      ))}
    </Box>
  );
};

/** The options as plain text, for a card whose host takes no answers. */
const ReadOnlyOptions = ({
  input,
  testID,
}: {
  input: ChoiceAskInput;
  testID: string;
}): React.ReactElement => (
  <Box gap={1} testID={testID}>
    {input.options.map((option) => (
      <Text key={option.id} size="sm">
        {describedLabel(option)}
      </Text>
    ))}
  </Box>
);

const SkipButton = ({
  input,
  renderButton,
}: {
  input: ChoiceAskInput;
  renderButton: (button: SimpleCardButton) => React.ReactElement;
}): React.ReactElement | null => (input.allowDecline === false ? null : renderButton(SKIP_BUTTON));

const useAnswerButton = ({
  isDisabled,
  onAnswer,
  pendingActionId,
  testID,
}: Pick<AskChoiceProps, "isDisabled" | "onAnswer" | "pendingActionId" | "testID">): ((
  button: SimpleCardButton
) => React.ReactElement) => {
  const isAnswering = pendingActionId !== undefined;
  return useCallback(
    (button: SimpleCardButton): React.ReactElement => (
      <Button
        disabled={isDisabled || (isAnswering && pendingActionId !== button.id)}
        key={button.id}
        loading={pendingActionId === button.id}
        onClick={() => onAnswer({actionId: button.id, response: button.response})}
        testID={`${testID}-button-${button.id}`}
        text={button.label}
        variant={SIMPLE_CARD_BUTTON_VARIANTS[button.style]}
        wrapText
      />
    ),
    [isAnswering, isDisabled, onAnswer, pendingActionId, testID]
  );
};

const otherTitle = (input: ChoiceAskInput): string => input.otherLabel ?? "Other";

/** "Choose up to 3. Other counts as one choice." from the ask's selection bounds. */
const selectionHint = (input: ChoiceAskInput): string => {
  const {max, min} = choiceSelectionBounds(input);
  const otherNote = input.allowOther === true ? ` ${otherTitle(input)} counts as one choice.` : "";
  if (min === max) {
    return `Choose ${min === 1 ? "one" : min}.${otherNote}`;
  }
  if (min === 0) {
    return `Choose up to ${max}.${otherNote}`;
  }
  return `Choose ${min} to ${max}.${otherNote}`;
};

const otherErrorText = ({
  errors,
  otherText,
}: {
  errors?: AskValidationError[];
  otherText: string;
}): string | undefined => {
  const {otherMaxLength} = ASK_LIMITS.choice;
  if (otherText.trim().length > otherMaxLength) {
    return `Keep this to ${otherMaxLength} characters or fewer.`;
  }
  return errors?.find((error) => error.path === "content.other")?.message;
};

/**
 * Pick several options as checkboxes, plus an Other text field when the ask allows it. Submit is
 * enabled once the options and the Other text together meet the ask's selection bounds.
 */
const AskChoiceMany: React.FC<AskChoiceProps> = ({
  ask,
  errors,
  isDisabled,
  onAnswer,
  pendingActionId,
  testID,
}) => {
  const {input} = ask;
  const [selectedIds, setSelectedIds] = useState<string[]>(input.default ?? []);
  const [otherText, setOtherText] = useState<string>("");
  const isAnswering = pendingActionId !== undefined;
  const renderButton = useAnswerButton({isDisabled, onAnswer, pendingActionId, testID});
  const fieldOptions = useMemo(
    (): FieldOption[] =>
      input.options.map((option) => ({
        key: option.id,
        label: describedLabel(option),
        value: option.id,
      })),
    [input.options]
  );

  const draft = useMemo((): AskResponse => {
    const selected = input.options
      .map((option) => option.id)
      .filter((id) => selectedIds.includes(id));
    const other = otherText.trim();
    return {action: "accept", content: other === "" ? {selected} : {other, selected}};
  }, [input.options, otherText, selectedIds]);
  const isDraftValid = useMemo(
    () => validateAskResponse({input, kind: "choice", response: draft}).length === 0,
    [draft, input]
  );

  const {max} = choiceSelectionBounds(input);
  const choiceCount = selectedIds.length + (otherText.trim() === "" ? 0 : 1);
  const countErrorText =
    choiceCount > max ? `You chose ${choiceCount}. Choose at most ${max}.` : undefined;

  const handleChange = useCallback(
    (values: string[]): void => {
      if (isDisabled || isAnswering) {
        return;
      }
      setSelectedIds(values);
    },
    [isAnswering, isDisabled]
  );

  const handleOtherChange = useCallback(
    (value: string): void => {
      if (isDisabled || isAnswering) {
        return;
      }
      setOtherText(value);
    },
    [isAnswering, isDisabled]
  );

  const handleSubmit = useCallback(
    (): void | Promise<void> => onAnswer({actionId: SUBMIT_ACTION_ID, response: draft}),
    [draft, onAnswer]
  );

  return (
    <Box gap={3}>
      {isDisabled ? (
        <ReadOnlyOptions input={input} testID={`${testID}-options`} />
      ) : (
        <MultiselectField
          errorText={countErrorText}
          helperText={selectionHint(input)}
          onChange={handleChange}
          options={fieldOptions}
          testID={`${testID}-multiselect`}
          title="Choose options"
          value={selectedIds}
        />
      )}
      {input.allowOther === true ? (
        <TextField
          disabled={isDisabled || isAnswering}
          errorText={otherErrorText({errors, otherText})}
          onChange={handleOtherChange}
          placeholder="Type your own answer"
          testID={`${testID}-other`}
          title={otherTitle(input)}
          value={otherText}
        />
      ) : null}
      <AskErrors
        errors={errors?.filter((error) => error.path !== "content.other")}
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
        <SkipButton input={input} renderButton={renderButton} />
      </Box>
    </Box>
  );
};

/**
 * Pick one option. Options that fit a simple card render as its buttons and answer on tap; up to
 * eight options render as radio buttons, and more as a searchable select, each with Submit.
 */
const AskChoiceOne: React.FC<AskChoiceProps> = ({
  ask,
  errors,
  isDisabled,
  onAnswer,
  pendingActionId,
  testID,
}) => {
  const {input, toolCallId} = ask;
  const [selectedId, setSelectedId] = useState<string>(input.default?.[0] ?? "");
  const isAnswering = pendingActionId !== undefined;

  const card = useMemo(
    (): SimpleCard => ask.simple ?? toSimpleCard({input, kind: "choice", toolCallId}),
    [ask.simple, input, toolCallId]
  );
  const isQuickReply = fitsQuickReplies(card, input);
  const isRadio = input.options.length <= RADIO_OPTIONS_MAX;
  const fieldOptions = useMemo(() => toFieldOptions(input, isRadio), [input, isRadio]);

  const draft = useMemo(
    (): AskResponse => ({action: "accept", content: {selected: [selectedId]}}),
    [selectedId]
  );
  const isDraftValid = useMemo(
    () =>
      selectedId !== "" &&
      validateAskResponse({input, kind: "choice", response: draft}).length === 0,
    [draft, input, selectedId]
  );

  const handleSelect = useCallback(
    (value: string): void => {
      if (isDisabled || isAnswering) {
        return;
      }
      setSelectedId(value);
    },
    [isAnswering, isDisabled]
  );

  const handleSubmit = useCallback(
    (): void | Promise<void> => onAnswer({actionId: SUBMIT_ACTION_ID, response: draft}),
    [draft, onAnswer]
  );

  const renderButton = useAnswerButton({isDisabled, onAnswer, pendingActionId, testID});

  const renderField = (): React.ReactElement => {
    if (!isRadio) {
      return (
        <SelectField
          disabled={isDisabled || isAnswering}
          onChange={handleSelect}
          options={fieldOptions}
          placeholder="Choose an option"
          testID={`${testID}-select`}
          title="Choose one"
          value={selectedId}
        />
      );
    }
    // RadioField has no disabled state, so a card that takes no answers lists the options instead.
    if (isDisabled) {
      return <ReadOnlyOptions input={input} testID={`${testID}-options`} />;
    }
    return (
      <RadioField
        onChange={handleSelect}
        options={fieldOptions}
        title="Choose one"
        value={selectedId}
      />
    );
  };

  if (isQuickReply) {
    return (
      <Box gap={3}>
        <OptionDescriptions input={input} />
        <Box direction="row" gap={2} testID={`${testID}-quick-replies`} wrap>
          {quickReplyButtons(card, input).map(renderButton)}
        </Box>
        <AskErrors errors={errors} testID={`${testID}-errors`} />
      </Box>
    );
  }

  return (
    <Box gap={3}>
      {renderField()}
      <AskErrors errors={errors} testID={`${testID}-errors`} />
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
        <SkipButton input={input} renderButton={renderButton} />
      </Box>
    </Box>
  );
};

/** One `choice` ask: select one or select many, each with its own controls. */
export const AskChoice: React.FC<AskChoiceProps> = (props) =>
  props.ask.input.select === "many" ? <AskChoiceMany {...props} /> : <AskChoiceOne {...props} />;
