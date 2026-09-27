import {z} from "zod";
import {type AskValidationError, askIssue, quoteValue} from "./errors";
import {ASK_LIMITS} from "./limits";
import {
  ASK_KINDS,
  type Ask,
  type AskResponse,
  askResponseSchema,
  type ChoiceAskInput,
  type ChoiceOption,
} from "./schema";

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
 * the user needs the full app to answer. A card with a button for every option has `handoff: false`
 * even when Skip is left out to make room.
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
  label: shorten(option.label, ASK_LIMITS.simpleCard.buttonLabelMaxLength),
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
  const label = shorten(defaultOption.label, USE_DEFAULT_LABEL_MAX_LENGTH);
  const namesAnotherOption = options.some(
    (option) =>
      option !== defaultOption && shorten(option.label, USE_DEFAULT_LABEL_MAX_LENGTH) === label
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

const choiceCard = (input: ChoiceAskInput): Pick<SimpleCard, "buttons" | "handoff"> => {
  const {buttonsMax} = ASK_LIMITS.simpleCard;
  const skipButtons = input.allowDecline === false ? [] : [SKIP_BUTTON];
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
export const toSimpleCard = ({input, kind, toolCallId}: Ask & {toolCallId: string}): SimpleCard => {
  const {textMaxLength, titleMaxLength} = ASK_LIMITS.simpleCard;
  const title = input.title === undefined ? {} : {title: shorten(input.title, titleMaxLength)};
  switch (kind) {
    case "choice":
      return {
        ...choiceCard(input),
        kind,
        text: shorten(input.prompt, textMaxLength),
        ...title,
        toolCallId,
      };
  }
};
