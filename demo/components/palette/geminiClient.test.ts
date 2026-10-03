import {describe, expect, it, mock} from "bun:test";

import {DEFAULT_FONTS} from "./fonts";
import {generatePaletteFromChat, listGeminiModels} from "./geminiClient";
import {type ChatMessage, DEFAULT_ANCHORS} from "./paletteTypes";

/**
 * Unit tests for the Gemini client. All network access is injected via `fetchImpl`, so these cover
 * request assembly, error handling, JSON parsing, and the hex/font fallback merging without hitting
 * the real API.
 */

const makeResponse = (body: unknown, ok = true, status = 200): Response =>
  ({
    json: async () => body,
    ok,
    status,
  }) as unknown as Response;

const geminiContent = (payload: unknown): unknown => ({
  candidates: [{content: {parts: [{text: JSON.stringify(payload)}]}}],
});

const baseMessages: ChatMessage[] = [
  {createdAt: "", id: "1", role: "user", text: "warm and modern"},
];

describe("generatePaletteFromChat", () => {
  it("throws when no api key is provided", async () => {
    await expect(
      generatePaletteFromChat({
        apiKey: "",
        currentAnchors: DEFAULT_ANCHORS,
        currentFonts: DEFAULT_FONTS,
        messages: baseMessages,
        model: "gemini-3.8-flash",
      })
    ).rejects.toThrow(/api key/i);
  });

  it("parses anchors and fonts from a valid response", async () => {
    const fetchImpl = mock(async () =>
      makeResponse(
        geminiContent({
          accent: "#123456",
          bodyFont: "Inter",
          error: "#ff0000",
          explanation: "A warm modern palette.",
          fontRationale: "Poppins pairs cleanly with Inter.",
          headingFont: "Poppins",
          neutral: "#888888",
          primary: "#0a0b0c",
          secondary: "#010203",
          success: "#00ff00",
          warning: "#ffaa00",
        })
      )
    );

    const result = await generatePaletteFromChat({
      apiKey: "key",
      currentAnchors: DEFAULT_ANCHORS,
      currentFonts: DEFAULT_FONTS,
      fetchImpl: fetchImpl as unknown as typeof fetch,
      messages: baseMessages,
      model: "gemini-3.5-flash",
    });

    expect(result.anchors.primary).toBe("#0a0b0c");
    expect(result.fonts.headingFont).toBe("Poppins");
    expect(result.fonts.bodyFont).toBe("Inter");
    expect(result.fontRationale).toContain("Poppins");
    expect(fetchImpl).toHaveBeenCalledTimes(1);
  });

  it("falls back to current anchors/fonts for missing or invalid values", async () => {
    const fetchImpl = mock(async () =>
      makeResponse(
        geminiContent({
          accent: "not-a-color",
          explanation: "partial",
          primary: "#abcdef",
        })
      )
    );

    const result = await generatePaletteFromChat({
      apiKey: "key",
      currentAnchors: DEFAULT_ANCHORS,
      currentFonts: DEFAULT_FONTS,
      fetchImpl: fetchImpl as unknown as typeof fetch,
      messages: baseMessages,
      model: "gemini-3.5-flash",
    });

    expect(result.anchors.primary).toBe("#abcdef");
    // Invalid hex keeps the current anchor.
    expect(result.anchors.accent).toBe(DEFAULT_ANCHORS.accent);
    // Missing fonts keep current selection.
    expect(result.fonts.headingFont).toBe(DEFAULT_FONTS.headingFont);
    expect(result.fontRationale).toBeUndefined();
  });

  it("throws a helpful error on a non-ok response", async () => {
    const fetchImpl = mock(async () =>
      makeResponse({error: {message: "Invalid API key"}}, false, 400)
    );

    await expect(
      generatePaletteFromChat({
        apiKey: "bad",
        currentAnchors: DEFAULT_ANCHORS,
        currentFonts: DEFAULT_FONTS,
        fetchImpl: fetchImpl as unknown as typeof fetch,
        messages: baseMessages,
        model: "gemini-3.8-flash",
      })
    ).rejects.toThrow("Invalid API key");
  });

  it("throws when the response is not valid JSON", async () => {
    const fetchImpl = mock(async () =>
      makeResponse({candidates: [{content: {parts: [{text: "not json"}]}}]})
    );

    await expect(
      generatePaletteFromChat({
        apiKey: "key",
        currentAnchors: DEFAULT_ANCHORS,
        currentFonts: DEFAULT_FONTS,
        fetchImpl: fetchImpl as unknown as typeof fetch,
        messages: baseMessages,
        model: "gemini-3.8-flash",
      })
    ).rejects.toThrow(/parse/i);
  });
});

describe("listGeminiModels", () => {
  it("returns only chat-capable models, normalized", async () => {
    const fetchImpl = mock(async () =>
      makeResponse({
        models: [
          {name: "models/gemini-3.8-flash", supportedGenerationMethods: ["generateContent"]},
          {name: "models/text-embedding", supportedGenerationMethods: ["embedContent"]},
          {name: "models/gemini-3.1-pro-preview", supportedGenerationMethods: ["generateContent"]},
        ],
      })
    );

    const models = await listGeminiModels({
      apiKey: "key",
      fetchImpl: fetchImpl as unknown as typeof fetch,
    });
    expect(models).toEqual(["gemini-3.8-flash", "gemini-3.1-pro-preview"]);
  });

  it("returns undefined without a key", async () => {
    expect(await listGeminiModels({apiKey: ""})).toBeUndefined();
  });

  it("returns undefined on a non-ok response", async () => {
    const fetchImpl = mock(async () => makeResponse({}, false, 403));
    expect(
      await listGeminiModels({apiKey: "key", fetchImpl: fetchImpl as unknown as typeof fetch})
    ).toBeUndefined();
  });
});
