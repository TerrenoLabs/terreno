import {describe, expect, it} from "bun:test";
import {parseBlocks, validateBlocks} from "@terreno/blocks";

import {runPlaygroundAction} from "./blocksPlaygroundHost";
import {PLAYGROUND_HOST_ACTIONS, PRESETS} from "./blocksPlaygroundPresets";

describe("runPlaygroundAction", () => {
  it("describes actions it cannot run", () => {
    const run = (action: Parameters<typeof runPlaygroundAction>[0]["event"]["action"]): string =>
      runPlaygroundAction({document: undefined, event: {action, blockId: "a", elementId: "b"}})
        .message;
    expect(run({kind: "reply", text: "Adjust the plan"})).toBe('Reply: "Adjust the plan"');
    expect(run({kind: "open", url: "https://example.com"})).toBe("Open: https://example.com");
    expect(run({kind: "open", route: "/settings"})).toBe("Open: /settings");
    expect(run({data: "weekly", kind: "select", target: "chart"})).toBe("Select: weekly on chart");
    expect(run({kind: "callback", name: "exportDataset", payload: {dataset: "x"}})).toBe(
      'Callback "exportDataset" sent {"dataset":"x"}'
    );
  });
});

describe("runPlaygroundAction with the Sunday roast document", () => {
  const parsed = parseBlocks(PRESETS["Sunday roast"]);
  const validated = parsed.ok
    ? validateBlocks(parsed.value, {allowHtml: true, hostActions: PLAYGROUND_HOST_ACTIONS})
    : undefined;
  const document = validated?.ok ? validated.doc : undefined;
  const callback = (
    blockId: string,
    payload: Record<string, unknown>
  ): ReturnType<typeof runPlaygroundAction> =>
    runPlaygroundAction({
      document,
      event: {action: {kind: "callback", name: "host", payload}, blockId, elementId: "e"},
    });

  it("parses the roast preset", () => {
    expect(document).toBeDefined();
  });

  it("scales the stepper from the block the document wrote", () => {
    const result = callback("guests", {value: 6});
    expect(result.message).toBe("host → 6 People");
    expect(result.override?.blockId).toBe("guests");
    const block = result.override?.block;
    expect(block?.type === "stepper" ? block.items?.[0]?.amount : undefined).toBe(2.4);
    // A second step still scales from the original, not from the first result.
    const eight = callback("guests", {value: 8}).override?.block;
    expect(eight?.type === "stepper" ? eight.items?.[0]?.amount : undefined).toBe(3.2);
  });

  it("rejects a stepper value outside the range", () => {
    const result = callback("guests", {value: 99});
    expect(result.message).toBe("host rejected 99");
    expect(result.override).toBeUndefined();
  });

  it("applies checklist ticks and counts them", () => {
    const result = callback("cooking", {
      checked: true,
      itemId: "prepare_lamb",
      state: {prep_ahead: true, prepare_lamb: true},
    });
    expect(result.message).toBe("host → 2 of 8");
    expect(result.override?.blockId).toBe("cooking");
  });

  it("only describes a callback on a block that is not a stepper or checklist", () => {
    expect(callback("roast_photos", {x: 1}).message).toBe('Callback "host" sent {"x":1}');
    expect(callback("missing", {}).message).toBe('Callback "host" sent {}');
  });

  it("describes a copy", () => {
    expect(
      runPlaygroundAction({
        document,
        event: {action: {kind: "copy", text: "x"}, blockId: "a", elementId: "b"},
      }).message
    ).toBe("Copied");
  });
});
