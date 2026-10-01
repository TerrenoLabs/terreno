import {describe, expect, it} from "bun:test";

import {validateBlocks} from "./validate";

const documentWith = ({
  blocks,
  datasets,
}: {
  blocks: unknown[];
  datasets?: Record<string, unknown>;
}): Record<string, unknown> => {
  const doc: Record<string, unknown> = {};
  doc.v = 1;
  if (datasets !== undefined) {
    doc.datasets = datasets;
  }
  doc.blocks = blocks;
  return doc;
};

const inline = {
  columns: [
    {name: "month", type: "string"},
    {name: "count", type: "number"},
  ],
  rows: [
    ["Jan", 1],
    ["Feb", 2],
  ],
};

describe("lintDocument", () => {
  it("rejects a callback that is not in the host allowlist", () => {
    const doc = documentWith({
      blocks: [
        {
          elements: [
            {
              action: {kind: "callback", name: "exportDataset"},
              id: "export",
              text: "Export",
              type: "button",
            },
          ],
          id: "followups",
          type: "actions",
        },
      ],
    });
    const allowed = validateBlocks(doc, {hostActions: ["exportDataset"]});
    expect(allowed.ok).toBe(true);

    const rejected = validateBlocks(doc, {hostActions: ["other"]});
    expect(rejected.ok).toBe(false);
    if (rejected.ok) {
      return;
    }
    expect(rejected.errors.map((error) => error.code)).toEqual(["UNKNOWN_HOST_ACTION"]);

    const unchecked = validateBlocks(doc);
    expect(unchecked.ok).toBe(true);
  });

  it("requires an open action to set url or route, not both", () => {
    const open = (action: Record<string, unknown>): Record<string, unknown> =>
      documentWith({
        blocks: [
          {
            elements: [{action, id: "go", text: "Go", type: "button"}],
            id: "followups",
            type: "actions",
          },
        ],
      });
    expect(validateBlocks(open({kind: "open", route: "/reports"})).ok).toBe(true);
    expect(validateBlocks(open({kind: "open", url: "https://example.com"})).ok).toBe(true);
    const neither = validateBlocks(open({kind: "open"}));
    expect(neither.ok).toBe(false);
    if (!neither.ok) {
      expect(neither.errors.map((error) => ({code: error.code, path: error.path}))).toEqual([
        {code: "MISSING_REQUIRED", path: "blocks[0].elements[0].action"},
      ]);
    }
    expect(
      validateBlocks(open({kind: "open", route: "/reports", url: "https://example.com"})).ok
    ).toBe(false);
  });

  it("warns when a bar, donut, or line chart is a poor fit", () => {
    const rows = Array.from({length: 61}, (_unused, index) => [`m${index}`, index]);
    const bar = validateBlocks(
      documentWith({
        blocks: [{data: "signups", kind: "bar", type: "chart", x: "month", y: "count"}],
        datasets: {signups: {...inline, rows}},
      })
    );
    expect(bar.ok).toBe(true);
    if (!bar.ok) {
      return;
    }
    expect(bar.warnings.map((warning) => warning.code)).toEqual(["BAR_TOO_MANY_CATEGORIES"]);

    const donut = validateBlocks(
      documentWith({
        blocks: [
          {
            kind: "donut",
            points: Array.from({length: 9}, (_unused, index) => ({
              label: `s${index}`,
              value: index,
            })),
            type: "chart",
          },
        ],
      })
    );
    expect(donut.ok).toBe(true);
    if (!donut.ok) {
      return;
    }
    expect(donut.warnings.map((warning) => warning.code)).toEqual(["DONUT_TOO_MANY_SLICES"]);

    const line = validateBlocks(
      documentWith({
        blocks: [{data: "signups", kind: "line", type: "chart", x: "month", y: "count"}],
        datasets: {signups: {...inline, rows: [["Jan", 1]]}},
      })
    );
    expect(line.ok).toBe(true);
    if (!line.ok) {
      return;
    }
    expect(line.warnings.map((warning) => warning.code)).toEqual(["LINE_SINGLE_POINT"]);
  });

  it("checks ref columns only when the handle is known", () => {
    const doc = documentWith({
      blocks: [{data: "daily", kind: "line", type: "chart", x: "day", y: "count"}],
      datasets: {daily: {id: "ds_1", limit: 200, source: "ref"}},
    });
    expect(validateBlocks(doc).ok).toBe(true);
    const checked = validateBlocks(doc, {
      knownDatasets: {
        ds_1: {
          columns: [
            {name: "day", type: "date"},
            {name: "count", type: "string"},
          ],
        },
      },
    });
    expect(checked.ok).toBe(false);
    if (checked.ok) {
      return;
    }
    expect(checked.errors.map((error) => ({code: error.code, path: error.path}))).toEqual([
      {code: "COLUMN_TYPE_MISMATCH", path: "blocks[0].y"},
    ]);
  });

  it("rejects a number stored in a string column", () => {
    const validated = validateBlocks(
      documentWith({
        blocks: [{type: "divider"}],
        datasets: {signups: {...inline, rows: [[1, 2]]}},
      })
    );
    expect(validated.ok).toBe(false);
    if (validated.ok) {
      return;
    }
    expect(validated.errors.map((error) => error.code)).toEqual(["COLUMN_TYPE_MISMATCH"]);
  });

  it("rejects more than 500 inline rows", () => {
    const rows = Array.from({length: 501}, (_unused, index) => [`m${index}`, index]);
    const validated = validateBlocks(
      documentWith({
        blocks: [{type: "divider"}],
        datasets: {signups: {...inline, rows}},
      })
    );
    expect(validated.ok).toBe(false);
    if (validated.ok) {
      return;
    }
    expect(validated.errors.map((error) => ({code: error.code, path: error.path}))).toEqual([
      {code: "DATASET_TOO_LARGE", path: "datasets.signups.rows"},
    ]);
    expect(validated.errors[0]?.fix).toContain("500");
  });
});
