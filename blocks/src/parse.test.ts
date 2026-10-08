import {describe, expect, it} from "bun:test";
import {readdirSync, readFileSync} from "node:fs";
import {join} from "node:path";

import {parseBlocks} from "./parse";
import {wrapAsTextDocument} from "./schema";
import {validateBlocks} from "./validate";

const fixturesDir = join(import.meta.dir, "fixtures");

const expectedInvalid: Record<string, {code: string; path: string}[]> = {
  "checklist-duplicate-item.yaml": [{code: "DUPLICATE_ID", path: "blocks[0].items[1].id"}],
  "checklist-item-id-too-long.yaml": [{code: "TOO_LONG", path: "blocks[0].items[0].id"}],
  "checklist-reserved-id.yaml": [{code: "DUPLICATE_ID", path: "blocks[1].elements[0].id"}],
  "column-not-found.yaml": [{code: "COLUMN_NOT_FOUND", path: "blocks[0].x"}],
  "column-type.yaml": [{code: "COLUMN_TYPE_MISMATCH", path: "blocks[0].y"}],
  "dataset-not-found.yaml": [{code: "DATASET_NOT_FOUND", path: "blocks[0].data"}],
  "dataset-too-large.yaml": [{code: "DATASET_TOO_LARGE", path: "datasets.signups.columns"}],
  "depth-exceeded.yaml": [{code: "DEPTH_EXCEEDED", path: "blocks[0].children[0]"}],
  "duplicate-id.yaml": [{code: "DUPLICATE_ID", path: "blocks[1].id"}],
  "invalid-enum.yaml": [{code: "INVALID_ENUM", path: "blocks[0].size"}],
  "key-order.yaml": [{code: "KEY_ORDER", path: "blocks"}],
  "missing-required.yaml": [{code: "MISSING_REQUIRED", path: "blocks[0].markdown"}],
  "not-a-document.txt": [{code: "NOT_A_DOCUMENT", path: ""}],
  "row-arity.yaml": [{code: "ROW_ARITY_MISMATCH", path: "datasets.signups.rows[0]"}],
  "select-target.yaml": [
    {code: "SELECT_TARGET_INVALID", path: "blocks[0].elements[0].action.target"},
  ],
  "stepper-decimals.yaml": [{code: "OUT_OF_RANGE", path: "blocks[0].items[0].decimals"}],
  "stepper-out-of-range.yaml": [{code: "OUT_OF_RANGE", path: "blocks[0].value"}],
  "stepper-reserved-id.yaml": [{code: "DUPLICATE_ID", path: "blocks[1].elements[0].id"}],
  "table-too-wide.yaml": [{code: "TABLE_TOO_WIDE", path: "blocks[0].columns"}],
  "too-many-points.yaml": [{code: "TOO_MANY_POINTS", path: "datasets.signups.limit"}],
  "unknown-key.yaml": [{code: "UNKNOWN_KEY", path: "blocks[0].color"}],
  "unsupported-version.yaml": [{code: "UNSUPPORTED_VERSION", path: "v"}],
  "yaml-anchor.yaml": [{code: "YAML_FEATURE_DISALLOWED", path: ""}],
};

describe("parseBlocks", () => {
  it("parses a prose-only document and validates it with zero errors", () => {
    const proseDocument = readFileSync(join(fixturesDir, "valid", "prose.yaml"), "utf8");
    const parsed = parseBlocks(proseDocument);
    expect(parsed.ok).toBe(true);
    if (!parsed.ok) {
      return;
    }
    const validated = validateBlocks(parsed.value);
    expect(validated.ok).toBe(true);
    if (!validated.ok) {
      return;
    }
    expect(validated.doc).toEqual({
      blocks: [
        {
          markdown: "I could not find any signups for that range.",
          type: "text",
        },
      ],
      v: 1,
    });
    expect(wrapAsTextDocument("Hello")).toEqual({
      blocks: [{markdown: "Hello", type: "text"}],
      v: 1,
    });
  });

  it("strips a surrounding fence and accepts JSON", () => {
    for (const fence of ["yaml", "yml", "json", "YAML"]) {
      const parsed = parseBlocks(`\`\`\`${fence}\nv: 1\nblocks:\n  - type: divider\n\`\`\``);
      expect(parsed.ok).toBe(true);
      if (!parsed.ok) {
        return;
      }
      expect(validateBlocks(parsed.value).ok).toBe(true);
    }

    const json = parseBlocks('{"v":1,"blocks":[{"type":"heading","text":"Hi"}]}');
    expect(json.ok).toBe(true);
    if (!json.ok) {
      return;
    }
    const validated = validateBlocks(json.value);
    expect(validated.ok).toBe(true);
    if (!validated.ok) {
      return;
    }
    expect(validated.doc.blocks).toEqual([{text: "Hi", type: "heading"}]);
  });
});

describe("block fixtures", () => {
  it("validates every valid fixture with zero errors", () => {
    const dir = join(fixturesDir, "valid");
    const names = readdirSync(dir).filter((name) => name.endsWith(".yaml"));
    expect(names.length).toBeGreaterThan(0);
    for (const name of names) {
      const parsed = parseBlocks(readFileSync(join(dir, name), "utf8"));
      expect(parsed.ok).toBe(true);
      if (!parsed.ok) {
        continue;
      }
      const validated = validateBlocks(parsed.value);
      expect(validated.ok).toBe(true);
    }
    const layout = parseBlocks(readFileSync(join(dir, "layout.yaml"), "utf8"));
    expect(layout.ok).toBe(true);
    if (!layout.ok) {
      return;
    }
    const validated = validateBlocks(layout.value);
    expect(validated.ok).toBe(true);
    if (!validated.ok) {
      return;
    }
    expect(validated.doc).toEqual({
      blocks: [
        {size: "lg", text: "Signups this quarter", type: "heading"},
        {markdown: "Signups grew **12%** quarter over quarter.", type: "text"},
        {
          children: [
            {delta: "+12%", label: "Total", trend: "up", type: "metric", value: "403"},
            {label: "Best month", type: "metric", value: "Feb"},
          ],
          type: "columns",
        },
        {
          children: [
            {status: "info", text: "Draft", type: "badge"},
            {text: "February was the strongest month.", type: "context"},
            {type: "divider"},
          ],
          title: "Notes",
          type: "card",
        },
      ],
      v: 1,
    });
  });

  it("fails each invalid fixture with the expected path and code", () => {
    const dir = join(fixturesDir, "invalid");
    const names = readdirSync(dir);
    expect(names.sort()).toEqual(Object.keys(expectedInvalid).sort());
    for (const name of names) {
      const parsed = parseBlocks(readFileSync(join(dir, name), "utf8"));
      const errors = parsed.ok
        ? validateBlocks(parsed.value).ok
          ? []
          : validateBlocks(parsed.value).errors
        : parsed.errors;
      expect(errors.map((item) => ({code: item.code, path: item.path}))).toEqual(
        expectedInvalid[name]
      );
    }
  });
});

const orderedDocument = (blocks: unknown[]): Record<string, unknown> => {
  const doc: Record<string, unknown> = {};
  doc.v = 1;
  doc.blocks = blocks;
  return doc;
};

describe("validateBlocks limits", () => {
  it("accepts 50 blocks and rejects 51, including nested blocks", () => {
    const fifty = Array.from({length: 50}, () => ({type: "divider"}));
    expect(validateBlocks(orderedDocument(fifty)).ok).toBe(true);

    const fiftyOne = Array.from({length: 51}, () => ({type: "divider"}));
    const flat = validateBlocks(orderedDocument(fiftyOne));
    expect(flat.ok).toBe(false);
    if (flat.ok) {
      return;
    }
    expect(flat.errors.map((item) => ({code: item.code, path: item.path}))).toEqual([
      {code: "TOO_MANY_BLOCKS", path: "blocks"},
    ]);

    const children = Array.from({length: 50}, (_unused, index) => ({
      text: `note ${index}`,
      type: "context",
    }));
    const nested = validateBlocks(orderedDocument([{children, type: "card"}]));
    expect(nested.ok).toBe(false);
    if (nested.ok) {
      return;
    }
    expect(nested.errors.map((item) => ({code: item.code, path: item.path}))).toEqual([
      {code: "TOO_MANY_BLOCKS", path: "blocks"},
    ]);
  });

  it("rejects empty input, a second document, and a mapping without v", () => {
    expect(parseBlocks("").errors).toEqual([
      expect.objectContaining({code: "NOT_A_DOCUMENT", path: ""}),
    ]);
    expect(parseBlocks("v: 1\n---\nv: 1\n").errors).toEqual([
      expect.objectContaining({code: "NOT_A_DOCUMENT", path: ""}),
    ]);
    expect(parseBlocks("blocks:\n  - type: divider\n").errors).toEqual([
      expect.objectContaining({code: "NOT_A_DOCUMENT", path: ""}),
    ]);
  });

  it("rejects a custom YAML tag", () => {
    const parsed = parseBlocks("v: 1\nblocks: !foo []\n");
    expect(parsed.ok).toBe(false);
    if (parsed.ok) {
      return;
    }
    expect(parsed.errors.map((item) => item.code)).toEqual(["YAML_FEATURE_DISALLOWED"]);
  });

  it("describes a ref id and a zero limit with the rules those fields use", () => {
    const refDocument: Record<string, unknown> = {v: 1};
    refDocument.datasets = {signups: {id: "bad.id", source: "ref"}};
    refDocument.blocks = [{type: "divider"}];
    const refId = validateBlocks(refDocument);
    expect(refId.ok).toBe(false);
    if (!refId.ok) {
      const idError = refId.errors.find((error) => error.path === "datasets.signups.id");
      expect(idError?.code).toBe("INVALID_FORMAT");
      expect(idError?.fix).toContain("hyphens");
    }

    const limitDocument: Record<string, unknown> = {v: 1};
    limitDocument.datasets = {signups: {id: "ds_signups", limit: 0, source: "ref"}};
    limitDocument.blocks = [{type: "divider"}];
    const limit = validateBlocks(limitDocument);
    expect(limit.ok).toBe(false);
    if (!limit.ok) {
      const limitError = limit.errors.find((error) => error.path === "datasets.signups.limit");
      expect(limitError?.code).toBe("INVALID_TYPE");
      expect(limitError?.fix).toContain("integer");
    }
  });

  it("maps type, size, format, and union failures onto closed codes", () => {
    const long = "x".repeat(201);
    const cases: {code: string; doc: Record<string, unknown>}[] = [
      {
        code: "INVALID_TYPE",
        doc: {blocks: [{size: "md", text: 1, type: "heading"}], v: 1},
      },
      {
        code: "TOO_MANY",
        doc: {
          blocks: [{children: Array.from({length: 5}, () => ({type: "divider"})), type: "columns"}],
          v: 1,
        },
      },
      {
        code: "TOO_LONG",
        doc: {blocks: [{text: long, type: "heading"}], v: 1},
      },
      {
        code: "TOO_FEW",
        doc: {blocks: [{children: [{type: "divider"}], type: "columns"}], v: 1},
      },
      {
        code: "TOO_SHORT",
        doc: {blocks: [{text: "", type: "heading"}], v: 1},
      },
      {
        code: "TOO_SHORT",
        doc: {blocks: [{text: "   ", type: "heading"}], v: 1},
      },
      {
        code: "INVALID_FORMAT",
        doc: {blocks: [{id: "Bad", text: "Hi", type: "heading"}], v: 1},
      },
      {
        code: "INVALID_ENUM",
        doc: {blocks: [{type: "nope"}], v: 1},
      },
    ];
    for (const {code, doc} of cases) {
      const validated = validateBlocks(doc);
      expect(validated.ok).toBe(false);
      if (validated.ok) {
        return;
      }
      expect(validated.errors.some((error) => error.code === code)).toBe(true);
    }
  });
});
