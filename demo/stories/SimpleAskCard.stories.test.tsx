import {describe, expect, it} from "bun:test";
import {readdirSync} from "node:fs";
import {join} from "node:path";
import {turnRequestSchema} from "@terreno/blocks";
import {act, fireEvent, within} from "@testing-library/react-native";
import {StyleSheet} from "react-native";

import {renderWithTheme} from "../../ui/src/test-utils";
import {SimpleAskCardDemo, SimpleAskCardFixtures} from "./SimpleAskCard.stories";

const FIXTURES_DIR = join(
  import.meta.dir,
  "..",
  "..",
  "blocks",
  "src",
  "asks",
  "fixtures",
  "valid"
);

const TURN_PREFIX = "POST /gpt/histories/{id}/turn ";

const fixtureNames = (): string[] =>
  readdirSync(FIXTURES_DIR)
    .filter((file) => file.endsWith(".json"))
    .map((file) => file.replace(/\.json$/, ""))
    .sort();

const textOf = (node: {children: unknown[]}): string =>
  node.children.map((child) => (typeof child === "string" ? child : "")).join("");

describe("SimpleAskCard stories", () => {
  it("draws every valid ask fixture's card in a 198×242 pt watch frame", () => {
    const names = fixtureNames();
    const {getByTestId, queryAllByTestId} = renderWithTheme(<SimpleAskCardFixtures />);

    expect(names.length).toBeGreaterThan(0);
    const frameIds = queryAllByTestId(/^watch-frame-/).map((frame) => frame.props.testID);
    expect(frameIds.sort()).toEqual(names.map((name) => `watch-frame-${name}`));
    for (const name of names) {
      const frame = getByTestId(`watch-frame-${name}`);
      expect(StyleSheet.flatten(frame.props.style)).toMatchObject({height: 242, width: 198});
      expect(within(frame).getByTestId(`simple-ask-card-${name}`)).toBeTruthy();
    }
  });

  it("sends a valid compact turn body when the watch card is tapped", async () => {
    const {getByTestId, getByText, queryByTestId} = renderWithTheme(<SimpleAskCardDemo />);

    await act(async () => {
      fireEvent.press(getByTestId("demo-simple-ask-card-button-option:team"));
      await new Promise((resolve) => setTimeout(resolve, 0));
    });
    expect(queryByTestId("demo-watch-turn-body")).toBeNull();

    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 700));
    });
    expect(getByText("Sent “Team”.")).toBeTruthy();
    const line = within(getByTestId("demo-watch-turn-body")).getByText(/^POST /);
    const text = textOf(line);
    expect(text.startsWith(TURN_PREFIX)).toBe(true);
    expect(turnRequestSchema.parse(JSON.parse(text.slice(TURN_PREFIX.length)))).toEqual({
      buttonId: "option:team",
      surface: "compact",
      toolCallId: "call_fixture",
    });
  });
});
