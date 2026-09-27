import {afterEach, describe, it, mock, spyOn} from "bun:test";
import {type ChoiceAskInput, toSimpleCard} from "@terreno/blocks";
import {act, fireEvent} from "@testing-library/react-native";
import {assert} from "chai";

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
