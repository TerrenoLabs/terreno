import {describe, expect, it} from "bun:test";
import {resolve} from "node:path";

import {
  AIRequestExplorer,
  Button,
  ConsentNavigator,
  DashboardGrid,
  DraggableList,
  EmojiSelector,
  GPTChat,
  LineChart,
  MarkdownEditor,
  ProvisionalConsentSigner,
} from "@terreno/ui";
import {Box} from "@terreno/ui/Box";
import EmojiSelectorSubpath from "@terreno/ui/EmojiSelector";
import {GPTChat as GPTChatSubpath} from "@terreno/ui/GPTChat";
import {LineChart as LineChartSubpath} from "@terreno/ui/LineChart";
import {MarkdownView} from "@terreno/ui/MarkdownView";

import {measureImportGraph} from "./benchmarks/importGraph";
import {Categories} from "./emojiCategories";
import {EmojiSelector as LazyEmojiSelector} from "./lazyBoundaries/heavyOptionalExports";

const ROOT_IMPORT_PATHS = [
  "@terreno/ui",
  "@terreno/ui/Button",
  "@terreno/ui/Box",
  "@terreno/ui/dist/Button.js",
  "@terreno/ui/src/Button.tsx",
  "@terreno/ui/GPTChat",
  "@terreno/ui/EmojiSelector",
  "@terreno/ui/MarkdownView",
  "@terreno/ui/LineChart",
];

describe("root import compatibility", () => {
  it("keeps root Button export available", () => {
    expect(Button).toBeTruthy();
  });

  it("resolves public subpath imports", () => {
    expect(Box).toBeTruthy();
    expect(GPTChatSubpath).toBeTruthy();
    expect(EmojiSelectorSubpath).toBeTruthy();
    expect(MarkdownView).toBeTruthy();
    expect(LineChartSubpath).toBeTruthy();
    expect(DashboardGrid).toBeTruthy();
    expect(LineChart).toBeTruthy();
  });

  it("keeps chart implementations off the cold root graph", () => {
    const graph = measureImportGraph(resolve(import.meta.dir, "./index.tsx"));
    const modulePaths = graph.modulePaths.join("\n");

    expect(modulePaths.includes("/LineChart.tsx")).toBe(false);
    expect(modulePaths.includes("/BarChart.tsx")).toBe(false);
    expect(modulePaths.includes("/AreaChart.tsx")).toBe(false);
    expect(modulePaths.includes("/DonutChart.tsx")).toBe(false);
    expect(modulePaths.includes("/DashboardGrid.tsx")).toBe(true);
    expect(modulePaths.includes("/ProvisionalConsentSigner.tsx")).toBe(false);
  });

  it("exposes lazy root exports for measured heavy optional widgets", () => {
    expect(AIRequestExplorer).toBeTruthy();
    expect(ConsentNavigator).toBeTruthy();
    expect(ProvisionalConsentSigner).toBeTruthy();
    expect(DraggableList).toBeTruthy();
    expect(EmojiSelector).toBeTruthy();
    expect(GPTChat).toBeTruthy();
    expect(MarkdownEditor).toBeTruthy();
    expect(
      (LazyEmojiSelector as unknown as {defaultProps?: {category?: typeof Categories.all}})
        .defaultProps?.category
    ).toBe(Categories.all);
  });

  it("resolves documented package entrypoints", async () => {
    for (const importPath of ROOT_IMPORT_PATHS) {
      const moduleNamespace = await import(importPath);
      expect(Object.keys(moduleNamespace).length).toBeGreaterThan(0);
    }
  });
});
