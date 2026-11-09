import {z} from "zod";
import {type AskValidationError, askIssue, quoteValue} from "./errors";
import {formDefaultValues} from "./formValues";
import {ASK_LIMITS} from "./limits";
import {
  ASK_KINDS,
  type Ask,
  type AskResponse,
  askResponseSchema,
  type ChoiceAskInput,
  type ChoiceOption,
  type ConfirmAskInput,
  confirmButtonLabels,
  type FilesAskInput,
  type FormAskInput,
  type MarkdownAskInput,
  visibleLabel,
} from "./schema";
import {validateAskResponse} from "./validateResponse";

export const SIMPLE_CARD_BUTTON_STYLES = ["default", "primary", "destructive", "cancel"] as const;

const ELLIPSIS = "…";
const HIGH_SURROGATE = /[\uD800-\uDBFF]$/;
const LAST_WORD = /\s\S*$/;
const WHITESPACE = /\s/;
const USE_DEFAULT_LABEL_MAX_LENGTH = ASK_LIMITS.simpleCard.buttonLabelMaxLength - 'Use ""'.length;

export const simpleCardButtonSchema = z
  .object({
    id: z.string().min(1),
    label: z.string().min(1).max(ASK_LIMITS.simpleCard.buttonLabelMaxLength),
    response: askResponseSchema,
    style: z.enum(SIMPLE_CARD_BUTTON_STYLES),
  })
  .strict();

export type SimpleCardButton = z.infer<typeof simpleCardButtonSchema>;

/**
 * The small-screen form of an ask: short text and at most three buttons, each carrying the exact
 * answer it sends. `handoff` is true when the buttons cannot show every option the ask offers, so
 * the user needs the full app to answer; a select-many ask always hands off, because one tap cannot
 * pick several, and so do a markdown ask, because a draft cannot be edited there, a form ask,
 * because fields cannot be filled in there, and a files ask, because files cannot be picked there.
 * A card with a button for every option has
 * `handoff: false` even when Skip is left out to make room.
 */
export const simpleCardSchema = z
  .object({
    buttons: z.array(simpleCardButtonSchema).max(ASK_LIMITS.simpleCard.buttonsMax),
    handoff: z.boolean(),
    kind: z.enum(ASK_KINDS),
    text: z.string().min(1).max(ASK_LIMITS.simpleCard.textMaxLength),
    title: z.string().min(1).max(ASK_LIMITS.simpleCard.titleMaxLength).optional(),
    toolCallId: z.string().min(1),
  })
  .strict()
  .superRefine((card, ctx) => {
    const seen = new Set<string>();
    card.buttons.forEach((button, index) => {
      if (!seen.has(button.id)) {
        seen.add(button.id);
        return;
      }
      ctx.addIssue(
        askIssue({
          code: "DUPLICATE_ID",
          fix: "Give every button a unique id.",
          message: `Button id ${quoteValue(button.id)} is used more than once.`,
          segments: ["buttons", index, "id"],
        })
      );
    });
  });

export type SimpleCard = z.infer<typeof simpleCardSchema>;

/**
 * Cuts `text` to at most `maxLength` UTF-16 units, ending in "…". Prefers a word boundary when one
 * falls in the second half of the kept text, and never splits a surrogate pair.
 */
const shorten = (text: string, maxLength: number): string => {
  if (text.length <= maxLength) {
    return text;
  }
  let kept = text.slice(0, maxLength - ELLIPSIS.length);
  if (HIGH_SURROGATE.test(kept)) {
    kept = kept.slice(0, -1);
  }
  if (!WHITESPACE.test(text.charAt(kept.length))) {
    const boundary = kept.search(LAST_WORD);
    if (boundary >= Math.floor(maxLength / 2)) {
      kept = kept.slice(0, boundary);
    }
  }
  return `${kept.trimEnd()}${ELLIPSIS}`;
};

/** A label as its button shows it: without spaces at either end, cut to fit. */
const buttonLabel = (
  label: string,
  maxLength: number = ASK_LIMITS.simpleCard.buttonLabelMaxLength
): string => shorten(visibleLabel(label), maxLength);

const SKIP_BUTTON: SimpleCardButton = {
  id: "skip",
  label: "Skip",
  response: {action: "decline"},
  style: "cancel",
};

const acceptSelected = (id: string): AskResponse => ({
  action: "accept",
  content: {selected: [id]},
});

const optionButton = (option: ChoiceOption, isDefault: boolean): SimpleCardButton => ({
  id: `option:${option.id}`,
  label: buttonLabel(option.label),
  response: acceptSelected(option.id),
  style: isDefault ? "primary" : "default",
});

const hasDistinctLabels = (buttons: SimpleCardButton[]): boolean =>
  new Set(buttons.map((button) => button.label)).size === buttons.length;

/**
 * The shortcut to the default when the options don't fit. It is left out when its cut label also
 * fits another option, because the user could not tell which option a tap picks.
 */
const useDefaultButtons = (
  options: ChoiceOption[],
  defaultOption: ChoiceOption | undefined
): SimpleCardButton[] => {
  if (!defaultOption) {
    return [];
  }
  const label = buttonLabel(defaultOption.label, USE_DEFAULT_LABEL_MAX_LENGTH);
  const namesAnotherOption = options.some(
    (option) =>
      option !== defaultOption && buttonLabel(option.label, USE_DEFAULT_LABEL_MAX_LENGTH) === label
  );
  if (namesAnotherOption) {
    return [];
  }
  return [
    {
      id: "use-default",
      label: `Use "${label}"`,
      response: acceptSelected(defaultOption.id),
      style: "primary",
    },
  ];
};

/**
 * The shortcut to a many-select's default, when the default is a valid answer on its own. The
 * button cannot list every option it picks, so the card still hands off.
 */
const useSuggestedButtons = (input: ChoiceAskInput): SimpleCardButton[] => {
  const defaults = input.default ?? [];
  if (defaults.length === 0) {
    return [];
  }
  const response: AskResponse = {action: "accept", content: {selected: [...defaults]}};
  if (validateAskResponse({input, kind: "choice", response}).length > 0) {
    return [];
  }
  return [{id: "use-default", label: "Use suggested", response, style: "primary"}];
};

const choiceCard = (input: ChoiceAskInput): Pick<SimpleCard, "buttons" | "handoff"> => {
  const {buttonsMax} = ASK_LIMITS.simpleCard;
  const skipButtons = input.allowDecline === false ? [] : [SKIP_BUTTON];
  if (input.select === "many") {
    return {buttons: [...useSuggestedButtons(input), ...skipButtons], handoff: true};
  }
  const defaultOption = input.options.find((option) => option.id === input.default?.[0]);
  if (input.options.length > buttonsMax) {
    return {
      buttons: [...useDefaultButtons(input.options, defaultOption), ...skipButtons],
      handoff: true,
    };
  }

  const defaultFirst = defaultOption
    ? [defaultOption, ...input.options.filter((option) => option !== defaultOption)]
    : input.options;
  const optionButtons = defaultFirst.map((option) =>
    optionButton(option, option === defaultOption)
  );
  if (!hasDistinctLabels(optionButtons)) {
    return {buttons: skipButtons, handoff: true};
  }
  const hasRoomForSkip = optionButtons.length < buttonsMax;
  return {
    buttons: hasRoomForSkip ? [...optionButtons, ...skipButtons] : optionButtons,
    handoff: false,
  };
};

/**
 * Approve first and deny last (D26). A destructive approve is styled `destructive`, so a watch's
 * Double Tap, which presses the first non-destructive button, can only deny. Deny is the negative
 * answer, so the card has no Skip even when the ask allows declining.
 */
const confirmCard = (input: ConfirmAskInput): Pick<SimpleCard, "buttons" | "handoff"> => {
  const labels = confirmButtonLabels(input);
  return {
    buttons: [
      {
        id: "approve",
        label: buttonLabel(labels.confirm),
        response: {action: "accept", content: {confirmed: true}},
        style: input.destructive === true ? "destructive" : "primary",
      },
      {
        id: "deny",
        label: buttonLabel(labels.deny),
        response: {action: "accept", content: {confirmed: false}},
        style: "cancel",
      },
    ],
    handoff: false,
  };
};

/**
 * A draft cannot be edited on a small screen, so the card always hands off. Approve draft sends the
 * draft unchanged, and is left out when the draft breaks the ask's length rules. Cancel declines.
 */
const markdownCard = (input: MarkdownAskInput): Pick<SimpleCard, "buttons" | "handoff"> => {
  const response: AskResponse = {
    action: "accept",
    content: {changed: false, markdown: input.initial ?? ""},
  };
  const isDraftValid = validateAskResponse({input, kind: "markdown", response}).length === 0;
  const approveButtons: SimpleCardButton[] = isDraftValid
    ? [{id: "approve", label: "Approve draft", response, style: "primary"}]
    : [];
  const cancelButtons: SimpleCardButton[] =
    input.allowDecline === false
      ? []
      : [{id: "cancel", label: "Cancel", response: {action: "decline"}, style: "cancel"}];
  return {buttons: [...approveButtons, ...cancelButtons], handoff: true};
};

/**
 * Fields cannot be filled in on a small screen, so the card always hands off. Submit defaults sends
 * the fields' defaults, and is offered only when the form has a default and every required field
 * has one, so the answer is valid. Cancel declines.
 */
const formCard = (input: FormAskInput): Pick<SimpleCard, "buttons" | "handoff"> => {
  const values = formDefaultValues(input);
  const hasEveryRequiredDefault = input.fields.every(
    (field) => field.required !== true || Object.hasOwn(values, field.id)
  );
  const response: AskResponse = {action: "accept", content: {values}};
  const isSubmittable =
    Object.keys(values).length > 0 &&
    hasEveryRequiredDefault &&
    validateAskResponse({input, kind: "form", response}).length === 0;
  const submitButtons: SimpleCardButton[] = isSubmittable
    ? [{id: "submit-defaults", label: "Submit defaults", response, style: "primary"}]
    : [];
  const cancelButtons: SimpleCardButton[] =
    input.allowDecline === false
      ? []
      : [{id: "cancel", label: "Cancel", response: {action: "decline"}, style: "cancel"}];
  return {buttons: [...submitButtons, ...cancelButtons], handoff: true};
};

/** Files cannot be picked on a small screen, so the card always hands off. Skip declines. */
const filesCard = (input: FilesAskInput): Pick<SimpleCard, "buttons" | "handoff"> => ({
  buttons: input.allowDecline === false ? [] : [SKIP_BUTTON],
  handoff: true,
});

const kindCard = (ask: Ask): Pick<SimpleCard, "buttons" | "handoff"> => {
  switch (ask.kind) {
    case "choice":
      return choiceCard(ask.input);
    case "confirm":
      return confirmCard(ask.input);
    case "markdown":
      return markdownCard(ask.input);
    case "form":
      return formCard(ask.input);
    case "files":
      return filesCard(ask.input);
  }
};

/**
 * The answer a pressed button sends: the `response` stored on the card's button with that id.
 * Returns an `UNKNOWN_BUTTON` error instead when the card has no such button, so a small client can
 * only send answers the card offered.
 */
export const resolveButtonAnswer = ({
  buttonId,
  card,
}: {
  buttonId: string;
  card: SimpleCard;
}): {errors: AskValidationError[]; response?: AskResponse} => {
  const button = card.buttons.find((candidate) => candidate.id === buttonId);
  if (button) {
    return {errors: [], response: button.response};
  }
  const buttonIds = card.buttons.map((candidate) => quoteValue(candidate.id)).join(", ");
  return {
    errors: [
      {
        code: "UNKNOWN_BUTTON",
        fix:
          buttonIds === ""
            ? "The card has no buttons. Send a full askResponse instead."
            : `Send the id of one of the card's buttons: ${buttonIds}.`,
        message: `Button ${quoteValue(buttonId)} is not on the pending ask's simple card.`,
        path: "buttonId",
      },
    ],
  };
};

/**
 * Derives the simple card for a valid ask. Pure and deterministic: the same ask always gives the
 * same card, and every button's `response` passes `validateAskResponse` for that ask.
 */
export const toSimpleCard = ({
  toolCallId,
  ...askFields
}: Ask & {toolCallId: string}): SimpleCard => {
  const ask = askFields as Ask;
  const {textMaxLength, titleMaxLength} = ASK_LIMITS.simpleCard;
  const {input, kind} = ask;
  const title = input.title === undefined ? {} : {title: shorten(input.title, titleMaxLength)};
  const card = kindCard(ask);
  return {...card, kind, text: shorten(input.prompt, textMaxLength), ...title, toolCallId};
};
