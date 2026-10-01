import {describe, expect, it} from "bun:test";

import {validateBlocks} from "./validate";

describe("validateBlocks performance", () => {
  it("validates a 50-block, 8-dataset document in under 5 ms median", () => {
    const datasets: Record<
      string,
      {columns: {name: string; type: string}[]; rows: [string, number][]}
    > = {};
    for (let index = 0; index < 8; index += 1) {
      datasets[`set_${index}`] = {
        columns: [
          {name: "label", type: "string"},
          {name: "value", type: "number"},
        ],
        rows: [
          ["a", 1],
          ["b", 2],
        ],
      };
    }
    const blocks = Array.from({length: 50}, (_unused, index) =>
      index === 0
        ? {data: "set_0", kind: "bar", type: "chart", x: "label", y: "value"}
        : {type: "divider"}
    );
    const doc: Record<string, unknown> = {};
    doc.v = 1;
    doc.datasets = datasets;
    doc.blocks = blocks;
    const samples: number[] = [];
    for (let run = 0; run < 11; run += 1) {
      const started = performance.now();
      const validated = validateBlocks(doc);
      samples.push(performance.now() - started);
      expect(validated.ok).toBe(true);
    }
    samples.sort((left, right) => left - right);
    const median = samples[5];
    expect(median).toBeLessThan(5);
  });
});
