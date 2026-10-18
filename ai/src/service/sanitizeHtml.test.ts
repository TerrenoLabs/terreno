import {describe, expect, it} from "bun:test";
import {parseBlocks, validateBlocks} from "@terreno/blocks";

import {sanitizeBlocksText, sanitizeHtmlFragment} from "./sanitizeHtml";

describe("sanitizeHtmlFragment", () => {
  it("strips scripts, handlers, frames, forms, and links", () => {
    const cleaned = sanitizeHtmlFragment(
      `<h1 onclick="alert(1)">Invoice</h1><script>alert(1)</script><a href="https://evil.test">pay</a><form action="https://evil.test"><input></form><iframe src="https://evil.test"></iframe><frame src="https://evil.test"></frame><object data="https://evil.test"></object><embed src="https://evil.test"><meta charset="utf-8"><base href="https://evil.test"><link rel="stylesheet" href="https://evil.test/a.css"><img src="https://evil.test/pixel.png" alt="pixel"><img src="javascript:alert(1)" alt="x"><img src="//evil.test/x.png" alt="y"><img src="data:image/png;base64,aaaa" alt="logo" onerror="alert(1)">`
    );

    expect(cleaned).toBe(
      '<h1>Invoice</h1><a>pay</a><img alt="pixel" /><img alt="x" /><img alt="y" /><img alt="logo" src="data:image/png;base64,aaaa" />'
    );
  });
});

describe("sanitizeBlocksText", () => {
  it("replaces a document whose html changed and leaves a clean document", () => {
    const block: Record<string, string> = {};
    block.type = "html";
    block.html = "<p>Hi</p><script>alert(1)</script>";
    const document: Record<string, unknown> = {};
    document.v = 1;
    document.blocks = [block];
    const dirty = JSON.stringify(document);
    const sanitized = sanitizeBlocksText(dirty);
    const parsed = parseBlocks(sanitized.text);
    const checked = parsed.ok ? validateBlocks(parsed.value, {allowHtml: true}) : undefined;

    expect(sanitized.changed).toBe(true);
    expect(sanitized.text).not.toContain("<script");
    expect(checked?.ok).toBe(true);

    const clean = sanitizeBlocksText(`v: 1\nblocks:\n  - type: text\n    markdown: Hello\n`);
    expect(clean.changed).toBe(false);
  });

  it("sanitizes html nested in a card", () => {
    const html: Record<string, string> = {};
    html.type = "html";
    html.html = "<p>Hi</p><script>alert(1)</script>";
    const card: Record<string, unknown> = {};
    card.type = "card";
    card.children = [html];
    const document: Record<string, unknown> = {};
    document.v = 1;
    document.blocks = [card];

    const sanitized = sanitizeBlocksText(JSON.stringify(document));
    const parsed = parseBlocks(sanitized.text);
    const checked = parsed.ok ? validateBlocks(parsed.value, {allowHtml: true}) : undefined;
    const nested =
      checked?.ok === true && checked.doc.blocks[0]?.type === "card"
        ? checked.doc.blocks[0].children[0]
        : undefined;

    expect(sanitized.changed).toBe(true);
    expect(nested).toMatchObject({html: "<p>Hi</p>", type: "html"});
  });
});
