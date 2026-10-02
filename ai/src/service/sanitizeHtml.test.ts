import {describe, expect, it} from "bun:test";
import {parseBlocks, validateBlocks} from "@terreno/blocks";

import {sanitizeBlocksText, sanitizeHtmlFragment} from "./sanitizeHtml";

describe("sanitizeHtmlFragment", () => {
  it("strips scripts, handlers, frames, forms, and links", () => {
    const cleaned = sanitizeHtmlFragment(
      `<h1 onclick="alert(1)">Invoice</h1><script>alert(1)</script><a href="https://evil.test">pay</a><form action="https://evil.test"><input></form><iframe src="https://evil.test"></iframe><meta charset="utf-8"><base href="https://evil.test"><link rel="stylesheet" href="https://evil.test/a.css"><img src="https://evil.test/pixel.png" alt="pixel"><img src="data:image/png;base64,aaaa" alt="logo">`
    );

    expect(cleaned).not.toContain("<script");
    expect(cleaned).not.toContain("onclick");
    expect(cleaned).not.toContain("href");
    expect(cleaned).not.toContain("<form");
    expect(cleaned).not.toContain("<iframe");
    expect(cleaned).not.toContain("<meta");
    expect(cleaned).not.toContain("<base");
    expect(cleaned).not.toContain("<link");
    expect(cleaned).not.toContain("https://evil.test");
    expect(cleaned).toContain("pay");
    expect(cleaned).toContain("data:image/png;base64,aaaa");
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
});
