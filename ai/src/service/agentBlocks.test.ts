import {describe, expect, it} from "bun:test";
import {isAPIError} from "@terreno/api";

import {GptHistory} from "../models/gptHistory";
import type {GptHistoryDocument, GptHistoryPrompt} from "../types";
import {findAgentBlock} from "./agentBlocks";

const stepperYaml = ({id = "guests", value = 5}: {id?: string; value?: number} = {}): string =>
  `v: 1
blocks:
  - type: card
    children:
      - type: stepper
        id: ${id}
        label: Number of people
        value: ${value}
        min: 1
        max: 20
        callback:
          name: scaleStepper
`;

const historyWith = (prompts: GptHistoryPrompt[]): GptHistoryDocument =>
  new GptHistory({prompts, userId: "000000000000000000000001"}) as unknown as GptHistoryDocument;

const statusOf = (work: () => unknown): number | undefined => {
  try {
    work();
  } catch (error) {
    if (isAPIError(error)) {
      return error.status;
    }
    throw error;
  }
  return undefined;
};

describe("findAgentBlock", () => {
  it("reads history.prompts[n] for msg-<n> and finds a block nested in a card", () => {
    const history = historyWith([
      {text: "Plan a roast", type: "user"},
      {text: stepperYaml({value: 4}), type: "assistant"},
      {text: "More people", type: "user"},
      {text: stepperYaml({value: 7}), type: "assistant"},
    ]);
    const found = findAgentBlock({blockId: "guests", history, messageId: "msg-3", type: "stepper"});
    expect(found.value).toBe(7);
    expect(found.type).toBe("stepper");
  });

  it("falls back to the only assistant prompt holding the block when msg-<n> misses", () => {
    const history = historyWith([
      {text: "Plan a roast", type: "user"},
      {text: `\`\`\`yaml\n${stepperYaml({value: 5})}\`\`\``, type: "assistant"},
      {text: "Thanks", type: "assistant"},
    ]);
    expect(
      findAgentBlock({blockId: "guests", history, messageId: "msg-2", type: "stepper"}).value
    ).toBe(5);
    expect(
      findAgentBlock({blockId: "guests", history, messageId: "host-id-7", type: "stepper"}).value
    ).toBe(5);
  });

  it("returns 409 when several prompts hold the block and msg-<n> misses", () => {
    const history = historyWith([
      {text: stepperYaml({value: 4}), type: "assistant"},
      {text: stepperYaml({value: 6}), type: "assistant"},
    ]);
    expect(
      statusOf(() => findAgentBlock({blockId: "guests", history, messageId: "m1", type: "stepper"}))
    ).toBe(409);
    expect(
      findAgentBlock({blockId: "guests", history, messageId: "msg-1", type: "stepper"}).value
    ).toBe(6);
  });

  it("returns 404 for an unknown id, a user prompt, or a block of another type", () => {
    const history = historyWith([
      {text: stepperYaml(), type: "user"},
      {text: "v: 1\nblocks:\n  - type: heading\n    id: guests\n    text: Hi\n", type: "assistant"},
      {text: "not a document", type: "assistant"},
    ]);
    expect(
      statusOf(() =>
        findAgentBlock({blockId: "guests", history, messageId: "msg-0", type: "stepper"})
      )
    ).toBe(404);
    expect(
      statusOf(() =>
        findAgentBlock({blockId: "missing", history, messageId: "msg-1", type: "stepper"})
      )
    ).toBe(404);
  });
});
