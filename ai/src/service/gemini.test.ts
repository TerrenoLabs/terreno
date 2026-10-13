import {describe, expect, it, mock} from "bun:test";

import {listGeminiApiModels, normalizeGeminiModelId} from "./gemini";

const jsonResponse = (body: unknown, ok = true, status = 200): Response =>
  ({
    json: async () => body,
    ok,
    status,
  }) as unknown as Response;

describe("gemini model listing helpers", () => {
  describe("normalizeGeminiModelId", () => {
    it("strips the models/ prefix", () => {
      expect(normalizeGeminiModelId("models/gemini-3.8-flash")).toBe("gemini-3.8-flash");
    });

    it("leaves a bare id unchanged", () => {
      expect(normalizeGeminiModelId("gemini-3.1-pro-preview")).toBe("gemini-3.1-pro-preview");
    });
  });

  describe("listGeminiApiModels", () => {
    it("returns undefined when no api key is provided", async () => {
      const result = await listGeminiApiModels({apiKey: ""});
      expect(result).toBeUndefined();
    });

    it("returns normalized chat model ids and filters out non-generateContent models", async () => {
      const fetchImpl = mock(async () =>
        jsonResponse({
          models: [
            {
              name: "models/gemini-3.1-pro-preview",
              supportedGenerationMethods: ["generateContent"],
            },
            {name: "models/gemini-3.8-flash", supportedGenerationMethods: ["generateContent"]},
            {name: "models/text-embedding-004", supportedGenerationMethods: ["embedContent"]},
          ],
        })
      ) as unknown as typeof fetch;

      const result = await listGeminiApiModels({apiKey: "key", fetchImpl});
      expect(result).toEqual(["gemini-3.1-pro-preview", "gemini-3.8-flash"]);
    });

    it("returns every model when chatOnly is false", async () => {
      const fetchImpl = mock(async () =>
        jsonResponse({
          models: [
            {name: "models/gemini-3.8-flash", supportedGenerationMethods: ["generateContent"]},
            {name: "models/text-embedding-004", supportedGenerationMethods: ["embedContent"]},
          ],
        })
      ) as unknown as typeof fetch;

      const result = await listGeminiApiModels({apiKey: "key", chatOnly: false, fetchImpl});
      expect(result).toEqual(["gemini-3.8-flash", "text-embedding-004"]);
    });

    it("follows pagination via nextPageToken", async () => {
      let call = 0;
      const fetchImpl = mock(async () => {
        call += 1;
        if (call === 1) {
          return jsonResponse({
            models: [
              {
                name: "models/gemini-3.1-pro-preview",
                supportedGenerationMethods: ["generateContent"],
              },
            ],
            nextPageToken: "page2",
          });
        }
        return jsonResponse({
          models: [
            {name: "models/gemini-3.8-flash", supportedGenerationMethods: ["generateContent"]},
          ],
        });
      }) as unknown as typeof fetch;

      const result = await listGeminiApiModels({apiKey: "key", fetchImpl});
      expect(result).toEqual(["gemini-3.1-pro-preview", "gemini-3.8-flash"]);
      expect(call).toBe(2);
    });

    it("returns undefined when the request fails", async () => {
      const fetchImpl = mock(async () => jsonResponse({}, false, 503)) as unknown as typeof fetch;
      const result = await listGeminiApiModels({apiKey: "key", fetchImpl});
      expect(result).toBeUndefined();
    });

    it("returns undefined when fetch throws", async () => {
      const fetchImpl = mock(async () => {
        throw new Error("network down");
      }) as unknown as typeof fetch;
      const result = await listGeminiApiModels({apiKey: "key", fetchImpl});
      expect(result).toBeUndefined();
    });

    it("returns undefined when fetchImpl is not available", async () => {
      // Pass a falsy non-nullish value so the `??` operator keeps it (instead of
      // falling through to globalThis.fetch), and `!fetchImpl` evaluates to true.
      const result = await listGeminiApiModels({
        apiKey: "key",
        fetchImpl: 0 as unknown as typeof fetch,
      });
      expect(result).toBeUndefined();
    });

    it("returns a partial list when pagination exceeds the maximum page limit", async () => {
      let callCount = 0;
      const fetchImpl = mock(async () => {
        callCount += 1;
        return jsonResponse({
          models: [
            {
              name: `models/gemini-page-${callCount}`,
              supportedGenerationMethods: ["generateContent"],
            },
          ],
          nextPageToken: `page-${callCount + 1}`,
        });
      }) as unknown as typeof fetch;

      const result = await listGeminiApiModels({apiKey: "key", fetchImpl});
      expect(result).toBeDefined();
      expect(result?.length).toBe(10);
      expect(callCount).toBe(10);
    });

    it("skips models with missing name", async () => {
      const fetchImpl = mock(async () =>
        jsonResponse({
          models: [
            {name: "models/gemini-valid", supportedGenerationMethods: ["generateContent"]},
            {supportedGenerationMethods: ["generateContent"]},
            {name: undefined, supportedGenerationMethods: ["generateContent"]},
          ],
        })
      ) as unknown as typeof fetch;

      const result = await listGeminiApiModels({apiKey: "key", fetchImpl});
      expect(result).toEqual(["gemini-valid"]);
    });

    it("skips models with no supportedGenerationMethods when chatOnly is true", async () => {
      const fetchImpl = mock(async () =>
        jsonResponse({
          models: [
            {name: "models/gemini-chat", supportedGenerationMethods: ["generateContent"]},
            {name: "models/gemini-no-methods"},
          ],
        })
      ) as unknown as typeof fetch;

      const result = await listGeminiApiModels({apiKey: "key", chatOnly: true, fetchImpl});
      expect(result).toEqual(["gemini-chat"]);
    });
  });
});
