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
  it("rejects an element id that matches another id in the document", () => {
    const validated = validateBlocks(
      documentWith({
        blocks: [
          {
            elements: [
              {
                action: {kind: "reply", text: "Again"},
                id: "followups",
                text: "Again",
                type: "button",
              },
            ],
            id: "followups",
            type: "actions",
          },
        ],
      })
    );
    expect(validated.ok).toBe(false);
    if (validated.ok) {
      return;
    }
    expect(validated.errors.map((error) => error.code)).toEqual(["DUPLICATE_ID"]);
    expect(validated.errors[0]?.path).toBe("blocks[0].elements[0].id");
  });

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

  it("rejects dataset, chart, table, and image mistakes the schema still allows", () => {
    const datasets: Record<string, unknown> = {};
    for (let index = 0; index < 9; index += 1) {
      datasets[`set${index}`] = {
        columns: [
          {name: "month", type: "string"},
          {name: "month", type: "string"},
        ],
        rows: [["Jan", "Jan"]],
      };
    }
    datasets.signups = {
      columns: [
        {name: "n", type: "number"},
        {name: "count", type: "number"},
      ],
      rows: [[1, 2]],
    };
    const validated = validateBlocks(
      documentWith({
        blocks: [
          {alt: "Chart", src: "not a url", type: "image"},
          {
            data: "signups",
            kind: "bar",
            points: [{label: "Jan", value: 1}],
            type: "chart",
            x: "month",
            y: "count",
          },
          {kind: "line", type: "chart"},
          {data: "signups", kind: "bar", type: "chart", x: "n", y: "count"},
          {data: "signups", kind: "bar", type: "chart", x: "n", y: "missing"},
          {
            elements: [
              {
                id: "grain",
                options: [
                  {data: "signups", label: "Month"},
                  {data: "other", label: "Week"},
                ],
                target: "missing_chart",
                type: "segmented",
              },
            ],
            id: "row",
            type: "actions",
          },
          {data: "missing", type: "table"},
          {columns: ["missing"], data: "signups", type: "table"},
        ],
        datasets,
      })
    );
    expect(validated.ok).toBe(false);
    if (validated.ok) {
      return;
    }
    const codes = new Set(validated.errors.map((error) => error.code));
    expect(codes.has("TOO_MANY")).toBe(true);
    expect(codes.has("DUPLICATE_ID")).toBe(true);
    expect(codes.has("IMAGE_HOST_NOT_ALLOWED")).toBe(true);
    expect(codes.has("INVALID_TYPE")).toBe(true);
    expect(codes.has("MISSING_REQUIRED")).toBe(true);
    expect(codes.has("COLUMN_TYPE_MISMATCH")).toBe(true);
    expect(codes.has("COLUMN_NOT_FOUND")).toBe(true);
    expect(codes.has("SELECT_TARGET_INVALID")).toBe(true);
    expect(codes.has("DATASET_NOT_FOUND")).toBe(true);
  });
});

const stepper = (fields: Record<string, unknown> = {}): Record<string, unknown> => ({
  callback: {name: "scaleStepper"},
  id: "guests",
  label: "Number of people",
  max: 20,
  min: 1,
  type: "stepper",
  value: 5,
  ...fields,
});

const codesAndPaths = (
  doc: Record<string, unknown>,
  options?: Parameters<typeof validateBlocks>[1]
): {code: string; path: string}[] => {
  const validated = validateBlocks(doc, options);
  if (validated.ok) {
    return [];
  }
  return validated.errors.map((error) => ({code: error.code, path: error.path}));
};

describe("stepper lint", () => {
  it("checks the stepper callback name against hostActions", () => {
    const doc = documentWith({blocks: [stepper()]});
    expect(validateBlocks(doc).ok).toBe(true);
    expect(validateBlocks(doc, {hostActions: ["scaleStepper"]}).ok).toBe(true);
    const rejected = validateBlocks(doc, {hostActions: ["other"]});
    expect(rejected.ok).toBe(false);
    if (rejected.ok) {
      return;
    }
    expect(rejected.errors.map((error) => ({code: error.code, path: error.path}))).toEqual([
      {code: "UNKNOWN_HOST_ACTION", path: "blocks[0].callback.name"},
    ]);
  });

  it("checks the stepper callback name against stepperActions when the host passes them", () => {
    const doc = documentWith({blocks: [stepper()]});
    const handled = validateBlocks(doc, {
      hostActions: ["approve", "scaleStepper"],
      stepperActions: ["scaleStepper"],
    });
    expect(handled.ok).toBe(true);
    // Registered, but not a stepper action: its buttons would call a handler that is not for steppers.
    const unhandled = validateBlocks(
      documentWith({blocks: [stepper({callback: {name: "approve"}})]}),
      {
        hostActions: ["approve", "scaleStepper"],
        stepperActions: ["scaleStepper"],
      }
    );
    expect(unhandled.ok).toBe(false);
    if (unhandled.ok) {
      return;
    }
    expect(unhandled.errors).toEqual([
      {
        code: "UNKNOWN_HOST_ACTION",
        fix: "Use one of: scaleStepper.",
        message: expect.any(String),
        path: "blocks[0].callback.name",
      },
    ]);
    expect(codesAndPaths(doc, {hostActions: ["scaleStepper"], stepperActions: []})).toEqual([
      {code: "UNKNOWN_HOST_ACTION", path: "blocks[0].callback.name"},
    ]);
  });

  it("leaves a button callback to hostActions when stepperActions is set", () => {
    const doc = documentWith({
      blocks: [
        {
          elements: [
            {
              action: {kind: "callback", name: "approve"},
              id: "ok",
              text: "Approve",
              type: "button",
            },
          ],
          id: "row",
          type: "actions",
        },
      ],
    });
    expect(
      codesAndPaths(doc, {
        checklistActions: [],
        hostActions: ["approve", "scaleStepper"],
        stepperActions: ["scaleStepper"],
      })
    ).toEqual([]);
  });

  it("reports OUT_OF_RANGE when value leaves min and max or min is not below max", () => {
    expect(codesAndPaths(documentWith({blocks: [stepper({value: 0})]}))).toEqual([
      {code: "OUT_OF_RANGE", path: "blocks[0].value"},
    ]);
    expect(codesAndPaths(documentWith({blocks: [stepper({max: 5, min: 5})]}))).toEqual([
      {code: "OUT_OF_RANGE", path: "blocks[0].max"},
    ]);
    expect(codesAndPaths(documentWith({blocks: [stepper({value: 20})]}))).toEqual([]);
  });

  it("reserves the increase and decrease element ids before or after the stepper", () => {
    const button = (id: string): Record<string, unknown> => ({
      elements: [{action: {kind: "reply", text: "Hi"}, id, text: "Hi", type: "button"}],
      id: "row",
      type: "actions",
    });
    expect(codesAndPaths(documentWith({blocks: [button("guests_decrease"), stepper()]}))).toEqual([
      {code: "DUPLICATE_ID", path: "blocks[0].elements[0].id"},
    ]);
    expect(
      codesAndPaths(documentWith({blocks: [stepper(), {id: "guests_increase", type: "divider"}]}))
    ).toEqual([{code: "DUPLICATE_ID", path: "blocks[1].id"}]);
  });

  it("caps the stepper id, items, decimals, and step with closed codes", () => {
    expect(codesAndPaths(documentWith({blocks: [stepper({id: `g${"x".repeat(54)}`})]}))).toEqual([
      {code: "TOO_LONG", path: "blocks[0].id"},
    ]);
    expect(codesAndPaths(documentWith({blocks: [stepper({id: `g${"x".repeat(53)}`})]}))).toEqual(
      []
    );
    const items = Array.from({length: 13}, (_unused, index) => ({
      amount: index,
      label: `i${index}`,
    }));
    expect(codesAndPaths(documentWith({blocks: [stepper({items})]}))).toEqual([
      {code: "TOO_MANY", path: "blocks[0].items"},
    ]);
    expect(codesAndPaths(documentWith({blocks: [stepper({step: 0})]}))).toEqual([
      {code: "OUT_OF_RANGE", path: "blocks[0].step"},
    ]);
    const decimals = validateBlocks(
      documentWith({blocks: [stepper({items: [{amount: 2, decimals: 4, label: "Lamb"}]})]})
    );
    expect(decimals.ok).toBe(false);
    if (!decimals.ok) {
      expect(decimals.errors[0]?.fix).toContain("3");
    }
    expect(
      codesAndPaths(
        documentWith({blocks: [stepper({items: [{amount: 2, label: "Lamb", round: "down"}]})]})
      )
    ).toEqual([{code: "INVALID_ENUM", path: "blocks[0].items[0].round"}]);
  });
});
