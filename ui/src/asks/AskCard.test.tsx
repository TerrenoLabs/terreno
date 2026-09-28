import {afterEach, describe, it, mock, spyOn} from "bun:test";
import {
  type ChoiceAskInput,
  type ConfirmAskInput,
  type FormAskInput,
  type MarkdownAskInput,
  toSimpleCard,
} from "@terreno/blocks";
import {act, fireEvent, waitFor, within} from "@testing-library/react-native";
import {assert} from "chai";
import {TimezonePicker} from "../TimezonePicker";
import {renderWithTheme} from "../test-utils";
import {AskCard, type AskCardProps} from "./AskCard";
import type {AskSubmission, ChatAsk} from "./askTypes";

const PLAN_INPUT: ChoiceAskInput = {
  default: ["team"],
  options: [
    {description: "$0, one seat", id: "starter", label: "Starter"},
    {description: "$20 per seat", id: "team", label: "Team"},
    {id: "enterprise", label: "Enterprise"},
  ],
  prompt: "Which plan should I set up for your workspace?",
  select: "one",
  submitLabel: "Set up plan",
  title: "Choose a plan",
};

const REGION_INPUT: ChoiceAskInput = {
  options: [
    {description: "Oregon", id: "west", label: "West"},
    {id: "central", label: "Central"},
    {id: "east", label: "East"},
    {id: "europe", label: "Europe"},
    {id: "asia", label: "Asia"},
  ],
  prompt: "Where should the data live?",
  select: "one",
};

const COUNTRY_IDS = ["ar", "au", "br", "ca", "de", "es", "fr", "in", "it", "jp", "mx", "us"];

const COUNTRY_INPUT: ChoiceAskInput = {
  options: COUNTRY_IDS.map((id) => ({id, label: `Country ${id.toUpperCase()}`})),
  prompt: "Which country are you in?",
  select: "one",
};

const pendingAsk = (input: ChoiceAskInput, state: Partial<ChatAsk> = {}): ChatAsk => ({
  input,
  kind: "choice",
  status: "pending",
  toolCallId: "call_1",
  ...state,
});

const ARCHIVE_INPUT: ConfirmAskInput = {
  confirmLabel: "Archive 12 chats",
  denyLabel: "Keep them",
  destructive: true,
  prompt: "Archive the 12 chats older than 90 days?",
  title: "Archive old chats",
};

const REPORT_INPUT: ConfirmAskInput = {prompt: "Send the weekly report to the team now?"};

const pendingConfirm = (input: ConfirmAskInput, state: Partial<ChatAsk> = {}): ChatAsk =>
  ({input, kind: "confirm", status: "pending", toolCallId: "call_1", ...state}) as ChatAsk;

const DRAFT = "# We're live\n\nToday we launched.";

const DRAFT_INPUT: MarkdownAskInput = {
  initial: DRAFT,
  maxLength: 60,
  minLength: 10,
  placeholder: "Write the announcement",
  prompt: "Here is a draft announcement. Edit anything, then send it back.",
  submitLabel: "Send it back",
  title: "Launch announcement",
};

const pendingMarkdown = (input: MarkdownAskInput, state: Partial<ChatAsk> = {}): ChatAsk =>
  ({input, kind: "markdown", status: "pending", toolCallId: "call_1", ...state}) as ChatAsk;

const INVOICE_INPUT: FormAskInput = {
  fields: [
    {
      helperText: "As it appears on the invoice.",
      id: "company",
      label: "Company name",
      maxLength: 120,
      required: true,
      type: "text",
    },
    {id: "seats", integer: true, label: "Seats", max: 500, min: 1, type: "number"},
    {id: "start", label: "Start date", type: "date"},
    {
      id: "region",
      label: "Region",
      options: [
        {id: "us", label: "US"},
        {id: "eu", label: "EU"},
      ],
      type: "select",
    },
    {default: true, id: "notify", label: "Email me the invoice", type: "boolean"},
  ],
  prompt: "A few details for the invoice.",
  submitLabel: "Send details",
  title: "Invoice details",
};

const DEFAULTS_INPUT: FormAskInput = {
  fields: [
    {default: "Ring twice.", id: "notes", label: "Notes", type: "textarea"},
    {id: "email", label: "Email", required: true, type: "email"},
    {default: "https://example.com", id: "site", label: "Website", type: "url"},
    {id: "phone", label: "Phone", type: "phone"},
    {default: "09:30", id: "reminder", label: "Reminder", type: "time"},
    {default: "2026-10-01T09:30:00Z", id: "meeting", label: "Meeting", type: "datetime"},
    {
      default: "express",
      id: "shipping",
      label: "Shipping",
      options: [
        {id: "standard", label: "Standard"},
        {id: "express", label: "Express"},
      ],
      type: "select",
    },
    {
      default: ["email"],
      id: "channels",
      label: "Channels",
      options: [
        {id: "email", label: "Email"},
        {id: "sms", label: "Text message"},
      ],
      type: "multiselect",
    },
  ],
  prompt: "Check the details.",
};

const pendingForm = (input: FormAskInput, state: Partial<ChatAsk> = {}): ChatAsk =>
  ({input, kind: "form", status: "pending", toolCallId: "call_1", ...state}) as ChatAsk;

const renderCard = (props: Partial<AskCardProps> & Pick<AskCardProps, "ask">) =>
  renderWithTheme(<AskCard onSubmit={mock(async () => {})} {...props} />);

// Button presses await a haptic call before running onClick, so let those microtasks settle.
const press = async (element: Parameters<typeof fireEvent.press>[0]): Promise<void> => {
  await act(async () => {
    fireEvent.press(element);
    await new Promise((resolve) => setTimeout(resolve, 0));
  });
};

const isDisabled = (element: {props: {accessibilityState?: {disabled?: boolean}}}): boolean =>
  element.props.accessibilityState?.disabled === true;

const deferred = (): {promise: Promise<void>; resolve: () => void} => {
  let resolve = (): void => {};
  const promise = new Promise<void>((done) => {
    resolve = done;
  });
  return {promise, resolve};
};

describe("AskCard", () => {
  afterEach(() => {
    mock.restore();
  });

  it("shows the title and the question", () => {
    const {getByText} = renderCard({ask: pendingAsk(PLAN_INPUT)});
    assert.isOk(getByText("Choose a plan"));
    assert.isOk(getByText("Which plan should I set up for your workspace?"));
  });

  describe("quick replies", () => {
    it("renders the simple card's option buttons, default first, then Skip", () => {
      const simple = toSimpleCard({input: PLAN_INPUT, kind: "choice", toolCallId: "call_1"});
      const {getAllByTestId, queryByTestId} = renderCard({ask: pendingAsk(PLAN_INPUT, {simple})});

      const buttonIds = getAllByTestId(/^ask-card-button-/).map((button) => button.props.testID);
      assert.deepEqual(buttonIds, [
        "ask-card-button-option:team",
        "ask-card-button-option:starter",
        "ask-card-button-option:enterprise",
        "ask-card-button-skip",
      ]);
      assert.isNull(queryByTestId("ask-card-submit"));
    });

    it("answers on tap with the tapped button's exact response", async () => {
      const onSubmit = mock(async (_submission: AskSubmission) => {});
      const {getByTestId} = renderCard({ask: pendingAsk(PLAN_INPUT), onSubmit});

      await press(getByTestId("ask-card-button-option:starter"));

      assert.deepEqual(onSubmit.mock.calls[0]?.[0], {
        response: {action: "accept", content: {selected: ["starter"]}},
        toolCallId: "call_1",
      });
    });

    it("shows option descriptions, which the buttons cannot hold", () => {
      const {getByText} = renderCard({ask: pendingAsk(PLAN_INPUT)});
      assert.isOk(getByText("Starter — $0, one seat"));
      assert.isOk(getByText("Team — $20 per seat"));
    });

    it("uses radio buttons when a label is too long to show in full on a button", () => {
      const input: ChoiceAskInput = {
        options: [
          {id: "short", label: "Short"},
          {id: "long", label: "A label that runs past twenty characters"},
        ],
        prompt: "Pick one",
        select: "one",
      };
      const {getByText, queryByTestId} = renderCard({ask: pendingAsk(input)});
      assert.isOk(getByText("Choose one"));
      assert.isNull(queryByTestId("ask-card-quick-replies"));
    });

    it("hides Skip when the ask cannot be declined", () => {
      const {queryByTestId} = renderCard({
        ask: pendingAsk({...PLAN_INPUT, allowDecline: false}),
      });
      assert.isOk(queryByTestId("ask-card-button-option:team"));
      assert.isNull(queryByTestId("ask-card-button-skip"));
    });
  });

  describe("radio buttons", () => {
    it("keeps Submit disabled until an option is chosen, then sends that option", async () => {
      const onSubmit = mock(async (_submission: AskSubmission) => {});
      const {getByLabelText, getByTestId, getByText} = renderCard({
        ask: pendingAsk(REGION_INPUT),
        onSubmit,
      });
      assert.isOk(getByText("Choose one"));
      assert.isTrue(isDisabled(getByTestId("ask-card-submit")));

      await press(getByLabelText("West — Oregon"));
      assert.isFalse(isDisabled(getByTestId("ask-card-submit")));
      await press(getByTestId("ask-card-submit"));

      assert.deepEqual(onSubmit.mock.calls[0]?.[0], {
        response: {action: "accept", content: {selected: ["west"]}},
        toolCallId: "call_1",
      });
    });

    it("preselects the default so Submit is ready", async () => {
      const onSubmit = mock(async (_submission: AskSubmission) => {});
      const {getByTestId, getByText} = renderCard({
        ask: pendingAsk({...REGION_INPUT, default: ["east"], submitLabel: "Use region"}),
        onSubmit,
      });
      assert.isOk(getByText("Use region"));

      await press(getByTestId("ask-card-submit"));

      assert.deepEqual(onSubmit.mock.calls[0]?.[0]?.response, {
        action: "accept",
        content: {selected: ["east"]},
      });
    });

    it("declines when the user presses Skip", async () => {
      const onSubmit = mock(async (_submission: AskSubmission) => {});
      const {getByTestId} = renderCard({ask: pendingAsk(REGION_INPUT), onSubmit});

      await press(getByTestId("ask-card-button-skip"));

      assert.deepEqual(onSubmit.mock.calls[0]?.[0], {
        response: {action: "decline"},
        toolCallId: "call_1",
      });
    });

    it("hides Skip when the ask cannot be declined", () => {
      const {queryByTestId} = renderCard({
        ask: pendingAsk({...REGION_INPUT, allowDecline: false}),
      });
      assert.isOk(queryByTestId("ask-card-submit"));
      assert.isNull(queryByTestId("ask-card-button-skip"));
    });
  });

  describe("searchable select", () => {
    it("is used above eight options and sends the chosen option", async () => {
      const onSubmit = mock(async (_submission: AskSubmission) => {});
      const {getByTestId, queryByLabelText} = renderCard({
        ask: pendingAsk(COUNTRY_INPUT),
        onSubmit,
      });
      assert.isNull(queryByLabelText("Country CA"));
      assert.isTrue(isDisabled(getByTestId("ask-card-submit")));

      await press(getByTestId("web_picker"));
      assert.isOk(getByTestId("web_dropdown_search"));
      await press(getByTestId("web_dropdown_option_ca"));
      await press(getByTestId("ask-card-submit"));

      assert.deepEqual(onSubmit.mock.calls[0]?.[0]?.response, {
        action: "accept",
        content: {selected: ["ca"]},
      });
    });
  });

  describe("select many", () => {
    const TOPPINGS_INPUT: ChoiceAskInput = {
      allowOther: true,
      default: ["cheese"],
      maxSelected: 2,
      options: [
        {id: "cheese", label: "Extra cheese"},
        {description: "Button and cremini", id: "mushrooms", label: "Mushrooms"},
        {id: "olives", label: "Olives"},
      ],
      otherLabel: "Another topping",
      prompt: "Which toppings should I add?",
      select: "many",
      submitLabel: "Add toppings",
    };

    it("renders checkboxes, the Other field, and the selection bounds, not quick replies", () => {
      const {getByLabelText, getByTestId, getByText, queryByTestId} = renderCard({
        ask: pendingAsk(TOPPINGS_INPUT),
      });
      assert.isOk(getByTestId("ask-card-multiselect"));
      assert.isOk(getByLabelText("Mushrooms — Button and cremini"));
      assert.isOk(getByText("Another topping"));
      assert.isOk(getByTestId("ask-card-other"));
      assert.isOk(getByText("Choose 1 to 2. Another topping counts as one choice."));
      assert.isNull(queryByTestId("ask-card-quick-replies"));
      assert.isNull(queryByTestId("ask-card-button-use-default"));
    });

    it("preselects the default and sends the selected ids in option order", async () => {
      const onSubmit = mock(async (_submission: AskSubmission) => {});
      const {getByLabelText, getByTestId} = renderCard({
        ask: pendingAsk({...TOPPINGS_INPUT, allowOther: undefined, otherLabel: undefined}),
        onSubmit,
      });
      assert.isFalse(isDisabled(getByTestId("ask-card-submit")));

      await press(getByLabelText("Olives"));
      await press(getByLabelText("Extra cheese"));
      await press(getByLabelText("Extra cheese"));
      await press(getByTestId("ask-card-submit"));

      assert.deepEqual(onSubmit.mock.calls[0]?.[0], {
        response: {action: "accept", content: {selected: ["cheese", "olives"]}},
        toolCallId: "call_1",
      });
    });

    it("sends the trimmed Other text, counted as one choice", async () => {
      const onSubmit = mock(async (_submission: AskSubmission) => {});
      const {getByTestId} = renderCard({ask: pendingAsk(TOPPINGS_INPUT), onSubmit});

      await act(async () => {
        fireEvent.changeText(getByTestId("ask-card-other"), "  Basil  ");
      });
      await press(getByTestId("ask-card-submit"));

      assert.deepEqual(onSubmit.mock.calls[0]?.[0]?.response, {
        action: "accept",
        content: {other: "Basil", selected: ["cheese"]},
      });
    });

    it("keeps Submit disabled and says why when the choices pass maxSelected", async () => {
      const {getByLabelText, getByTestId, getByText} = renderCard({
        ask: pendingAsk(TOPPINGS_INPUT),
      });

      await press(getByLabelText("Olives"));
      assert.isFalse(isDisabled(getByTestId("ask-card-submit")));
      await act(async () => {
        fireEvent.changeText(getByTestId("ask-card-other"), "Basil");
      });

      assert.isTrue(isDisabled(getByTestId("ask-card-submit")));
      assert.isOk(getByText("You chose 3. Choose at most 2."));
    });

    it("keeps Submit disabled until the answer meets minSelected", async () => {
      const {getByLabelText, getByTestId} = renderCard({
        ask: pendingAsk({...TOPPINGS_INPUT, default: undefined, minSelected: 2}),
      });
      assert.isTrue(isDisabled(getByTestId("ask-card-submit")));

      await press(getByLabelText("Olives"));
      assert.isTrue(isDisabled(getByTestId("ask-card-submit")));
      await press(getByLabelText("Extra cheese"));
      assert.isFalse(isDisabled(getByTestId("ask-card-submit")));
    });

    it("keeps Submit disabled while the Other text is too long", async () => {
      const {getByTestId, getByText} = renderCard({ask: pendingAsk(TOPPINGS_INPUT)});

      await act(async () => {
        fireEvent.changeText(getByTestId("ask-card-other"), "b".repeat(501));
      });

      assert.isTrue(isDisabled(getByTestId("ask-card-submit")));
      assert.isOk(getByText("Keep this to 500 characters or fewer."));
    });

    it("shows a server error on the Other field inline, and other errors below", () => {
      const {getByTestId, getByText} = renderCard({
        ask: pendingAsk(TOPPINGS_INPUT),
        errors: [
          {
            code: "SELECTION_COUNT",
            fix: "Send 1 to 2 options in content.selected. Other counts as one choice.",
            message: "Choose 1 to 2 options; the answer selects 3, counting Other.",
            path: "content.selected",
          },
          {
            code: "TOO_SHORT",
            fix: "Put visible text in content.other.",
            message: "content.other is empty.",
            path: "content.other",
          },
        ],
      });
      assert.isOk(getByText("content.other is empty."));
      const errorList = within(getByTestId("ask-card-errors"));
      assert.isOk(
        errorList.getByText("Choose 1 to 2 options; the answer selects 3, counting Other.")
      );
      assert.isNull(errorList.queryByText("content.other is empty."));
    });

    it("declines when the user presses Skip, and hides Skip when the ask cannot be declined", async () => {
      const onSubmit = mock(async (_submission: AskSubmission) => {});
      const {getByTestId} = renderCard({ask: pendingAsk(TOPPINGS_INPUT), onSubmit});
      await press(getByTestId("ask-card-button-skip"));
      assert.deepEqual(onSubmit.mock.calls[0]?.[0]?.response, {action: "decline"});

      const required = renderCard({ask: pendingAsk({...TOPPINGS_INPUT, allowDecline: false})});
      assert.isNull(required.queryByTestId("ask-card-button-skip"));
    });

    it("lists the options as plain text when the host takes no answers", () => {
      const {getByTestId, queryByTestId} = renderWithTheme(
        <AskCard ask={pendingAsk(TOPPINGS_INPUT)} />
      );
      assert.isOk(getByTestId("ask-card-options"));
      assert.isNull(queryByTestId("ask-card-multiselect"));
      assert.isTrue(isDisabled(getByTestId("ask-card-submit")));
      assert.isTrue(isDisabled(getByTestId("ask-card-button-skip")));
    });

    it("summarizes the answer with the chosen labels and the Other text", () => {
      const {getByText} = renderCard({
        ask: pendingAsk(TOPPINGS_INPUT, {
          response: {action: "accept", content: {other: "Basil", selected: ["olives"]}},
          status: "answered",
        }),
      });
      assert.isOk(getByText("You chose: Olives. Another topping: Basil"));
    });
  });

  describe("confirm", () => {
    // The variant each answer button renders with, read from the Button element that gets it.
    const buttonVariants = (root: ReturnType<typeof renderCard>): [string, string][] =>
      root
        .getAllByTestId(/^ask-card-button-/)
        .map((element) => element.props.testID as string)
        .map((testID) => {
          const [button] = root
            .UNSAFE_queryAllByProps({testID})
            .filter((instance) => instance.props.variant !== undefined);
          return [testID, button?.props.variant];
        });

    it("shows the approve button first as destructive, then the deny button, with no Skip", () => {
      const card = renderCard({ask: pendingConfirm(ARCHIVE_INPUT)});

      assert.isOk(card.getByText("Archive old chats"));
      assert.isOk(card.getByText("Archive the 12 chats older than 90 days?"));
      assert.deepEqual(buttonVariants(card), [
        ["ask-card-button-approve", "destructive"],
        ["ask-card-button-deny", "ghost"],
      ]);
      assert.isOk(
        within(card.getByTestId("ask-card-button-approve")).getByText("Archive 12 chats")
      );
      assert.isOk(within(card.getByTestId("ask-card-button-deny")).getByText("Keep them"));
      for (const button of card.getAllByTestId(/^ask-card-button-/)) {
        assert.include(button.props.style, {maxWidth: "100%"});
      }
    });

    it("uses the primary style and the default labels when the ask is not destructive", () => {
      const card = renderCard({ask: pendingConfirm(REPORT_INPUT)});

      assert.deepEqual(buttonVariants(card), [
        ["ask-card-button-approve", "primary"],
        ["ask-card-button-deny", "ghost"],
      ]);
      assert.isOk(within(card.getByTestId("ask-card-button-approve")).getByText("Confirm"));
      assert.isOk(within(card.getByTestId("ask-card-button-deny")).getByText("Cancel"));
    });

    it.each([
      {buttonId: "approve", confirmed: true},
      {buttonId: "deny", confirmed: false},
    ])("sends {confirmed: $confirmed} from the $buttonId button", async ({buttonId, confirmed}) => {
      const onSubmit = mock(async (_submission: AskSubmission) => {});
      const {getByTestId} = renderCard({ask: pendingConfirm(ARCHIVE_INPUT), onSubmit});

      await press(getByTestId(`ask-card-button-${buttonId}`));

      assert.deepEqual(onSubmit.mock.calls[0]?.[0], {
        response: {action: "accept", content: {confirmed}},
        toolCallId: "call_1",
      });
    });

    it("adds Skip last when allowDecline is true, and it declines", async () => {
      const onSubmit = mock(async (_submission: AskSubmission) => {});
      const card = renderCard({
        ask: pendingConfirm({...REPORT_INPUT, allowDecline: true}),
        onSubmit,
      });

      assert.deepEqual(
        card.getAllByTestId(/^ask-card-button-/).map((button) => button.props.testID),
        ["ask-card-button-approve", "ask-card-button-deny", "ask-card-button-skip"]
      );
      await press(card.getByTestId("ask-card-button-skip"));
      assert.deepEqual(onSubmit.mock.calls[0]?.[0], {
        response: {action: "decline"},
        toolCallId: "call_1",
      });
    });

    it("shows the pressed button loading and blocks the other until the host finishes", async () => {
      const pending = deferred();
      const onSubmit = mock((_submission: AskSubmission) => pending.promise);
      const {getByTestId} = renderCard({ask: pendingConfirm(ARCHIVE_INPUT), onSubmit});

      await press(getByTestId("ask-card-button-approve"));
      assert.lengthOf(
        getByTestId("ask-card-button-approve").findAll((node) => node.type === "ActivityIndicator"),
        1
      );
      assert.isTrue(isDisabled(getByTestId("ask-card-button-deny")));
      await press(getByTestId("ask-card-button-deny"));
      assert.lengthOf(onSubmit.mock.calls, 1);

      await act(async () => {
        pending.resolve();
        await pending.promise;
      });
      assert.isFalse(isDisabled(getByTestId("ask-card-button-deny")));
    });

    it("disables both buttons when the host takes no answers", () => {
      const {getByTestId} = renderWithTheme(<AskCard ask={pendingConfirm(ARCHIVE_INPUT)} />);
      assert.isTrue(isDisabled(getByTestId("ask-card-button-approve")));
      assert.isTrue(isDisabled(getByTestId("ask-card-button-deny")));
    });

    it("shows server errors for the last answer inline", () => {
      const {getByText} = renderCard({
        ask: pendingConfirm(ARCHIVE_INPUT),
        errors: [
          {
            code: "DECLINE_NOT_ALLOWED",
            fix: 'Answer with action "accept".',
            message: "This ask cannot be skipped.",
            path: "action",
          },
        ],
      });
      assert.isOk(getByText("This ask cannot be skipped."));
    });

    it.each([
      {confirmed: true, summary: "You confirmed: Archive 12 chats"},
      {confirmed: false, summary: "You declined: Keep them"},
    ])("summarizes an answer of confirmed $confirmed with its label", ({confirmed, summary}) => {
      const {getByText, queryByTestId} = renderCard({
        ask: pendingConfirm(ARCHIVE_INPUT, {
          response: {action: "accept", content: {confirmed}},
          status: "answered",
        }),
      });
      assert.isOk(getByText(summary));
      assert.isNull(queryByTestId("ask-card-button-approve"));
    });

    it("says a confirm with matching labels cannot be shown", () => {
      const {getByTestId, queryByTestId} = renderCard({
        ask: pendingConfirm({...REPORT_INPUT, confirmLabel: "Cancel"}),
      });
      assert.isOk(getByTestId("ask-card-invalid"));
      assert.isNull(queryByTestId("ask-card-button-approve"));
    });
  });

  describe("markdown", () => {
    const typeDraft = (root: ReturnType<typeof renderCard>, text: string): void => {
      act(() => {
        fireEvent.changeText(root.getByTestId("ask-card-editor-input"), text);
      });
    };

    it("starts the editor from the draft and shows the length hint, Submit, and Skip", () => {
      const card = renderCard({ask: pendingMarkdown(DRAFT_INPUT)});

      assert.isOk(card.getByText("Launch announcement"));
      assert.equal(card.getByTestId("ask-card-editor-input").props.value, DRAFT);
      assert.isOk(card.getByText(`${DRAFT.length} / 60 characters. At least 10.`));
      assert.isOk(within(card.getByTestId("ask-card-submit")).getByText("Send it back"));
      assert.isFalse(isDisabled(card.getByTestId("ask-card-submit")));
      assert.isOk(card.getByTestId("ask-card-button-skip"));
    });

    it("sends the draft unchanged with changed false", async () => {
      const onSubmit = mock(async (_submission: AskSubmission) => {});
      const card = renderCard({ask: pendingMarkdown(DRAFT_INPUT), onSubmit});

      await press(card.getByTestId("ask-card-submit"));

      assert.deepEqual(onSubmit.mock.calls[0]?.[0], {
        response: {action: "accept", content: {changed: false, markdown: DRAFT}},
        toolCallId: "call_1",
      });
    });

    it("sends an edit with changed true, and changed false again once the edit is undone", async () => {
      const onSubmit = mock(async (_submission: AskSubmission) => {});
      const card = renderCard({ask: pendingMarkdown(DRAFT_INPUT), onSubmit});

      typeDraft(card, "# We're live\n\nWe launched today.");
      await press(card.getByTestId("ask-card-submit"));
      typeDraft(card, DRAFT);
      await press(card.getByTestId("ask-card-submit"));

      assert.deepEqual(
        onSubmit.mock.calls.map((call) => call[0].response),
        [
          {
            action: "accept",
            content: {changed: true, markdown: "# We're live\n\nWe launched today."},
          },
          {action: "accept", content: {changed: false, markdown: DRAFT}},
        ]
      );
    });

    it("keeps Submit disabled and says why while the text is longer than maxLength", () => {
      const card = renderCard({ask: pendingMarkdown(DRAFT_INPUT)});

      typeDraft(card, "x".repeat(61));

      assert.isTrue(isDisabled(card.getByTestId("ask-card-submit")));
      assert.isOk(card.getByText("Keep this to 60 characters or fewer."));
      assert.isOk(card.getByText("61 / 60 characters. At least 10."));
    });

    it("keeps Submit disabled until the text meets minLength", () => {
      const card = renderCard({ask: pendingMarkdown({...DRAFT_INPUT, initial: undefined})});

      assert.equal(card.getByTestId("ask-card-editor-input").props.value, "");
      assert.isTrue(isDisabled(card.getByTestId("ask-card-submit")));
      typeDraft(card, "   short   ");
      assert.isTrue(isDisabled(card.getByTestId("ask-card-submit")));
      typeDraft(card, "Long enough now");
      assert.isFalse(isDisabled(card.getByTestId("ask-card-submit")));
    });

    it("declines with Skip, and hides Skip when the ask cannot be declined", async () => {
      const onSubmit = mock(async (_submission: AskSubmission) => {});
      const card = renderCard({ask: pendingMarkdown(DRAFT_INPUT), onSubmit});
      await press(card.getByTestId("ask-card-button-skip"));
      assert.deepEqual(onSubmit.mock.calls[0]?.[0]?.response, {action: "decline"});

      const required = renderCard({ask: pendingMarkdown({...DRAFT_INPUT, allowDecline: false})});
      assert.isNull(required.queryByTestId("ask-card-button-skip"));
    });

    it("shows a server error on the text in the editor, and other errors below", () => {
      const card = renderCard({
        ask: pendingMarkdown(DRAFT_INPUT),
        errors: [
          {
            code: "CHANGED_MISMATCH",
            fix: "Set content.changed to false.",
            message: "The text is the same as the draft, but changed is true.",
            path: "content.changed",
          },
          {
            code: "TOO_LONG",
            fix: "Shorten content.markdown to 60 characters or fewer.",
            message: "The text is 61 characters, but this ask allows at most 60.",
            path: "content.markdown",
          },
        ],
      });

      assert.isOk(card.getByText("The text is 61 characters, but this ask allows at most 60."));
      assert.isOk(
        within(card.getByTestId("ask-card-errors")).getByText(
          "The text is the same as the draft, but changed is true."
        )
      );
    });

    it("disables the editor, Submit, and Skip when the host takes no answers", () => {
      const {getByTestId} = renderWithTheme(<AskCard ask={pendingMarkdown(DRAFT_INPUT)} />);
      assert.isFalse(getByTestId("ask-card-editor-input").props.editable);
      assert.isTrue(isDisabled(getByTestId("ask-card-submit")));
      assert.isTrue(isDisabled(getByTestId("ask-card-button-skip")));
    });

    it("says a markdown ask with minLength above maxLength cannot be shown", () => {
      const {getByTestId, queryByTestId} = renderCard({
        ask: pendingMarkdown({...DRAFT_INPUT, minLength: 100}),
      });
      assert.isOk(getByTestId("ask-card-invalid"));
      assert.isNull(queryByTestId("ask-card-editor"));
    });

    it("summarizes an edit with its length and shows the text it sent", () => {
      const {getByTestId, getByText, queryByTestId} = renderCard({
        ask: pendingMarkdown(DRAFT_INPUT, {
          response: {action: "accept", content: {changed: true, markdown: "We launched today."}},
          status: "answered",
        }),
      });

      assert.isOk(getByText("You edited the draft (18 characters)"));
      assert.isOk(within(getByTestId("ask-card-answer")).getByText("We launched today."));
      assert.isNull(queryByTestId("ask-card-answer-toggle"));
      assert.isNull(queryByTestId("ask-card-editor"));
    });

    it("summarizes an approved draft", () => {
      const {getByTestId, getByText} = renderCard({
        ask: pendingMarkdown(DRAFT_INPUT, {
          response: {action: "accept", content: {changed: false, markdown: DRAFT}},
          status: "answered",
        }),
      });
      assert.isOk(getByText("You approved the draft as is"));
      assert.isOk(getByTestId("ask-card-answer"));
    });

    it("collapses a long answer to a preview until the user shows all of it", async () => {
      const longAnswer = `${"word ".repeat(80)}THE END`;
      const card = renderCard({
        ask: pendingMarkdown(
          {prompt: "Write it."},
          {
            response: {action: "accept", content: {changed: true, markdown: longAnswer}},
            status: "answered",
          }
        ),
      });
      const answerText = (): string => JSON.stringify(card.toJSON());

      assert.isOk(card.getByText("You edited the draft (407 characters)"));
      await waitFor(() => {
        assert.include(answerText(), "…");
      });
      assert.notInclude(answerText(), "THE END");
      await press(card.getByTestId("ask-card-answer-toggle"));
      await waitFor(() => {
        assert.include(answerText(), "THE END");
      });
      assert.isOk(within(card.getByTestId("ask-card-answer-toggle")).getByText("Show less"));
    });

    it("summarizes a skipped draft without the answer box", () => {
      const {getByText, queryByTestId} = renderCard({
        ask: pendingMarkdown(DRAFT_INPUT, {response: {action: "decline"}, status: "answered"}),
      });
      assert.isOk(getByText("You skipped this question."));
      assert.isNull(queryByTestId("ask-card-answer"));
    });
  });

  describe("form", () => {
    const typeInto = (root: ReturnType<typeof renderCard>, testID: string, text: string): void => {
      act(() => {
        fireEvent.changeText(root.getByTestId(testID), text);
      });
    };

    it("renders one labelled control per field, marks required fields, and shows helper text", () => {
      const card = renderCard({ask: pendingForm(INVOICE_INPUT)});

      assert.isOk(card.getByText("Invoice details"));
      assert.isOk(card.getByText("Company name (required)"));
      assert.isOk(card.getByText("As it appears on the invoice."));
      assert.isOk(card.getByTestId("ask-card-field-company"));
      assert.isOk(card.getByTestId("ask-card-field-seats"));
      assert.isOk(card.getByTestId("ask-card-field-start"));
      assert.isOk(within(card.getByTestId("ask-card-form-field-region")).getByText("Region"));
      assert.isOk(card.getByTestId("ask-card-field-notify.switch"));
      assert.isOk(within(card.getByTestId("ask-card-submit")).getByText("Send details"));
      assert.isOk(card.getByTestId("ask-card-button-skip"));
    });

    it("keeps Submit disabled until required fields are filled, then sends the typed values", async () => {
      const onSubmit = mock(async (_submission: AskSubmission) => {});
      const card = renderCard({ask: pendingForm(INVOICE_INPUT), onSubmit});
      assert.isTrue(isDisabled(card.getByTestId("ask-card-submit")));

      typeInto(card, "ask-card-field-company", "  Acme Corp ");
      typeInto(card, "ask-card-field-seats", "12");
      await press(card.getByTestId("ask-card-field-notify.switch"));
      assert.isFalse(isDisabled(card.getByTestId("ask-card-submit")));
      await press(card.getByTestId("ask-card-submit"));

      assert.deepEqual(onSubmit.mock.calls[0]?.[0], {
        response: {
          action: "accept",
          content: {values: {company: "Acme Corp", notify: false, seats: 12}},
        },
        toolCallId: "call_1",
      });
    });

    it("sends a date typed into the date field as YYYY-MM-DD", async () => {
      const onSubmit = mock(async (_submission: AskSubmission) => {});
      const card = renderCard({ask: pendingForm(INVOICE_INPUT), onSubmit});
      const start = within(card.getByTestId("ask-card-form-field-start"));

      typeInto(card, "ask-card-field-company", "Acme");
      act(() => {
        fireEvent.changeText(start.getByPlaceholderText("MM"), "10");
        fireEvent.changeText(start.getByPlaceholderText("DD"), "01");
        fireEvent.changeText(start.getByPlaceholderText("YYYY"), "2026");
      });
      act(() => {
        fireEvent(start.getByPlaceholderText("YYYY"), "blur");
      });
      await press(card.getByTestId("ask-card-submit"));

      assert.deepEqual(onSubmit.mock.calls[0]?.[0]?.response, {
        action: "accept",
        content: {values: {company: "Acme", notify: true, start: "2026-10-01"}},
      });
    });

    it("shows why a field is invalid once the user edits it, and keeps Submit disabled", () => {
      const card = renderCard({ask: pendingForm(INVOICE_INPUT)});
      assert.isNull(card.queryByText("This field is required."));

      typeInto(card, "ask-card-field-company", "Acme");
      typeInto(card, "ask-card-field-seats", "900");
      assert.isOk(card.getByText("Enter a number from 1 to 500."));
      assert.isTrue(isDisabled(card.getByTestId("ask-card-submit")));

      typeInto(card, "ask-card-field-seats", "1.5");
      assert.isOk(card.getByText("Enter a whole number."));
      typeInto(card, "ask-card-field-company", "   ");
      assert.isOk(card.getByText("This field is required."));
    });

    it("starts from the defaults and sends every field type in its answer format", async () => {
      const onSubmit = mock(async (_submission: AskSubmission) => {});
      const card = renderCard({ask: pendingForm(DEFAULTS_INPUT), onSubmit});
      assert.isTrue(isDisabled(card.getByTestId("ask-card-submit")));

      typeInto(card, "ask-card-field-phone", "(415) 555-2671");
      typeInto(card, "ask-card-field-email", "ada@example.com");
      assert.isFalse(isDisabled(card.getByTestId("ask-card-submit")));
      await press(card.getByTestId("ask-card-submit"));

      assert.deepEqual(onSubmit.mock.calls[0]?.[0]?.response, {
        action: "accept",
        content: {
          values: {
            channels: ["email"],
            email: "ada@example.com",
            meeting: "2026-10-01T09:30:00Z",
            notes: "Ring twice.",
            phone: "+14155552671",
            reminder: "09:30",
            shipping: "express",
            site: "https://example.com",
          },
        },
      });
    });

    it("keeps the shown time when the user picks another time zone", async () => {
      const onSubmit = mock(async (_submission: AskSubmission) => {});
      const card = renderCard({ask: pendingForm(DEFAULTS_INPUT), onSubmit});
      typeInto(card, "ask-card-field-email", "ada@example.com");
      for (const id of ["reminder", "meeting"]) {
        const picker = within(card.getByTestId(`ask-card-form-field-${id}`)).UNSAFE_getByType(
          TimezonePicker
        );
        act(() => {
          picker.props.onChange("America/Los_Angeles");
        });
      }
      await press(card.getByTestId("ask-card-submit"));

      // Tests run in America/New_York, where the 09:30Z meeting shows as 05:30.
      assert.deepInclude(onSubmit.mock.calls[0]?.[0]?.response, {
        content: {
          values: {
            channels: ["email"],
            email: "ada@example.com",
            meeting: "2026-10-01T05:30:00-07:00",
            notes: "Ring twice.",
            reminder: "09:30",
            shipping: "express",
            site: "https://example.com",
          },
        },
      });
    });

    it("shows server errors on their fields, and errors for no field below", () => {
      const card = renderCard({
        ask: pendingForm(INVOICE_INPUT),
        errors: [
          {
            code: "REQUIRED_FIELD",
            fix: 'Fill in "Company name" (content.values.company).',
            message: '"Company name" is required.',
            path: "content.values.company",
          },
          {
            code: "INVALID_DATE",
            fix: 'Write content.values.start as YYYY-MM-DD, such as "2026-10-01".',
            message: 'content.values.start "2026-02-30" is not a real date in YYYY-MM-DD.',
            path: "content.values.start",
          },
          {
            code: "UNKNOWN_KEY",
            fix: 'Remove "plan" from content.values.',
            message: '"plan" is not the id of any field in this form.',
            path: "content.values.plan",
          },
        ],
      });

      assert.isOk(card.getByText("This field is required."));
      assert.isOk(card.getByText("Enter a real date."));
      assert.isOk(
        within(card.getByTestId("ask-card-errors")).getByText(
          '"plan" is not the id of any field in this form.'
        )
      );
    });

    it("declines with Skip, and hides Skip when the ask cannot be declined", async () => {
      const onSubmit = mock(async (_submission: AskSubmission) => {});
      const card = renderCard({ask: pendingForm(INVOICE_INPUT), onSubmit});
      await press(card.getByTestId("ask-card-button-skip"));
      assert.deepEqual(onSubmit.mock.calls[0]?.[0]?.response, {action: "decline"});

      const required = renderCard({ask: pendingForm({...INVOICE_INPUT, allowDecline: false})});
      assert.isNull(required.queryByTestId("ask-card-button-skip"));
    });

    it("disables the fields, Submit, and Skip when the host takes no answers", () => {
      const {getByTestId} = renderWithTheme(<AskCard ask={pendingForm(INVOICE_INPUT)} />);
      assert.isTrue(getByTestId("ask-card-field-company").props.readOnly);
      assert.isTrue(isDisabled(getByTestId("ask-card-submit")));
      assert.isTrue(isDisabled(getByTestId("ask-card-button-skip")));
    });

    it("says a form with a default its field rejects cannot be shown", () => {
      const {getByTestId, queryByTestId} = renderCard({
        ask: pendingForm({
          fields: [{default: 0, id: "seats", label: "Seats", min: 1, type: "number"}],
          prompt: "How many?",
        }),
      });
      assert.isOk(getByTestId("ask-card-invalid"));
      assert.isNull(queryByTestId("ask-card-field-seats"));
    });

    it("summarizes a sent form with the number of fields and a label: value list", () => {
      const {getByTestId, getByText, queryByTestId} = renderCard({
        ask: pendingForm(INVOICE_INPUT, {
          response: {
            action: "accept",
            content: {values: {company: "Acme", notify: true, region: "eu", start: "2026-10-01"}},
          },
          status: "answered",
        }),
      });

      assert.isOk(getByText("You sent the form (4 fields)"));
      const answer = within(getByTestId("ask-card-answer"));
      assert.isOk(answer.getByText("Company name"));
      assert.isOk(answer.getByText("Acme"));
      assert.isOk(answer.getByText("Region"));
      assert.isOk(answer.getByText("EU"));
      assert.isOk(answer.getByText("Start date"));
      assert.isOk(answer.getByText("Oct 1, 2026"));
      assert.isOk(answer.getByText("Email me the invoice"));
      assert.isOk(answer.getByText("Yes"));
      assert.isNull(answer.queryByText("Seats"));
      assert.isNull(queryByTestId("ask-card-field-company"));
    });

    it("summarizes a skipped form without the answer list", () => {
      const {getByText, queryByTestId} = renderCard({
        ask: pendingForm(INVOICE_INPUT, {response: {action: "decline"}, status: "answered"}),
      });
      assert.isOk(getByText("You skipped this question."));
      assert.isNull(queryByTestId("ask-card-answer"));
    });
  });

  it("lets every button wrap a long label to fit a narrow chat instead of overflowing it", () => {
    const quickReplies = renderCard({ask: pendingAsk(PLAN_INPUT)}).getAllByTestId(
      /^ask-card-button-/
    );
    const form = renderCard({ask: pendingAsk(REGION_INPUT)});
    const buttons = [
      ...quickReplies,
      form.getByTestId("ask-card-submit"),
      form.getByTestId("ask-card-button-skip"),
    ];

    assert.lengthOf(buttons, 6);
    for (const button of buttons) {
      assert.include(button.props.style, {maxWidth: "100%"});
    }
  });

  it("shows errors for the last answer inline", () => {
    const {getByTestId, getByText} = renderCard({
      ask: pendingAsk(REGION_INPUT),
      errors: [
        {
          code: "OPTION_NOT_OFFERED",
          fix: "Use the id of one of the ask's options.",
          message: '"north" is not one of the offered options.',
          path: "content.selected[0]",
        },
      ],
    });
    assert.isOk(getByTestId("ask-card-errors"));
    assert.isOk(getByText('"north" is not one of the offered options.'));
  });

  it("shows the pressed button loading and blocks other answers until the host finishes", async () => {
    const pending = deferred();
    const onSubmit = mock((_submission: AskSubmission) => pending.promise);
    const {getByTestId} = renderCard({ask: pendingAsk(PLAN_INPUT), onSubmit});

    await press(getByTestId("ask-card-button-option:team"));
    const spinners = getByTestId("ask-card-button-option:team").findAll(
      (node) => node.type === "ActivityIndicator"
    );
    assert.lengthOf(spinners, 1);
    assert.isTrue(isDisabled(getByTestId("ask-card-button-option:team")));
    assert.isTrue(isDisabled(getByTestId("ask-card-button-option:starter")));
    assert.isTrue(isDisabled(getByTestId("ask-card-button-skip")));
    await press(getByTestId("ask-card-button-option:starter"));
    assert.lengthOf(onSubmit.mock.calls, 1);

    await act(async () => {
      pending.resolve();
      await pending.promise;
    });
    assert.isFalse(isDisabled(getByTestId("ask-card-button-option:starter")));
  });

  it("stays answerable when the host's submit fails", async () => {
    const warn = spyOn(console, "warn").mockImplementation(() => {});
    const onSubmit = mock(async (_submission: AskSubmission) => {
      throw new Error("network down");
    });
    const {getByTestId} = renderCard({ask: pendingAsk(PLAN_INPUT), onSubmit});

    await press(getByTestId("ask-card-button-option:team"));

    assert.lengthOf(warn.mock.calls, 1);
    assert.isFalse(isDisabled(getByTestId("ask-card-button-option:team")));
  });

  it("disables its controls when the host takes no answers", () => {
    const {getByTestId} = renderWithTheme(<AskCard ask={pendingAsk(PLAN_INPUT)} />);
    assert.isTrue(isDisabled(getByTestId("ask-card-button-option:team")));
    assert.isTrue(isDisabled(getByTestId("ask-card-button-skip")));
  });

  it("lists radio options as plain text when the host takes no answers", () => {
    const {getByTestId, getByText, queryByLabelText} = renderWithTheme(
      <AskCard ask={pendingAsk(REGION_INPUT)} />
    );

    const options = getByTestId("ask-card-options");
    assert.isOk(getByText("West — Oregon"));
    assert.isNull(queryByLabelText("West — Oregon"));
    assert.lengthOf(
      options.findAll((node) => typeof node.props.onPress === "function"),
      0
    );
    assert.isTrue(isDisabled(getByTestId("ask-card-submit")));
    assert.isTrue(isDisabled(getByTestId("ask-card-button-skip")));
  });

  it("summarizes an answered ask in one line without controls", () => {
    const {getByTestId, getByText, queryByTestId} = renderCard({
      ask: pendingAsk(PLAN_INPUT, {
        response: {action: "accept", content: {selected: ["team"]}},
        status: "answered",
      }),
    });
    assert.isOk(getByTestId("ask-card-summary"));
    assert.isOk(getByText("You chose: Team"));
    assert.isNull(queryByTestId("ask-card-quick-replies"));
    assert.isNull(queryByTestId("ask-card-button-option:team"));
  });

  it("summarizes a cancelled ask", () => {
    const {getByText} = renderCard({
      ask: pendingAsk(PLAN_INPUT, {
        response: {action: "cancel", reason: "user_sent_message"},
        status: "cancelled",
      }),
    });
    assert.isOk(getByText("Not answered: you sent a message instead."));
  });

  it("says a malformed ask cannot be shown instead of rendering controls", () => {
    const input = {
      ...REGION_INPUT,
      options: [
        {id: "same", label: "One"},
        {id: "same", label: "Two"},
      ],
    };
    const {getByTestId, queryByTestId} = renderCard({ask: pendingAsk(input)});
    assert.isOk(getByTestId("ask-card-invalid"));
    assert.isNull(queryByTestId("ask-card-submit"));
  });
});
