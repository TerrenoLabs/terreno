import {describe, it} from "bun:test";
import type {ChoiceAskInput} from "@terreno/blocks";
import {assert} from "chai";

import {askSummary} from "./askSummary";
import type {ChatAsk} from "./askTypes";

const PLAN_INPUT: ChoiceAskInput = {
  options: [
    {id: "starter", label: "Starter"},
    {id: "team", label: "Team"},
    {id: "enterprise", label: "Enterprise"},
  ],
  prompt: "Which plan should I set up?",
  select: "one",
};

const planAsk = (state: Partial<ChatAsk>): ChatAsk => ({
  input: PLAN_INPUT,
  kind: "choice",
  status: "answered",
  toolCallId: "call_plan",
  ...state,
});

describe("askSummary", () => {
  it("names the chosen option by its label", () => {
    const summary = askSummary(
      planAsk({response: {action: "accept", content: {selected: ["team"]}}})
    );
    assert.equal(summary, "You chose: Team");
  });

  it("falls back to the option id when the answer names an option the ask does not list", () => {
    const summary = askSummary(
      planAsk({response: {action: "accept", content: {selected: ["gold"]}}})
    );
    assert.equal(summary, "You chose: gold");
  });

  it("says the user answered when an accepted answer selects nothing", () => {
    const summary = askSummary(planAsk({response: {action: "accept", content: {}}}));
    assert.equal(summary, "You answered this question.");
  });

  it("lists every chosen option and the Other text of a select many answer", () => {
    const summary = askSummary(
      planAsk({
        input: {...PLAN_INPUT, allowOther: true, select: "many"},
        response: {action: "accept", content: {other: "Nonprofit", selected: ["starter", "team"]}},
      })
    );
    assert.equal(summary, "You chose: Starter, Team. Other: Nonprofit");
  });

  it("shows only the Other text when the answer selects no option", () => {
    const summary = askSummary(
      planAsk({
        input: {...PLAN_INPUT, allowOther: true, select: "many"},
        response: {action: "accept", content: {other: "Nonprofit", selected: []}},
      })
    );
    assert.equal(summary, "Other: Nonprofit");
  });

  it("names the Other text with the ask's otherLabel when it sets one", () => {
    const summary = askSummary(
      planAsk({
        input: {...PLAN_INPUT, allowOther: true, otherLabel: "Another plan", select: "many"},
        response: {action: "accept", content: {other: "Nonprofit", selected: ["team"]}},
      })
    );
    assert.equal(summary, "You chose: Team. Another plan: Nonprofit");
  });

  it("says no option was chosen for an empty select many answer", () => {
    const summary = askSummary(
      planAsk({
        input: {...PLAN_INPUT, minSelected: 0, select: "many"},
        response: {action: "accept", content: {selected: []}},
      })
    );
    assert.equal(summary, "You chose none of the options.");
  });

  it("says the user skipped a declined ask", () => {
    assert.equal(
      askSummary(planAsk({response: {action: "decline"}})),
      "You skipped this question."
    );
  });

  it("says a message replaced the ask when the user sent one while it was pending", () => {
    const summary = askSummary(
      planAsk({response: {action: "cancel", reason: "user_sent_message"}, status: "cancelled"})
    );
    assert.equal(summary, "Not answered: you sent a message instead.");
  });

  it("says the assistant asked another question when two asks arrived together", () => {
    const summary = askSummary(
      planAsk({response: {action: "cancel", reason: "one_ask_at_a_time"}, status: "cancelled"})
    );
    assert.equal(summary, "Not asked: the assistant asked another question first.");
  });

  it("says an ask was cancelled for any other reason", () => {
    assert.equal(
      askSummary(planAsk({response: {action: "cancel"}, status: "cancelled"})),
      "This question was cancelled."
    );
  });

  it("describes an ask from its status when its answer is not known", () => {
    assert.equal(askSummary(planAsk({status: "answered"})), "You answered this question.");
    assert.equal(askSummary(planAsk({status: "cancelled"})), "This question was cancelled.");
    assert.equal(askSummary(planAsk({status: "pending"})), "Waiting for your answer.");
  });
});
