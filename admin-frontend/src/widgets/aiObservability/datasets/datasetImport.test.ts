import {describe, expect, it} from "bun:test";
import {assert} from "chai";
import {buildCsvImportPayload, detectImportFormat, parseImportText} from "./datasetImport";

describe("datasetImport helpers", () => {
  it("builds JSON import payload from an array", () => {
    const payload = parseImportText('[{"expectedOutput":{"a":"ok"},"input":{"q":"hi"}}]', "json");
    assert.deepEqual(payload, {
      body: {rows: [{expectedOutput: {a: "ok"}, input: {q: "hi"}}]},
      formatLabel: "json",
    });
  });

  it("builds CSV import payload with format csv", () => {
    const payload = buildCsvImportPayload("input,expected\n{},{}");
    assert.equal(payload.formatLabel, "csv");
    assert.deepEqual(payload.body, {content: "input,expected\n{},{}", format: "csv"});
  });

  it("detects csv and json from filename and content", () => {
    expect(detectImportFormat("rows.csv", "a,b")).toBe("csv");
    expect(detectImportFormat("rows.json", '[{"input":{}}]')).toBe("json");
    expect(detectImportFormat("paste.txt", '[{"input":{}}]')).toBe("json");
    expect(detectImportFormat("paste.txt", "input,expected\n{},{}")).toBe("csv");
  });

  it("wraps a single json object as one row", () => {
    const payload = parseImportText('{"input":{"q":"hi"}}', "json");
    assert.deepEqual(payload.body, {rows: [{input: {q: "hi"}}]});
  });

  it("routes parseImportText through csv and json builders", () => {
    const csv = parseImportText("a,b", "csv");
    assert.equal(csv.formatLabel, "csv");
    const json = parseImportText('[{"input":{}}]', "json");
    assert.equal(json.formatLabel, "json");
  });
});
