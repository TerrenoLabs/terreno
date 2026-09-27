import {afterEach, describe, it, mock} from "bun:test";
import {readdirSync, readFileSync} from "node:fs";
import {join} from "node:path";
import {
  resolveButtonAnswer,
  type SimpleCard,
  type SimpleCardButton,
  simpleCardSchema,
} from "@terreno/blocks";
import {act, fireEvent, within} from "@testing-library/react-native";
import {assert} from "chai";

import {renderWithTheme} from "../test-utils";
import {SimpleAskCard, type SimpleAskCardProps} from "./SimpleAskCard";

const FIXTURES_DIR = join(
  import.meta.dir,
  "..",
  "..",
  "..",
  "blocks",
  "src",
  "asks",
  "fixtures",
  "valid"
);

interface CardFixture {
  card: SimpleCard;
  name: string;
}

/** The card each valid `@terreno/blocks` ask fixture derives, so a new fixture is covered here too. */
const cardFixtures = (): CardFixture[] =>
  readdirSync(FIXTURES_DIR)
    .filter((file) => file.endsWith(".json"))
    .sort()
    .map((file) => ({
      card: simpleCardSchema.parse(
        JSON.parse(readFileSync(join(FIXTURES_DIR, file), "utf8")).simple
      ),
      name: file.replace(/\.json$/, ""),
    }));

const fixtureCard = (name: string): SimpleCard => {
  const fixture = cardFixtures().find((candidate) => candidate.name === name);
  if (!fixture) {
    throw new Error(`No valid ask fixture named ${name}`);
  }
  return fixture.card;
};

const ANNOUNCEMENT_DRAFT =
  "# We're live\n\nToday we launched **Terreno Asks**: your agent can now ask you a question and wait for the answer.\n\n- Pick from options\n- Approve or deny\n- Edit a draft like this one\n";

const renderCard = (props: Partial<SimpleAskCardProps> & Pick<SimpleAskCardProps, "card">) =>
  renderWithTheme(<SimpleAskCard onPress={mock(() => {})} {...props} />);

// Button presses await a haptic call before running onClick, so let those microtasks settle.
const press = async (element: Parameters<typeof fireEvent.press>[0]): Promise<void> => {
  await act(async () => {
    fireEvent.press(element);
    await new Promise((resolve) => setTimeout(resolve, 0));
  });
};

const isDisabled = (element: {props: {accessibilityState?: {disabled?: boolean}}}): boolean =>
  element.props.accessibilityState?.disabled === true;

const spinnerCount = (element: {
  findAll: (test: (node: {type: unknown}) => boolean) => unknown[];
}) => element.findAll((node) => node.type === "ActivityIndicator").length;

const BUTTON_TEST_ID = /^simple-ask-card-button-/;

describe("SimpleAskCard", () => {
  afterEach(() => {
    mock.restore();
  });

  it("covers handoff and non-handoff cards among the fixtures", () => {
    const cards = cardFixtures().map((fixture) => fixture.card);
    assert.isTrue(cards.some((card) => card.handoff));
    assert.isTrue(cards.some((card) => !card.handoff));
    assert.isTrue(cards.some((card) => card.buttons.length === 0));
    assert.isTrue(cards.some((card) => card.title !== undefined));
  });

  it.each(cardFixtures().map((fixture) => [fixture.name, fixture.card] as const))(
    "renders the %s fixture's card",
    (_name, card) => {
      const {getByTestId, getByText, queryAllByTestId, queryByTestId} = renderCard({card});

      if (card.title !== undefined) {
        assert.isOk(getByText(card.title));
      }
      assert.isOk(getByText(card.text));
      if (card.handoff) {
        assert.isOk(
          within(getByTestId("simple-ask-card-handoff")).getByText(
            card.kind === "markdown" ? "Edit on your phone" : "Continue on your phone"
          )
        );
      } else {
        assert.isNull(queryByTestId("simple-ask-card-handoff"));
      }

      assert.deepEqual(
        queryAllByTestId(BUTTON_TEST_ID).map((element) => element.props.testID),
        card.buttons.map((button) => `simple-ask-card-button-${button.id}`)
      );
      for (const button of card.buttons) {
        const element = getByTestId(`simple-ask-card-button-${button.id}`);
        assert.isOk(within(element).getByText(button.label));
        assert.isFalse(isDisabled(element));
        assert.equal(spinnerCount(element), 0);
      }
    }
  );

  it("wraps each button's label inside the card instead of overflowing it", () => {
    const card = fixtureCard("choice-emoji-label-cut");
    const {getByTestId} = renderCard({card});

    for (const button of card.buttons) {
      const element = getByTestId(`simple-ask-card-button-${button.id}`);
      assert.include(element.props.style, {maxWidth: "100%"});
      assert.include(within(element).getByText(button.label).props.style, {textAlign: "center"});
    }
  });

  it("calls onPress with the pressed button, whose id the server resolves to the same answer", async () => {
    const card = fixtureCard("choice-plan-with-default");
    const onPress = mock((_button: SimpleCardButton) => {});
    const {getByTestId} = renderCard({card, onPress});

    for (const button of card.buttons) {
      await press(getByTestId(`simple-ask-card-button-${button.id}`));
      assert.deepEqual(onPress.mock.calls.at(-1)?.[0], button);
      assert.deepEqual(resolveButtonAnswer({buttonId: button.id, card}), {
        errors: [],
        response: button.response,
      });
    }
    assert.equal(onPress.mock.calls.length, card.buttons.length);
  });

  it("offers only the continue-on-phone line when a handoff card has no buttons", () => {
    const card = fixtureCard("choice-many-options-no-buttons");
    const {getByTestId, getByText, queryAllByTestId} = renderCard({card});

    assert.isOk(getByText(card.text));
    assert.isOk(within(getByTestId("simple-ask-card-handoff")).getByText("Continue on your phone"));
    assert.lengthOf(queryAllByTestId(BUTTON_TEST_ID), 0);
  });

  it("tells the user to edit a markdown draft on their phone, next to Approve draft and Cancel", async () => {
    const card = fixtureCard("markdown-announcement-draft");
    const onPress = mock((_button: SimpleCardButton) => {});
    const {getByTestId} = renderCard({card, onPress});

    assert.isOk(within(getByTestId("simple-ask-card-handoff")).getByText("Edit on your phone"));
    assert.isOk(within(getByTestId("simple-ask-card-button-approve")).getByText("Approve draft"));
    assert.isOk(within(getByTestId("simple-ask-card-button-cancel")).getByText("Cancel"));
    await press(getByTestId("simple-ask-card-button-approve"));
    assert.deepEqual(onPress.mock.calls[0]?.[0], card.buttons[0]);
    assert.deepEqual(onPress.mock.calls[0]?.[0]?.response, {
      action: "accept",
      content: {changed: false, markdown: ANNOUNCEMENT_DRAFT},
    });
  });

  it("keeps the handoff card's buttons next to the continue-on-phone line", async () => {
    const card = fixtureCard("choice-many-options-with-default");
    const onPress = mock((_button: SimpleCardButton) => {});
    const {getByTestId} = renderCard({card, onPress});

    assert.isOk(getByTestId("simple-ask-card-handoff"));
    await press(getByTestId("simple-ask-card-button-use-default"));
    assert.deepEqual(onPress.mock.calls[0]?.[0]?.response, {
      action: "accept",
      content: {selected: ["eu-west"]},
    });
  });

  it("shows the pending button loading and disables the others until the answer is sent", async () => {
    const card = fixtureCard("choice-plan-with-default");
    const onPress = mock((_button: SimpleCardButton) => {});
    const {getByTestId, rerender} = renderCard({card, onPress, pendingButtonId: "option:team"});

    const pending = getByTestId("simple-ask-card-button-option:team");
    assert.equal(spinnerCount(pending), 1);
    assert.isTrue(isDisabled(pending));
    for (const id of ["option:starter", "option:enterprise"]) {
      const other = getByTestId(`simple-ask-card-button-${id}`);
      assert.isTrue(isDisabled(other));
      assert.equal(spinnerCount(other), 0);
      await press(other);
    }
    assert.equal(onPress.mock.calls.length, 0);

    rerender(<SimpleAskCard card={card} onPress={onPress} />);
    await press(getByTestId("simple-ask-card-button-option:starter"));
    assert.equal(onPress.mock.calls[0]?.[0]?.id, "option:starter");
  });

  it("uses the given testID for the card, its handoff line, and its buttons", () => {
    const card = fixtureCard("choice-many-options-with-default");
    const {getByTestId} = renderCard({card, testID: "watch-card"});

    assert.isOk(getByTestId("watch-card"));
    assert.isOk(getByTestId("watch-card-handoff"));
    assert.isOk(getByTestId("watch-card-button-use-default"));
    assert.isOk(getByTestId("watch-card-button-skip"));
  });
});
