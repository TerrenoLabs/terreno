import {describe, expect, it} from "bun:test";

import {BLOCK_LIMITS} from "./limits";
import {blocksPromptSection} from "./prompt";
import {validateBlocks} from "./validate";

const htmlDocument = (html: string): unknown => {
  const block: Record<string, unknown> = {};
  block.type = "html";
  block.title = "Invoice preview";
  block.height = "md";
  block.html = html;
  const doc: Record<string, unknown> = {};
  doc.v = 1;
  doc.blocks = [block];
  return doc;
};

describe("html blocks", () => {
  it("rejects html unless the host turns it on", () => {
    const result = validateBlocks(htmlDocument("<p>Invoice</p>"));

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.errors.map((error) => error.code)).toContain("HTML_DISABLED");
    }
  });

  it("accepts a short html block when HTML is on", () => {
    const result = validateBlocks(htmlDocument("<h1>Invoice #1042</h1>"), {allowHtml: true});

    expect(result.ok).toBe(true);
  });

  it("rejects html over 100,000 bytes", () => {
    const html = `<p>${"a".repeat(BLOCK_LIMITS.htmlMaxBytes)}</p>`;
    const result = validateBlocks(htmlDocument(html), {allowHtml: true});

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.errors.map((error) => error.code)).toContain("HTML_TOO_LARGE");
    }
  });

  it("mentions html in the prompt only when it is allowed", () => {
    expect(blocksPromptSection()).toContain("Do not emit type html");
    expect(blocksPromptSection({allowHtml: true})).toContain("card, html");
    expect(blocksPromptSection({allowHtml: true})).toContain(String(BLOCK_LIMITS.htmlMaxBytes));
  });
});
