import {describe, expect, it, mock, spyOn} from "bun:test";
import assert from "node:assert";
import {fireEvent, render, waitFor} from "@testing-library/react-native";
import type React from "react";
import {Image, Linking, StyleSheet} from "react-native";

import type {TerrenoTheme} from "./Common";
import {MarkdownView} from "./MarkdownView";
import {ThemeProvider, useTheme} from "./Theme";
import {renderWithTheme} from "./test-utils";

const LAMB_TABLE = [
  "| Guests | Bone-in lamb | Potatoes |",
  "| --- | --- | --- |",
  "| 4 | 2 kg | 1 kg |",
  "| 6 | 3 kg | 1.5 kg |",
  "| 8 | 4 kg | 2 kg |",
  "| 10 | 5 kg | 2.5 kg |",
].join("\n");

const DARK_PRIMITIVES = {
  neutral300: "#3A3A3A",
  neutral900: "#F5F5F5",
  secondary100: "#1F3A44",
};

interface ThemeCapture {
  theme?: TerrenoTheme;
}

const ThemeProbe: React.FC<{capture: ThemeCapture}> = ({capture}) => {
  const {theme} = useTheme();
  capture.theme = theme;
  return null;
};

const renderTable = async ({
  initialPrimitives,
  markdown = LAMB_TABLE,
}: {
  initialPrimitives?: Record<string, string>;
  markdown?: string;
}): Promise<{capture: ThemeCapture; result: ReturnType<typeof render>}> => {
  const capture: ThemeCapture = {};
  const result = render(
    <ThemeProvider initialPrimitives={initialPrimitives}>
      <ThemeProbe capture={capture} />
      <MarkdownView>{markdown}</MarkdownView>
    </ThemeProvider>
  );
  await waitFor(() => {
    expect(result.getByText("Bone-in lamb")).toBeTruthy();
  });
  return {capture, result};
};

const flatStyle = (node: {props: {style?: unknown}}): Record<string, unknown> => {
  return (StyleSheet.flatten(node.props.style as never) ?? {}) as Record<string, unknown>;
};

describe("MarkdownView", () => {
  it("renders correctly with simple text", async () => {
    const {toJSON} = renderWithTheme(<MarkdownView>Hello world</MarkdownView>);
    await waitFor(() => {
      expect(JSON.stringify(toJSON())).toContain("Hello world");
    });
    expect(toJSON()).toMatchSnapshot();
  });

  it("renders markdown headings", async () => {
    const {toJSON} = renderWithTheme(
      <MarkdownView>{"# Heading 1\n## Heading 2\n### Heading 3"}</MarkdownView>
    );
    await waitFor(() => {
      expect(JSON.stringify(toJSON())).toContain("Heading 1");
    });
    expect(toJSON()).toMatchSnapshot();
  });

  it("renders markdown bold and italic", async () => {
    const {toJSON} = renderWithTheme(<MarkdownView>{"**bold** and *italic* text"}</MarkdownView>);
    await waitFor(() => {
      expect(JSON.stringify(toJSON())).toContain("bold");
    });
    expect(toJSON()).toMatchSnapshot();
  });

  it("renders markdown lists", async () => {
    const {toJSON} = renderWithTheme(<MarkdownView>{"- Item 1\n- Item 2\n- Item 3"}</MarkdownView>);
    await waitFor(() => {
      expect(JSON.stringify(toJSON())).toContain("Item 1");
    });
    expect(toJSON()).toMatchSnapshot();
  });

  it("renders with inverted colors", async () => {
    const {toJSON} = renderWithTheme(<MarkdownView inverted>Inverted text colors</MarkdownView>);
    await waitFor(() => {
      expect(JSON.stringify(toJSON())).toContain("Inverted text colors");
    });
    expect(toJSON()).toMatchSnapshot();
  });

  it("renders numbered lists", async () => {
    const {toJSON} = renderWithTheme(
      <MarkdownView>{"1. First\n2. Second\n3. Third"}</MarkdownView>
    );
    await waitFor(() => {
      expect(JSON.stringify(toJSON())).toContain("First");
    });
    expect(toJSON()).toMatchSnapshot();
  });

  it("keeps long consent ordered list markers on one line", async () => {
    const longConsentList = Array.from({length: 17}, (_, index) => {
      return `${index + 1}. This consent item has enough text to wrap on narrow mobile screens.`;
    }).join("\n");
    const {toJSON} = renderWithTheme(<MarkdownView>{longConsentList}</MarkdownView>);
    await waitFor(() => {
      const serialized = JSON.stringify(toJSON());
      expect(serialized).toContain("17");
    });
    const serialized = JSON.stringify(toJSON());

    assert.ok(serialized.includes('"minWidth":32'));
    assert.ok(serialized.includes('"flexShrink":0'));
    assert.ok(serialized.includes('"textAlign":"right"'));
    assert.ok(serialized.includes("17"));
  });

  it("uses explicit markdown paragraph line height for wrapped mobile text", async () => {
    const {toJSON} = renderWithTheme(
      <MarkdownView>
        {
          "This consent paragraph is intentionally long so it wraps across multiple lines on Android and keeps its measured height."
        }
      </MarkdownView>
    );
    await waitFor(() => {
      const serialized = JSON.stringify(toJSON());
      expect(serialized).toContain('"fontSize":14');
    });
    const serialized = JSON.stringify(toJSON());

    assert.ok(serialized.includes('"fontSize":14'));
    assert.ok(serialized.includes('"lineHeight":20'));
  });

  it("renders code blocks", async () => {
    const {toJSON} = renderWithTheme(<MarkdownView>{"```\ncode block\n```"}</MarkdownView>);
    await waitFor(() => {
      expect(JSON.stringify(toJSON())).toContain("code block");
    });
    expect(toJSON()).toMatchSnapshot();
  });

  it("renders inline code", async () => {
    const {toJSON} = renderWithTheme(<MarkdownView>{"Use `inline code` here"}</MarkdownView>);
    await waitFor(() => {
      expect(JSON.stringify(toJSON())).toContain("inline code");
    });
    expect(toJSON()).toMatchSnapshot();
  });

  it("invokes onLoad after markdown content mounts", async () => {
    const onLoad = mock(() => {});
    const {getByText} = renderWithTheme(
      <MarkdownView onLoad={onLoad}>Loaded markdown</MarkdownView>
    );
    await waitFor(() => {
      expect(getByText("Loaded markdown")).toBeTruthy();
    });
    expect(onLoad).toHaveBeenCalled();
  });

  it("opens ordinary markdown links", async () => {
    const openURL = mock(() => Promise.resolve(true));
    Linking.openURL = openURL;
    const {getByText} = renderWithTheme(
      <MarkdownView>[Docs](https://example.com/docs)</MarkdownView>
    );
    await waitFor(() => {
      expect(getByText("Docs")).toBeTruthy();
    });
    fireEvent.press(getByText("Docs"));
    expect(openURL).toHaveBeenCalledWith("https://example.com/docs");
  });

  it("renders YouTube and Loom links as embed components", async () => {
    const {toJSON} = renderWithTheme(
      <MarkdownView>
        {
          "[YouTube](https://www.youtube.com/watch?v=dQw4w9WgXcQ)\n\n![Loom demo](https://www.loom.com/share/abc123)"
        }
      </MarkdownView>
    );
    await waitFor(() => {
      const serialized = JSON.stringify(toJSON());
      const hasEmbed =
        serialized.includes("markdown-embed-web") || serialized.includes("markdown-embed-native");
      expect(hasEmbed).toBe(true);
    });
  });

  it("passes ordinary image keys directly instead of spreading them through props", async () => {
    const consoleError = spyOn(console, "error").mockImplementation(() => {});
    const originalGetSize = Image.getSize;
    Image.getSize = mock((_uri: string, success: (width: number, height: number) => void): void => {
      success(1200, 800);
    });
    try {
      const {toJSON} = renderWithTheme(
        <MarkdownView>
          {"![Announcement overview](https://example.com/announcement-overview.png)"}
        </MarkdownView>
      );

      await waitFor(() => {
        assert.ok(JSON.stringify(toJSON()).includes("announcement-overview.png"));
      });

      const keySpreadWarnings = consoleError.mock.calls.filter(([message]) =>
        String(message).includes('A props object containing a "key" prop')
      );
      assert.equal(keySpreadWarnings.length, 0);
    } finally {
      Image.getSize = originalGetSize;
      consoleError.mockRestore();
    }
  });

  describe("GFM tables", () => {
    it("draws table cell borders in theme.border.default", async () => {
      const {capture, result} = await renderTable({});
      const cell = result.getByTestId("markdown-table-cell-1-1");
      const header = result.getByTestId("markdown-table-header-0");
      assert.ok(capture.theme);
      expect(flatStyle(cell).borderColor).toBe(capture.theme.border.default);
      expect(flatStyle(header).borderColor).toBe(capture.theme.border.default);
      expect(flatStyle(cell).borderRightWidth).toBe(1);
      expect(flatStyle(cell).borderBottomWidth).toBe(1);
      expect(flatStyle(result.getByTestId("markdown-table")).borderColor).toBe(
        capture.theme.border.default
      );
    });

    it("renders a bold header row on theme.surface.secondaryLight", async () => {
      const {capture, result} = await renderTable({});
      assert.ok(capture.theme);
      for (const index of [0, 1, 2]) {
        expect(
          flatStyle(result.getByTestId(`markdown-table-header-${index}`)).backgroundColor
        ).toBe(capture.theme.surface.secondaryLight);
      }
      expect(flatStyle(result.getByText("Bone-in lamb")).fontFamily).toBe("text-bold");
      expect(flatStyle(result.getByText("1.5 kg")).fontFamily).toBe("text-regular");
      expect(flatStyle(result.getByTestId("markdown-table-cell-1-1")).backgroundColor).toBe(
        undefined
      );
    });

    it("wraps the table in a horizontal scroll view that fills a narrow container", async () => {
      const {result} = await renderTable({});
      const scroll = result.getByTestId("markdown-table-scroll");
      expect(scroll.props.horizontal).toBe(true);
      expect(flatStyle({props: {style: scroll.props.contentContainerStyle}}).minWidth).toBe("100%");
      const table = result.getByTestId("markdown-table");
      expect(flatStyle(table).flexGrow).toBe(1);
      const cellStyle = flatStyle(result.getByTestId("markdown-table-cell-0-0"));
      expect(cellStyle.flexGrow).toBe(1);
      expect(cellStyle.minWidth).toBe(96);
    });

    it("follows a swapped (dark) palette instead of fixed colors", async () => {
      const {capture, result} = await renderTable({initialPrimitives: DARK_PRIMITIVES});
      assert.ok(capture.theme);
      expect(capture.theme.border.default).toBe(DARK_PRIMITIVES.neutral300);
      expect(flatStyle(result.getByTestId("markdown-table-cell-0-0")).borderColor).toBe(
        DARK_PRIMITIVES.neutral300
      );
      expect(flatStyle(result.getByTestId("markdown-table-header-0")).backgroundColor).toBe(
        DARK_PRIMITIVES.secondary100
      );
      expect(flatStyle(result.getByText("Guests")).color).toBe(DARK_PRIMITIVES.neutral900);
      expect(JSON.stringify(result.toJSON())).not.toContain("#000000");
    });

    it("leaves markdown without a table free of table scroll views", async () => {
      const {queryByTestId, getByText} = renderWithTheme(
        <MarkdownView>{"Just a paragraph with **bold** text."}</MarkdownView>
      );
      await waitFor(() => {
        expect(getByText("bold")).toBeTruthy();
      });
      expect(queryByTestId("markdown-table-scroll")).toBeNull();
    });
  });
});
