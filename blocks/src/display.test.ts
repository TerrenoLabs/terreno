import {describe, expect, it} from "bun:test";

import {blocksPromptSection} from "./prompt";
import {validateBlocks} from "./validate";

const documentWith = (block: Record<string, unknown>): unknown => {
  const doc: Record<string, unknown> = {};
  doc.v = 1;
  doc.blocks = [block];
  return doc;
};

const image = (src: string): unknown => {
  const block: Record<string, unknown> = {};
  block.type = "image";
  block.alt = "Receipt";
  block.src = src;
  return documentWith(block);
};

describe("callout, image, and details", () => {
  it("accepts a callout, a details block, a data image, and a file ref", () => {
    const callout: Record<string, unknown> = {};
    callout.type = "callout";
    callout.status = "warning";
    callout.text = "Seats renew on Friday.";
    const details: Record<string, unknown> = {};
    details.type = "details";
    details.title = "Invoice notes";
    details.text = "Twelve seats, billed monthly.";

    expect(validateBlocks(documentWith(callout)).ok).toBe(true);
    expect(validateBlocks(documentWith(details)).ok).toBe(true);
    expect(validateBlocks(image("data:image/png;base64,aaaa")).ok).toBe(true);
    expect(validateBlocks(image("file:6710c2a4f1")).ok).toBe(true);
  });

  it("rejects an image without alt", () => {
    const block: Record<string, unknown> = {};
    block.type = "image";
    block.src = "data:image/png;base64,aaaa";
    const result = validateBlocks(documentWith(block));

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.errors.map((error) => error.code)).toContain("MISSING_REQUIRED");
    }
  });

  it("rejects an https image whose host is not listed and accepts a listed host", () => {
    const blocked = validateBlocks(image("https://evil.test/pixel.png"));
    const allowed = validateBlocks(image("https://cdn.example.com/pixel.png"), {
      imageHosts: ["cdn.example.com"],
    });

    expect(blocked.ok).toBe(false);
    if (!blocked.ok) {
      expect(blocked.errors.map((error) => error.code)).toContain("IMAGE_HOST_NOT_ALLOWED");
    }
    expect(allowed.ok).toBe(true);
  });

  it("tells the model which image hosts are allowed", () => {
    expect(blocksPromptSection()).toContain("Do not emit an https image src");
    expect(blocksPromptSection()).toContain("callout");
    expect(blocksPromptSection({imageHosts: ["cdn.example.com"]})).toContain("cdn.example.com");
  });
});
