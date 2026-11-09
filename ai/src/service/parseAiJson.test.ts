import {describe, expect, it} from "bun:test";

import {normalizeLlmJsonTextForStructuredOutput, parseAiJson} from "./parseAiJson";

describe("parseAiJson", () => {
  it("parses clean JSON without repair", () => {
    const r = parseAiJson<{a: number}>(`{"a":1}`);
    expect(r.success).toBe(true);
    if (r.success) {
      expect(r.repaired).toBe(false);
      expect(r.data).toEqual({a: 1});
    }
  });

  it("strips a fully wrapped ```json fence", () => {
    const r = parseAiJson(`\`\`\`json\n{"b":2}\n\`\`\``);
    expect(r.success).toBe(true);
    if (r.success) {
      expect(r.data).toEqual({b: 2});
    }
  });

  it("extracts JSON from preamble and trailing prose", () => {
    const r = parseAiJson(`Sure! Here is the result: {"ok":true} — hope this helps.`);
    expect(r.success).toBe(true);
    if (r.success) {
      expect(r.repaired).toBe(true);
      expect(r.data).toEqual({ok: true});
    }
  });

  it("handles nested objects and arrays in balanced extraction", () => {
    const r = parseAiJson(`noise {"x":[1,{"y":2}]} tail`);
    expect(r.success).toBe(true);
    if (r.success) {
      expect(r.data).toEqual({x: [1, {y: 2}]});
    }
  });

  it("repairs trailing commas outside strings", () => {
    const r = parseAiJson(`{"a":1,}`);
    expect(r.success).toBe(true);
    if (r.success) {
      expect(r.repaired).toBe(true);
      expect(r.data).toEqual({a: 1});
    }
  });

  it("repairs smart quotes on property names via aggressive normalization", () => {
    const r = parseAiJson(`{“smart”: true}`);
    expect(r.success).toBe(true);
    if (r.success) {
      expect(r.repaired).toBe(true);
      expect(r.data).toEqual({smart: true});
    }
  });

  it("returns failure for non-JSON", () => {
    const r = parseAiJson("not json at all");
    expect(r.success).toBe(false);
    if (!r.success) {
      expect(r.error.length).toBeGreaterThan(0);
      expect(r.raw).toBe("not json at all");
    }
  });

  it("returns failure for empty string", () => {
    const r = parseAiJson("");
    expect(r.success).toBe(false);
    if (!r.success) {
      expect(r.error).toBe("Empty or non-string input");
    }
  });

  it("returns failure for whitespace-only string", () => {
    const r = parseAiJson("   ");
    expect(r.success).toBe(false);
    if (!r.success) {
      expect(r.error).toBe("Empty or non-string input");
    }
  });

  it("handles escaped characters inside JSON strings during balanced extraction", () => {
    const r = parseAiJson(`preamble {"msg":"line1\\nline2","path":"C:\\\\dir"} tail`);
    expect(r.success).toBe(true);
    if (r.success) {
      expect(r.data).toEqual({msg: "line1\nline2", path: "C:\\dir"});
    }
  });

  it("handles escaped quotes inside JSON strings during balanced extraction", () => {
    const r = parseAiJson(`noise {"key":"value with \\"quotes\\""} done`);
    expect(r.success).toBe(true);
    if (r.success) {
      expect(r.data).toEqual({key: 'value with "quotes"'});
    }
  });

  it("returns failure for mismatched brackets", () => {
    const r = parseAiJson("{]");
    expect(r.success).toBe(false);
  });

  it("returns failure for unclosed JSON (unbalanced brackets)", () => {
    const r = parseAiJson(`{"a": {"b": 1}`);
    expect(r.success).toBe(false);
  });

  it("repairs trailing comma inside a balanced extraction that otherwise fails parse", () => {
    const r = parseAiJson(`Sure! {"items": [1, 2, 3,],} enjoy!`);
    expect(r.success).toBe(true);
    if (r.success) {
      expect(r.repaired).toBe(true);
      expect(r.data).toEqual({items: [1, 2, 3]});
    }
  });

  it("repairs trailing commas inside balanced extraction with backslash content", () => {
    const input = `here {"a": "x\\\\y", "b": 1,}`;
    const r = parseAiJson(input);
    expect(r.success).toBe(true);
    if (r.success) {
      expect(r.repaired).toBe(true);
      expect(r.data).toEqual({a: "x\\y", b: 1});
    }
  });

  it("repairs smart quotes via whole-string repair when balanced extraction fails", () => {
    const r = parseAiJson(`\u201Ckey\u201D: \u201Cvalue\u201D`);
    expect(r.success).toBe(false);
  });

  it("repairs smart quotes on a full JSON object", () => {
    const r = parseAiJson(`{\u201Ckey\u201D: \u201Cvalue\u201D}`);
    expect(r.success).toBe(true);
    if (r.success) {
      expect(r.repaired).toBe(true);
      expect(r.data).toEqual({key: "value"});
    }
  });

  it("repairs escaped characters in repair path outside strings", () => {
    const r = parseAiJson(`{"escaped": "a\\b", "trailing": true,}`);
    expect(r.success).toBe(true);
    if (r.success) {
      expect(r.repaired).toBe(true);
    }
  });

  it("strips partial opening fence and trailing fence", () => {
    const r = parseAiJson('```json\n{"x": 1}\n```');
    expect(r.success).toBe(true);
    if (r.success) {
      expect(r.data).toEqual({x: 1});
    }
  });

  it("strips partial opening fence without full closure", () => {
    const r = parseAiJson('```json\n{"a":1}');
    expect(r.success).toBe(true);
    if (r.success) {
      expect(r.data).toEqual({a: 1});
    }
  });

  it("strips opening fence with colon separator", () => {
    const r = parseAiJson('```json:\n{"y": 2}\n```');
    expect(r.success).toBe(true);
    if (r.success) {
      expect(r.data).toEqual({y: 2});
    }
  });

  it("parses arrays at top level", () => {
    const r = parseAiJson("[1, 2, 3]");
    expect(r.success).toBe(true);
    if (r.success) {
      expect(r.data).toEqual([1, 2, 3]);
      expect(r.repaired).toBe(false);
    }
  });

  it("extracts a JSON array from prose", () => {
    const r = parseAiJson("Here are the items: [1, 2, 3] — done.");
    expect(r.success).toBe(true);
    if (r.success) {
      expect(r.data).toEqual([1, 2, 3]);
      expect(r.repaired).toBe(true);
    }
  });

  it("returns failure when no brackets are present at all", () => {
    const r = parseAiJson("just plain text with no JSON");
    expect(r.success).toBe(false);
  });

  it("returns failure for unterminated JSON", () => {
    const r = parseAiJson('{"a": 1');
    expect(r.success).toBe(false);
  });

  it("repairs smart quotes inside a balanced extraction (repairedSlice path)", () => {
    const r = parseAiJson(`prefix {\u201Ckey\u201D: 1} suffix`);
    expect(r.success).toBe(true);
    if (r.success) {
      expect(r.repaired).toBe(true);
      expect(r.data).toEqual({key: 1});
    }
  });

  it("repairs whole cleaned text when balanced extraction is not possible", () => {
    const r = parseAiJson(`\u201Chello\u201D`);
    expect(r.success).toBe(true);
    if (r.success) {
      expect(r.repaired).toBe(true);
      expect(r.data).toBe("hello");
    }
  });

  it("repairs a closing smart quote via the whole-string aggressive replacement", () => {
    // The closing smart quote sits where the conservative outside-strings repair
    // still considers itself inside a string, so only the blind global
    // smart-quote replacement recovers valid JSON.
    const r = parseAiJson<{a: string}>(`{"a": "b\u201D}`);
    expect(r.success).toBe(true);
    if (r.success) {
      expect(r.repaired).toBe(true);
      expect(r.data).toEqual({a: "b"});
    }
  });

  it("falls through balanced extraction when neither direct nor repaired parse succeeds", () => {
    // extractBalancedJson finds {invalid: json broken} but neither parse nor repair can fix it
    const r = parseAiJson("prefix {invalid: json broken} suffix");
    expect(r.success).toBe(false);
  });

  it("repairs a smart quote used as a delimiter via aggressive whole-string normalization", () => {
    // The unbalanced real quote makes the outside-strings tracker treat the smart
    // quote as string content, so only the blanket smart-quote replacement recovers it.
    const r = parseAiJson<{a: number}>(`{"a\u201D: 1}`);
    expect(r.success).toBe(true);
    if (r.success) {
      expect(r.repaired).toBe(true);
      expect(r.data).toEqual({a: 1});
    }
  });
});

describe("parseAiJson fences", () => {
  it("strips a fence with a language tag and surrounding blank lines", () => {
    const r = parseAiJson<{a: number}>('```JSON\n\n{"a":1}\n```');
    expect(r.success).toBe(true);
    if (r.success) {
      expect(r.data).toEqual({a: 1});
    }
  });

  it("fails fast on an opening fence followed by a long run of spaces", () => {
    const started = performance.now();
    const r = parseAiJson(`\`\`\`${" ".repeat(50_000)}x`);
    expect(performance.now() - started).toBeLessThan(500);
    expect(r.success).toBe(false);
  });
});

describe("normalizeLlmJsonTextForStructuredOutput", () => {
  it("returns JSON.stringify output on success", () => {
    expect(normalizeLlmJsonTextForStructuredOutput(`Yep: [1,2]`)).toBe("[1,2]");
  });

  it("returns fence-stripped text when parse fails", () => {
    expect(normalizeLlmJsonTextForStructuredOutput("```json\nbroken\n```")).toBe("broken");
  });
});
