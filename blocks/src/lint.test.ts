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

const checklist = (fields: Record<string, unknown> = {}): Record<string, unknown> => ({
  id: "cooking",
  items: [
    {id: "oven", text: "Preheat the oven"},
    {checked: true, id: "lamb", text: "Put the lamb in"},
  ],
  type: "checklist",
  ...fields,
});

const checklistItems = (count: number): Record<string, unknown>[] =>
  Array.from({length: count}, (_unused, index) => ({id: `i${index}`, text: `Step ${index}`}));

describe("checklist lint", () => {
  it("accepts a checklist without a callback whatever actions the host registers", () => {
    const doc = documentWith({blocks: [checklist()]});
    expect(codesAndPaths(doc)).toEqual([]);
    expect(codesAndPaths(doc, {checklistActions: [], hostActions: []})).toEqual([]);
  });

  it("checks the checklist callback name against hostActions when checklistActions is omitted", () => {
    const doc = documentWith({blocks: [checklist({callback: {name: "toggleChecklist"}})]});
    expect(codesAndPaths(doc)).toEqual([]);
    expect(codesAndPaths(doc, {hostActions: ["toggleChecklist"]})).toEqual([]);
    expect(codesAndPaths(doc, {hostActions: ["other"]})).toEqual([
      {code: "UNKNOWN_HOST_ACTION", path: "blocks[0].callback.name"},
    ]);
  });

  it("checks the checklist callback name against checklistActions when the host passes them", () => {
    const options = {
      checklistActions: ["toggleChecklist"],
      hostActions: ["approve", "toggleChecklist"],
    };
    expect(
      codesAndPaths(
        documentWith({blocks: [checklist({callback: {name: "toggleChecklist"}})]}),
        options
      )
    ).toEqual([]);
    // Registered, but not a checklist action: a tick would call a handler that is not for checklists.
    const unhandled = validateBlocks(
      documentWith({blocks: [checklist({callback: {name: "approve"}})]}),
      options
    );
    expect(unhandled.ok).toBe(false);
    if (unhandled.ok) {
      return;
    }
    expect(unhandled.errors).toEqual([
      {
        code: "UNKNOWN_HOST_ACTION",
        fix: "Use one of: toggleChecklist.",
        message: expect.any(String),
        path: "blocks[0].callback.name",
      },
    ]);
    expect(
      codesAndPaths(documentWith({blocks: [checklist({callback: {name: "toggleChecklist"}})]}), {
        checklistActions: [],
        hostActions: ["toggleChecklist"],
      })
    ).toEqual([{code: "UNKNOWN_HOST_ACTION", path: "blocks[0].callback.name"}]);
  });

  it("does not let stepperActions decide a checklist callback, or checklistActions a stepper's", () => {
    const doc = documentWith({
      blocks: [checklist({callback: {name: "toggleChecklist"}}), stepper()],
    });
    expect(
      codesAndPaths(doc, {
        checklistActions: ["toggleChecklist"],
        hostActions: ["scaleStepper", "toggleChecklist"],
        stepperActions: ["scaleStepper"],
      })
    ).toEqual([]);
    expect(
      codesAndPaths(doc, {
        checklistActions: ["scaleStepper"],
        hostActions: ["scaleStepper", "toggleChecklist"],
        stepperActions: ["toggleChecklist"],
      })
    ).toEqual([
      {code: "UNKNOWN_HOST_ACTION", path: "blocks[0].callback.name"},
      {code: "UNKNOWN_HOST_ACTION", path: "blocks[1].callback.name"},
    ]);
  });

  it("rejects a repeated item id within one checklist but not across checklists", () => {
    const repeated = checklist({
      items: [
        {id: "oven", text: "Preheat the oven"},
        {id: "oven", text: "Turn the oven off"},
      ],
    });
    expect(codesAndPaths(documentWith({blocks: [repeated]}))).toEqual([
      {code: "DUPLICATE_ID", path: "blocks[0].items[1].id"},
    ]);
    expect(
      codesAndPaths(
        documentWith({
          blocks: [checklist(), checklist({id: "prep", items: [{id: "oven", text: "Clean"}]})],
        })
      )
    ).toEqual([]);
  });

  it("reserves <id>_<item id> before or after the checklist and names the checklist in the fix", () => {
    const button = (id: string): Record<string, unknown> => ({
      elements: [{action: {kind: "reply", text: "Hi"}, id, text: "Hi", type: "button"}],
      id: "row",
      type: "actions",
    });
    const before = validateBlocks(documentWith({blocks: [button("cooking_oven"), checklist()]}));
    expect(before.ok).toBe(false);
    if (before.ok) {
      return;
    }
    expect(before.errors.map((error) => ({code: error.code, path: error.path}))).toEqual([
      {code: "DUPLICATE_ID", path: "blocks[0].elements[0].id"},
    ]);
    expect(before.errors[0]?.fix).toContain("<id>_<item id>");
    expect(
      codesAndPaths(documentWith({blocks: [checklist(), {id: "cooking_lamb", type: "divider"}]}))
    ).toEqual([{code: "DUPLICATE_ID", path: "blocks[1].id"}]);
  });

  it("reports a repeated block id once, not once per derived element id", () => {
    expect(codesAndPaths(documentWith({blocks: [stepper(), stepper()]}))).toEqual([
      {code: "DUPLICATE_ID", path: "blocks[1].id"},
    ]);
    expect(codesAndPaths(documentWith({blocks: [checklist(), checklist()]}))).toEqual([
      {code: "DUPLICATE_ID", path: "blocks[1].id"},
    ]);
  });

  it("rejects two ticks that would share an element id", () => {
    const first = checklist({id: "a_b", items: [{id: "c", text: "One"}]});
    const second = checklist({id: "a", items: [{id: "b_c", text: "Two"}]});
    expect(codesAndPaths(documentWith({blocks: [first, second]}))).toEqual([
      {code: "DUPLICATE_ID", path: "blocks[1].items[0].id"},
    ]);
    expect(
      codesAndPaths(
        documentWith({
          blocks: [
            stepper({id: "a_b"}),
            checklist({id: "a", items: [{id: "b_increase", text: "Up"}]}),
          ],
        })
      )
    ).toEqual([{code: "DUPLICATE_ID", path: "blocks[1].items[0].id"}]);
    expect(
      codesAndPaths(
        documentWith({
          blocks: [
            checklist({id: "a", items: [{id: "b_increase", text: "Up"}]}),
            stepper({id: "a_b"}),
          ],
        })
      )
    ).toEqual([{code: "DUPLICATE_ID", path: "blocks[1].id"}]);
  });

  it("caps the checklist id, item ids, item count, and text fields with closed codes", () => {
    expect(codesAndPaths(documentWith({blocks: [checklist({id: `c${"x".repeat(31)}`})]}))).toEqual([
      {code: "TOO_LONG", path: "blocks[0].id"},
    ]);
    expect(codesAndPaths(documentWith({blocks: [checklist({id: `c${"x".repeat(30)}`})]}))).toEqual(
      []
    );
    const itemWith = (fields: Record<string, unknown>): Record<string, unknown> =>
      checklist({items: [{id: "oven", text: "Preheat", ...fields}]});
    expect(codesAndPaths(documentWith({blocks: [itemWith({id: `i${"x".repeat(32)}`})]}))).toEqual([
      {code: "TOO_LONG", path: "blocks[0].items[0].id"},
    ]);
    expect(codesAndPaths(documentWith({blocks: [itemWith({id: `i${"x".repeat(31)}`})]}))).toEqual(
      []
    );
    expect(codesAndPaths(documentWith({blocks: [itemWith({id: "Oven"})]}))).toEqual([
      {code: "INVALID_FORMAT", path: "blocks[0].items[0].id"},
    ]);
    expect(codesAndPaths(documentWith({blocks: [checklist({items: checklistItems(30)})]}))).toEqual(
      []
    );
    expect(codesAndPaths(documentWith({blocks: [checklist({items: checklistItems(31)})]}))).toEqual(
      [{code: "TOO_MANY", path: "blocks[0].items"}]
    );
    expect(codesAndPaths(documentWith({blocks: [checklist({items: []})]}))).toEqual([
      {code: "TOO_FEW", path: "blocks[0].items"},
    ]);
    expect(codesAndPaths(documentWith({blocks: [checklist({title: "t".repeat(121)})]}))).toEqual([
      {code: "TOO_LONG", path: "blocks[0].title"},
    ]);
    expect(codesAndPaths(documentWith({blocks: [itemWith({text: "t".repeat(121)})]}))).toEqual([
      {code: "TOO_LONG", path: "blocks[0].items[0].text"},
    ]);
    expect(codesAndPaths(documentWith({blocks: [itemWith({detail: "d".repeat(281)})]}))).toEqual([
      {code: "TOO_LONG", path: "blocks[0].items[0].detail"},
    ]);
    expect(codesAndPaths(documentWith({blocks: [itemWith({meta: "m".repeat(41)})]}))).toEqual([
      {code: "TOO_LONG", path: "blocks[0].items[0].meta"},
    ]);
    expect(
      codesAndPaths(
        documentWith({
          blocks: [
            itemWith({detail: "d".repeat(280), meta: "m".repeat(40), text: "t".repeat(120)}),
          ],
        })
      )
    ).toEqual([]);
    expect(codesAndPaths(documentWith({blocks: [itemWith({checked: "yes"})]}))).toEqual([
      {code: "INVALID_TYPE", path: "blocks[0].items[0].checked"},
    ]);
    expect(codesAndPaths(documentWith({blocks: [checklist({items: [{id: "oven"}]})]}))).toEqual([
      {code: "MISSING_REQUIRED", path: "blocks[0].items[0].text"},
    ]);
  });
});

const galleryImages = (count: number): Record<string, unknown>[] =>
  Array.from({length: count}, (_unused, index) => ({alt: `Photo ${index}`, src: `file:p${index}`}));

const gallery = (fields: Record<string, unknown> = {}): Record<string, unknown> => ({
  images: galleryImages(3),
  type: "gallery",
  ...fields,
});

describe("gallery lint", () => {
  it("accepts data:image and file: tiles without imageHosts, with or without captions", () => {
    const images = [
      {alt: "Roast lamb", caption: "Roast lamb", src: "file:roast-lamb"},
      {alt: "Potatoes", src: "data:image/png;base64,iVBORw0KGgo="},
    ];
    expect(codesAndPaths(documentWith({blocks: [gallery({id: "photos", images})]}))).toEqual([]);
  });

  it("names the tile path when a tile's https host is not in imageHosts", () => {
    const images = [
      {alt: "Lamb", src: "file:lamb"},
      {alt: "Potatoes", src: "https://images.example.com/potatoes.jpg"},
      {alt: "Carrots", src: "https://evil.example.net/carrots.jpg"},
    ];
    const doc = documentWith({blocks: [{type: "divider"}, gallery({images})]});
    expect(codesAndPaths(doc)).toEqual([
      {code: "IMAGE_HOST_NOT_ALLOWED", path: "blocks[1].images[1].src"},
      {code: "IMAGE_HOST_NOT_ALLOWED", path: "blocks[1].images[2].src"},
    ]);
    expect(codesAndPaths(doc, {imageHosts: ["images.example.com"]})).toEqual([
      {code: "IMAGE_HOST_NOT_ALLOWED", path: "blocks[1].images[2].src"},
    ]);
    expect(codesAndPaths(doc, {imageHosts: ["images.example.com", "EVIL.example.net"]})).toEqual(
      []
    );
  });

  it("applies the image src rules to tiles inside a card", () => {
    const images = [
      {alt: "Lamb", src: "http://images.example.com/lamb.jpg"},
      {alt: "Potatoes", src: "file:"},
    ];
    const doc = documentWith({blocks: [{children: [gallery({images})], type: "card"}]});
    expect(codesAndPaths(doc, {imageHosts: ["images.example.com"]})).toEqual([
      {code: "IMAGE_HOST_NOT_ALLOWED", path: "blocks[0].children[0].images[0].src"},
      {code: "IMAGE_HOST_NOT_ALLOWED", path: "blocks[0].children[0].images[1].src"},
    ]);
  });

  it("caps the tile count, alt, and caption with closed codes", () => {
    expect(codesAndPaths(documentWith({blocks: [gallery({images: galleryImages(2)})]}))).toEqual(
      []
    );
    expect(codesAndPaths(documentWith({blocks: [gallery({images: galleryImages(6)})]}))).toEqual(
      []
    );
    expect(codesAndPaths(documentWith({blocks: [gallery({images: galleryImages(1)})]}))).toEqual([
      {code: "TOO_FEW", path: "blocks[0].images"},
    ]);
    expect(codesAndPaths(documentWith({blocks: [gallery({images: galleryImages(7)})]}))).toEqual([
      {code: "TOO_MANY", path: "blocks[0].images"},
    ]);
    const tileWith = (fields: Record<string, unknown>): Record<string, unknown> =>
      gallery({
        images: [
          {alt: "Lamb", src: "file:lamb", ...fields},
          {alt: "Pots", src: "file:p"},
        ],
      });
    expect(
      codesAndPaths(
        documentWith({blocks: [tileWith({alt: "a".repeat(200), caption: "c".repeat(120)})]})
      )
    ).toEqual([]);
    expect(codesAndPaths(documentWith({blocks: [tileWith({alt: "a".repeat(201)})]}))).toEqual([
      {code: "TOO_LONG", path: "blocks[0].images[0].alt"},
    ]);
    expect(codesAndPaths(documentWith({blocks: [tileWith({caption: "c".repeat(121)})]}))).toEqual([
      {code: "TOO_LONG", path: "blocks[0].images[0].caption"},
    ]);
    expect(codesAndPaths(documentWith({blocks: [tileWith({caption: "   "})]}))).toEqual([
      {code: "TOO_SHORT", path: "blocks[0].images[0].caption"},
    ]);
    expect(codesAndPaths(documentWith({blocks: [tileWith({title: "Lamb"})]}))).toEqual([
      {code: "UNKNOWN_KEY", path: "blocks[0].images[0].title"},
    ]);
    expect(
      codesAndPaths(
        documentWith({blocks: [gallery({images: [{src: "file:a"}, {alt: "B", src: "file:b"}]})]})
      )
    ).toEqual([{code: "MISSING_REQUIRED", path: "blocks[0].images[0].alt"}]);
  });
});

const listItems = (count: number): Record<string, unknown>[] =>
  Array.from({length: count}, (_unused, index) => ({title: `Dish ${index}`}));

const list = (fields: Record<string, unknown> = {}): Record<string, unknown> => ({
  items: listItems(2),
  type: "list",
  ...fields,
});

describe("list lint", () => {
  it("accepts items with and without text, meta, and a data:image or file: image", () => {
    const items = [
      {
        image: {alt: "Roast lamb", src: "file:roast-lamb"},
        meta: "Main",
        text: "Rubbed with garlic.",
        title: "Roast lamb",
      },
      {image: {alt: "Potatoes", src: "data:image/png;base64,iVBORw0KGgo="}, title: "Potatoes"},
      {title: "Mint sauce"},
    ];
    expect(codesAndPaths(documentWith({blocks: [list({id: "menu", items})]}))).toEqual([]);
  });

  it("names the item image path when its https host is not in imageHosts", () => {
    const items = [
      {title: "Lamb"},
      {image: {alt: "Potatoes", src: "https://images.example.com/potatoes.jpg"}, title: "Pots"},
      {image: {alt: "Carrots", src: "https://evil.example.net/carrots.jpg"}, title: "Carrots"},
    ];
    const doc = documentWith({blocks: [{type: "divider"}, list({items})]});
    expect(codesAndPaths(doc)).toEqual([
      {code: "IMAGE_HOST_NOT_ALLOWED", path: "blocks[1].items[1].image.src"},
      {code: "IMAGE_HOST_NOT_ALLOWED", path: "blocks[1].items[2].image.src"},
    ]);
    expect(codesAndPaths(doc, {imageHosts: ["images.example.com"]})).toEqual([
      {code: "IMAGE_HOST_NOT_ALLOWED", path: "blocks[1].items[2].image.src"},
    ]);
    expect(codesAndPaths(doc, {imageHosts: ["images.example.com", "EVIL.example.net"]})).toEqual(
      []
    );
  });

  it("applies the image src rules to item images inside a card", () => {
    const items = [
      {image: {alt: "Lamb", src: "http://images.example.com/lamb.jpg"}, title: "Lamb"},
      {image: {alt: "Potatoes", src: "file:"}, title: "Potatoes"},
    ];
    const doc = documentWith({blocks: [{children: [list({items})], type: "card"}]});
    expect(codesAndPaths(doc, {imageHosts: ["images.example.com"]})).toEqual([
      {code: "IMAGE_HOST_NOT_ALLOWED", path: "blocks[0].children[0].items[0].image.src"},
      {code: "IMAGE_HOST_NOT_ALLOWED", path: "blocks[0].children[0].items[1].image.src"},
    ]);
  });

  it("caps the item count and field lengths with closed codes", () => {
    expect(codesAndPaths(documentWith({blocks: [list({items: listItems(1)})]}))).toEqual([]);
    expect(codesAndPaths(documentWith({blocks: [list({items: listItems(12)})]}))).toEqual([]);
    expect(codesAndPaths(documentWith({blocks: [list({items: []})]}))).toEqual([
      {code: "TOO_FEW", path: "blocks[0].items"},
    ]);
    expect(codesAndPaths(documentWith({blocks: [list({items: listItems(13)})]}))).toEqual([
      {code: "TOO_MANY", path: "blocks[0].items"},
    ]);
    const itemWith = (fields: Record<string, unknown>): Record<string, unknown> =>
      list({items: [{title: "Lamb", ...fields}]});
    expect(
      codesAndPaths(
        documentWith({
          blocks: [
            itemWith({
              image: {alt: "a".repeat(200), src: "file:lamb"},
              meta: "m".repeat(40),
              text: "t".repeat(500),
              title: "T".repeat(120),
            }),
          ],
        })
      )
    ).toEqual([]);
    expect(codesAndPaths(documentWith({blocks: [itemWith({title: "T".repeat(121)})]}))).toEqual([
      {code: "TOO_LONG", path: "blocks[0].items[0].title"},
    ]);
    expect(codesAndPaths(documentWith({blocks: [itemWith({text: "t".repeat(501)})]}))).toEqual([
      {code: "TOO_LONG", path: "blocks[0].items[0].text"},
    ]);
    expect(codesAndPaths(documentWith({blocks: [itemWith({meta: "m".repeat(41)})]}))).toEqual([
      {code: "TOO_LONG", path: "blocks[0].items[0].meta"},
    ]);
    expect(
      codesAndPaths(
        documentWith({blocks: [itemWith({image: {alt: "a".repeat(201), src: "file:lamb"}})]})
      )
    ).toEqual([{code: "TOO_LONG", path: "blocks[0].items[0].image.alt"}]);
    expect(codesAndPaths(documentWith({blocks: [itemWith({text: "   "})]}))).toEqual([
      {code: "TOO_SHORT", path: "blocks[0].items[0].text"},
    ]);
    expect(codesAndPaths(documentWith({blocks: [itemWith({id: "lamb"})]}))).toEqual([
      {code: "UNKNOWN_KEY", path: "blocks[0].items[0].id"},
    ]);
    expect(
      codesAndPaths(
        documentWith({blocks: [itemWith({image: {alt: "Lamb", caption: "x", src: "file:a"}})]})
      )
    ).toEqual([{code: "UNKNOWN_KEY", path: "blocks[0].items[0].image.caption"}]);
    expect(codesAndPaths(documentWith({blocks: [itemWith({image: {src: "file:a"}})]}))).toEqual([
      {code: "MISSING_REQUIRED", path: "blocks[0].items[0].image.alt"},
    ]);
  });
});

const copyButton = (action: Record<string, unknown>): Record<string, unknown> => ({
  elements: [{action, id: "copy_it", text: "Copy", type: "button"}],
  id: "copy_actions",
  type: "actions",
});

const COPY_TARGETS: Record<string, Record<string, unknown>> = {
  checklist: {id: "target", items: [{id: "oven", text: "Preheat the oven"}], type: "checklist"},
  list: {id: "target", items: [{title: "Mint sauce"}], type: "list"},
  stepper: {
    callback: {name: "scaleStepper"},
    id: "target",
    label: "Number of people",
    max: 20,
    min: 1,
    type: "stepper",
    value: 5,
  },
  table: {data: "signups", id: "target", type: "table"},
  text: {id: "target", markdown: "**Shopping list**", type: "text"},
};

describe("copy action lint", () => {
  it("accepts copy text, or a target naming a stepper, checklist, list, table, or text block", () => {
    expect(
      codesAndPaths(documentWith({blocks: [copyButton({kind: "copy", text: "2 kg lamb"})]}))
    ).toEqual([]);
    for (const [type, target] of Object.entries(COPY_TARGETS)) {
      const datasets = type === "table" ? {signups: inline} : undefined;
      const before = documentWith({
        blocks: [copyButton({kind: "copy", target: "target"}), target],
        datasets,
      });
      const after = documentWith({
        blocks: [target, copyButton({kind: "copy", target: "target"})],
        datasets,
      });
      const inCard = documentWith({
        blocks: [{children: [target], type: "card"}, copyButton({kind: "copy", target: "target"})],
        datasets,
      });
      expect({result: codesAndPaths(before), type}).toEqual({result: [], type});
      expect({result: codesAndPaths(after), type}).toEqual({result: [], type});
      expect({result: codesAndPaths(inCard), type}).toEqual({result: [], type});
    }
  });

  it("requires exactly one of text or target, as an open action does", () => {
    expect(codesAndPaths(documentWith({blocks: [copyButton({kind: "copy"})]}))).toEqual([
      {code: "MISSING_REQUIRED", path: "blocks[0].elements[0].action"},
    ]);
    expect(
      codesAndPaths(
        documentWith({
          blocks: [COPY_TARGETS.text, copyButton({kind: "copy", target: "target", text: "Hi"})],
        })
      )
    ).toEqual([{code: "MISSING_REQUIRED", path: "blocks[1].elements[0].action"}]);
  });

  it("rejects a target that names another block type or no block", () => {
    const heading = {id: "target", text: "Menu", type: "heading"};
    expect(
      codesAndPaths(documentWith({blocks: [heading, copyButton({kind: "copy", target: "target"})]}))
    ).toEqual([{code: "COPY_TARGET_INVALID", path: "blocks[1].elements[0].action.target"}]);
    expect(
      codesAndPaths(documentWith({blocks: [copyButton({kind: "copy", target: "missing"})]}))
    ).toEqual([{code: "COPY_TARGET_INVALID", path: "blocks[0].elements[0].action.target"}]);
    // An action element id is not a block, so a copy button cannot target its own actions block's buttons.
    expect(
      codesAndPaths(documentWith({blocks: [copyButton({kind: "copy", target: "copy_it"})]}))
    ).toEqual([{code: "COPY_TARGET_INVALID", path: "blocks[0].elements[0].action.target"}]);
  });

  it("caps copy text from BLOCK_LIMITS and never checks it against hostActions", () => {
    const withText = (text: string): Record<string, unknown> =>
      documentWith({blocks: [copyButton({kind: "copy", text})]});
    expect(codesAndPaths(withText("a".repeat(4_000)), {hostActions: []})).toEqual([]);
    expect(codesAndPaths(withText("a".repeat(4_001)))).toEqual([
      {code: "TOO_LONG", path: "blocks[0].elements[0].action.text"},
    ]);
    expect(codesAndPaths(withText("   "))).toEqual([
      {code: "TOO_SHORT", path: "blocks[0].elements[0].action.text"},
    ]);
    expect(
      codesAndPaths(documentWith({blocks: [copyButton({kind: "copy", name: "x", text: "Hi"})]}))
    ).toEqual([{code: "UNKNOWN_KEY", path: "blocks[0].elements[0].action.name"}]);
  });
});
