import {describe, expect, it} from "bun:test";
import {act, fireEvent} from "@testing-library/react-native";
import type {ComponentProps} from "react";

import EmojiSelector, {Categories} from "../../src/EmojiSelector";
import {renderWithTheme} from "../../src/test-utils";
import {componentStat, createRenderAudit, formatReport} from "./renderAudit";

interface LayoutRoot {
  props: {onLayout?: (event: {nativeEvent: {layout: object}}) => void};
}

const buildProps = (
  onEmojiSelected: (emoji: string) => void
): ComponentProps<typeof EmojiSelector> => ({
  category: Categories.people,
  columns: 6,
  onEmojiSelected,
  placeholder: "Search emojis",
  showHistory: false,
  showSearchBar: true,
  showSectionTitles: true,
  showTabs: true,
  theme: "#007AFF",
});
const handleSelected = (): void => {};

describe("EmojiSelector renders", () => {
  it("does not re-render the emoji grid or tabs unless their data changes", async () => {
    const audit = createRenderAudit({ignore: /^(ThemeProvider|TerrenoFontProvider)$/});
    let view: ReturnType<typeof renderWithTheme> | undefined;
    await audit.step("mount", async () => {
      view = renderWithTheme(<EmojiSelector {...buildProps(handleSelected)} />);
      await act(async () => {
        (view!.root as unknown as LayoutRoot).props.onLayout?.({
          nativeEvent: {layout: {height: 600, width: 360, x: 0, y: 0}},
        });
        await new Promise((resolve) => setTimeout(resolve, 20));
      });
    });
    await audit.step("same props", async () => {
      await act(async () => {
        view?.rerender(<EmojiSelector {...buildProps(handleSelected)} />);
      });
    });
    await audit.step("new onEmojiSelected identity", async () => {
      await act(async () => {
        view?.rerender(<EmojiSelector {...buildProps((): void => {})} />);
      });
    });
    await act(async () => {
      view?.rerender(<EmojiSelector {...buildProps(handleSelected)} />);
    });
    await audit.step("type one search character", async () => {
      await act(async () => {
        fireEvent.changeText(view!.getByPlaceholderText("Search emojis"), "s");
        await new Promise((resolve) => setTimeout(resolve, 20));
      });
    });
    await audit.step("type second search character", async () => {
      await act(async () => {
        fireEvent.changeText(view!.getByPlaceholderText("Search emojis"), "sm");
        await new Promise((resolve) => setTimeout(resolve, 20));
      });
    });
    await audit.step("clear search", async () => {
      await act(async () => {
        fireEvent.changeText(view!.getByPlaceholderText("Search emojis"), "");
        await new Promise((resolve) => setTimeout(resolve, 20));
      });
    });
    await audit.step("select a tab", async () => {
      await act(async () => {
        fireEvent.press(view!.getByText(Categories.food.symbol));
        await new Promise((resolve) => setTimeout(resolve, 20));
      });
    });
    const report = audit.report();
    audit.dispose();
    view?.unmount();
    if (process.env.RENDER_AUDIT_PRINT) {
      console.info(`\n## EmojiSelector\n${formatReport(report, {limit: 14})}`);
    }

    expect(componentStat(report, "mount", "EmojiCell")?.mounts).toBeGreaterThanOrEqual(8);
    expect(componentStat(report, "same props", "EmojiCell")).toBeUndefined();
    expect(componentStat(report, "same props", "TabBar")).toBeUndefined();
    expect(componentStat(report, "new onEmojiSelected identity", "EmojiCell")).toBeUndefined();
    expect(componentStat(report, "new onEmojiSelected identity", "TabBar")).toBeUndefined();
    expect(componentStat(report, "type one search character", "TabBar")).toBeUndefined();
    expect(componentStat(report, "type second search character", "EmojiCell")?.updates).toBe(0);
    expect(componentStat(report, "select a tab", "TabBar")?.updates).toBe(1);
  });
});
