import {describe, it} from "bun:test";
import type {ChoiceAskInput, ConfirmAskInput, FormAskInput} from "@terreno/blocks";
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

const confirmAsk = (input: ConfirmAskInput, state: Partial<ChatAsk>): ChatAsk =>
  ({input, kind: "confirm", status: "answered", toolCallId: "call_archive", ...state}) as ChatAsk;

const ARCHIVE_INPUT: ConfirmAskInput = {
  confirmLabel: "Archive 12 chats",
  denyLabel: "Keep them",
  destructive: true,
  prompt: "Archive the 12 chats older than 90 days?",
};

const CONTACT_INPUT: FormAskInput = {
  fields: [
    {id: "name", label: "Name", required: true, type: "text"},
    {id: "email", label: "Email", type: "email"},
  ],
  prompt: "How should we reach you?",
};

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

  it.each([
    {confirmed: true, expected: "You confirmed: Archive 12 chats", input: ARCHIVE_INPUT},
    {confirmed: false, expected: "You declined: Keep them", input: ARCHIVE_INPUT},
    {confirmed: true, expected: "You confirmed: Confirm", input: {prompt: "Send it?"}},
    {confirmed: false, expected: "You declined: Cancel", input: {prompt: "Send it?"}},
  ])('summarizes a confirm answer as "$expected"', ({confirmed, expected, input}) => {
    const summary = askSummary(
      confirmAsk(input, {response: {action: "accept", content: {confirmed}}})
    );
    assert.equal(summary, expected);
  });

  it("says the user answered when a confirm answer has no confirmed value", () => {
    const summary = askSummary(
      confirmAsk(ARCHIVE_INPUT, {response: {action: "accept", content: {}}})
    );
    assert.equal(summary, "You answered this question.");
  });

  it("says the user skipped a declined confirm", () => {
    assert.equal(
      askSummary(confirmAsk(ARCHIVE_INPUT, {response: {action: "decline"}})),
      "You skipped this question."
    );
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

  it("names the files a files answer sent", () => {
    const filesAsk = (files: unknown): ChatAsk =>
      ({
        input: {accept: ["image", "text"], prompt: "Upload the receipt."},
        kind: "files",
        response: {action: "accept", content: {files}},
        status: "answered",
        toolCallId: "call_1",
      }) as ChatAsk;

    assert.equal(
      askSummary(
        filesAsk([
          {filename: "receipt.png", mimeType: "image/png", size: 12},
          {filename: "items.txt", mimeType: "text/plain", size: 25},
        ])
      ),
      "You sent 2 files: receipt.png, items.txt"
    );
    assert.equal(
      askSummary(
        filesAsk([{fileId: "f1", filename: "receipt.png", mimeType: "image/png", size: 1}])
      ),
      "You sent 1 file: receipt.png"
    );
    assert.equal(askSummary(filesAsk([])), "You sent 0 files");
    assert.equal(askSummary(filesAsk("not files")), "You answered this question.");
  });

  it("counts the fields a form answer filled in", () => {
    const formAsk = (values: unknown): ChatAsk =>
      ({
        input: CONTACT_INPUT,
        kind: "form",
        response: {action: "accept", content: {values}},
        status: "answered",
        toolCallId: "call_contact",
      }) as ChatAsk;

    assert.equal(
      askSummary(formAsk({email: "ada@example.com", name: "Ada"})),
      "You sent the form (2 fields)"
    );
    assert.equal(askSummary(formAsk({name: "Ada"})), "You sent the form (1 field)");
    assert.equal(askSummary(formAsk({})), "You sent the form (0 fields)");
    assert.equal(askSummary(formAsk("not values")), "You answered this question.");
  });

  it("says the user answered when a saved ask's input is missing or invalid", () => {
    const answeredWithInput = (input: unknown): ChatAsk =>
      planAsk({
        input: input as ChoiceAskInput,
        response: {action: "accept", content: {selected: ["team"]}},
      });

    assert.equal(askSummary(answeredWithInput({})), "You answered this question.");
    assert.equal(
      askSummary(answeredWithInput({options: "team", prompt: "Which plan?"})),
      "You answered this question."
    );
    assert.equal(
      askSummary(
        confirmAsk({} as ConfirmAskInput, {
          response: {action: "accept", content: {confirmed: true}},
        })
      ),
      "You answered this question."
    );
  });

  it("describes an ask from its status when its answer is not known", () => {
    assert.equal(askSummary(planAsk({status: "answered"})), "You answered this question.");
    assert.equal(askSummary(planAsk({status: "cancelled"})), "This question was cancelled.");
    assert.equal(askSummary(planAsk({status: "pending"})), "Waiting for your answer.");
  });

  it("says the user answered when an accepted answer has no content object", () => {
    const withContent = (state: Partial<ChatAsk>, content: unknown): string =>
      askSummary({...state, response: {action: "accept", content}} as ChatAsk);
    const valid: Array<Partial<ChatAsk>> = [
      planAsk({}),
      confirmAsk(ARCHIVE_INPUT, {}),
      {input: CONTACT_INPUT, kind: "form", status: "answered", toolCallId: "call_contact"},
      {
        input: {draft: "# Hi", prompt: "Review the post"},
        kind: "markdown",
        status: "answered",
        toolCallId: "call_post",
      } as ChatAsk,
      {input: {prompt: "Upload"}, kind: "files", status: "answered", toolCallId: "call_upload"},
    ] as ChatAsk[];
    for (const ask of valid) {
      assert.equal(withContent(ask, undefined), "You answered this question.", ask.kind);
      assert.equal(withContent(ask, null), "You answered this question.", ask.kind);
      assert.equal(withContent(ask, "yes"), "You answered this question.", ask.kind);
    }
  });
});
