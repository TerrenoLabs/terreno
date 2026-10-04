import {describe, it} from "bun:test";
import {assert} from "chai";

import {
  flattenValidationPath,
  parseDatasetCsvImport,
  parseDatasetJsonImport,
} from "./datasetImport";

describe("datasetImport", () => {
  it("rejects malformed JSON payloads and rows", () => {
    assert.throws(() => parseDatasetJsonImport({rows: []}), /array/);
    assert.throws(() => parseDatasetJsonImport([null]), /row 1/);
    assert.throws(
      () => parseDatasetJsonImport([{input: undefined}]),
      /structured import row requires input/
    );
  });

  it("parses structured JSON rows and bare objects with reserved fields", () => {
    const structured = parseDatasetJsonImport([
      {
        expectedOutput: {answer: 4},
        input: {text: "hello"},
        metadata: {source: "seed"},
        outcomeClass: "tp",
        proofread: true,
        tags: ["gold"],
      },
    ]);
    assert.deepEqual(structured[0], {
      expectedOutput: {answer: 4},
      input: {text: "hello"},
      metadata: {source: "seed"},
      outcomeClass: "tp",
      proofread: true,
      tags: ["gold"],
    });

    const bare = parseDatasetJsonImport([
      {
        expectedOutput: "yes",
        metadata: ["bad"],
        outcomeClass: "bad",
        proofread: "true",
        tags: [1, "gold"],
        text: "hello",
      },
    ]);
    assert.deepEqual(bare[0]?.input, {text: "hello"});
    assert.equal(bare[0]?.expectedOutput, "yes");
    assert.isUndefined(bare[0]?.metadata);
    assert.isUndefined(bare[0]?.outcomeClass);
    assert.isUndefined(bare[0]?.proofread);
    assert.deepEqual(bare[0]?.tags, ["gold"]);
  });

  it("coerces CSV cells, nested columns, and reserved fields", () => {
    const csv = [
      "input.text,input.count,expectedOutput.answer,proofread,tags,outcomeClass,plain",
      '"hello",42,"{""ok"":true}",yes,"gold|edge",tp,ignored',
    ].join("\n");
    const rows = parseDatasetCsvImport(csv);
    assert.deepEqual(rows[0]?.input, {count: 42, plain: "ignored", text: "hello"});
    assert.deepEqual(rows[0]?.expectedOutput, {answer: {ok: true}});
    assert.equal(rows[0]?.proofread, true);
    assert.deepEqual(rows[0]?.tags, ["gold", "edge"]);
    assert.equal(rows[0]?.outcomeClass, "tp");
  });

  it("handles boolean, numeric, and invalid JSON CSV cells", () => {
    const rows = parseDatasetCsvImport(
      ["input.flag,input.badJson,input.empty", "false,{not-json:},"].join("\n")
    );
    assert.deepEqual(rows[0]?.input, {
      badJson: "{not-json:}",
      empty: "",
      flag: false,
    });
  });

  it("parses JSON values from plain input and expectedOutput CSV columns", () => {
    const rows = parseDatasetCsvImport(
      ["input,expectedOutput", '"{""text"":""hello""}","{""summary"":""short""}"'].join("\n")
    );

    assert.deepEqual(rows[0]?.input, {text: "hello"});
    assert.deepEqual(rows[0]?.expectedOutput, {summary: "short"});
  });

  it("normalizes validation paths", () => {
    assert.equal(flattenValidationPath(""), "/");
    assert.equal(flattenValidationPath("text"), "/text");
  });
});
