import {describe, expect, it} from "bun:test";

import {Categories} from "../emojiCategories";
import {
  AIRequestExplorer,
  AskCard,
  DraggableList,
  EmojiSelector,
  heavyOptionalModuleFactories,
  MarkdownEditor,
} from "./heavyOptionalExports";

describe("heavyOptionalExports", () => {
  it("exposes lazy placeholders for heavy optional widgets", () => {
    expect(AIRequestExplorer).toBeTruthy();
    expect(AskCard).toBeTruthy();
    expect(DraggableList).toBeTruthy();
    expect(EmojiSelector).toBeTruthy();
    expect(MarkdownEditor).toBeTruthy();
  });

  it("keeps EmojiSelector defaultProps.category referentially equal to Categories.all", () => {
    expect(
      (EmojiSelector as unknown as {defaultProps?: {category?: typeof Categories.all}}).defaultProps
        ?.category
    ).toBe(Categories.all);
  });

  it("resolves each lazy module factory without rendering", async () => {
    for (const factory of Object.values(heavyOptionalModuleFactories)) {
      const moduleNamespace = await factory();
      expect(moduleNamespace).toBeTruthy();
    }
  });
});
