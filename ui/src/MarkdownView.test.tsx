import {describe, expect, it, mock, spyOn} from "bun:test";
import assert from "node:assert";
import {fireEvent, render, waitFor} from "@testing-library/react-native";
import {Image, Linking} from "react-native";

import {MarkdownView} from "./MarkdownView";
import {ThemeProvider} from "./Theme";
import {renderWithTheme} from "./test-utils";

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

  it("keeps an inverted blockquote off the same color as its text", async () => {
    const {toJSON} = renderWithTheme(<MarkdownView inverted>{"> Quoted line"}</MarkdownView>);
    await waitFor(() => {
      expect(JSON.stringify(toJSON())).toContain("Quoted line");
    });
    const serialized = JSON.stringify(toJSON());
    assert.ok(serialized.includes('"backgroundColor":"#353535"'));
    assert.ok(serialized.includes('"color":"#FFFFFF"'));

    const dark = render(
      <ThemeProvider colorScheme="dark">
        <MarkdownView inverted>{"> Quoted line"}</MarkdownView>
      </ThemeProvider>
    );
    await waitFor(() => {
      expect(JSON.stringify(dark.toJSON())).toContain("Quoted line");
    });
    const darkSerialized = JSON.stringify(dark.toJSON());
    assert.ok(darkSerialized.includes('"backgroundColor":"#F2F2F2"'));
    assert.ok(darkSerialized.includes('"color":"#353535"'));
  });

  it("keeps inverted code off a fill below 4.5:1", async () => {
    const light = renderWithTheme(<MarkdownView inverted>{"Use `inline code` here"}</MarkdownView>);
    await waitFor(() => {
      expect(JSON.stringify(light.toJSON())).toContain("inline code");
    });
    const lightSerialized = JSON.stringify(light.toJSON());
    assert.ok(lightSerialized.includes('"backgroundColor":"#353535"'));
    assert.ok(lightSerialized.includes('"color":"#FFFFFF"'));

    const dark = render(
      <ThemeProvider colorScheme="dark">
        <MarkdownView inverted>{"```\ncode block\n```"}</MarkdownView>
      </ThemeProvider>
    );
    await waitFor(() => {
      expect(JSON.stringify(dark.toJSON())).toContain("code block");
    });
    const darkSerialized = JSON.stringify(dark.toJSON());
    assert.ok(darkSerialized.includes('"backgroundColor":"#F2F2F2"'));
    assert.ok(darkSerialized.includes('"color":"#353535"'));
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
});
