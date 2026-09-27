import {describe, expect, it} from "bun:test";

import * as terrenoAi from "./index";

const exported: Record<string, unknown> = terrenoAi;

/**
 * Guards the public entrypoint of @terreno/ai: a missing or renamed export here is a
 * breaking change for consumers, and the barrel itself is never exercised by the
 * per-module tests.
 */
describe("@terreno/ai public exports", () => {
  const expectedFunctions = [
    "addAiRequestsExplorerRoutes",
    "addFileRoutes",
    "addGptHistoryRoutes",
    "addGptRoutes",
    "addMcpRoutes",
    "addProjectRoutes",
    "assertVertexModelsEnabled",
    "compilePrompt",
    "createAskTools",
    "createPrompt",
    "createTelemetryConfig",
    "createVertexProvider",
    "getCached",
    "getMCPTools",
    "getLangfuseClient",
    "getPrompt",
    "initLangfuseClient",
    "initTracing",
    "invalidateCache",
    "invalidatePromptCache",
    "isLangfuseInitialized",
    "isVertexModelAllowed",
    "jsonSchema",
    "listEnabledVertexModels",
    "listGeminiApiModels",
    "normalizeGeminiModelId",
    "normalizeLlmJsonTextForStructuredOutput",
    "normalizeVertexModelId",
    "parseAiJson",
    "preparePromptForAI",
    "setCached",
    "shutdownLangfuseClient",
    "shutdownTracing",
    "verifyVertexModelsEnabled",
  ] as const;

  const expectedClasses = [
    "AIRequest",
    "AIService",
    "AiApp",
    "FileAttachment",
    "FileStorageService",
    "GptHistory",
    "LangfuseApp",
    "LangfuseCache",
    "MCPService",
    "Project",
  ] as const;

  const expectedConstants = [
    "CONTENT_SUMMARY_PROMPT",
    "DEFAULT_GPT_MEMORY",
    "DEFAULT_VERTEX_LOCATION",
    "GEMINI_API_BASE_URL",
    "JSON_VALUE_SYSTEM_PROMPT",
    "Output",
    "REMIX_PROMPT",
    "TERRENO_ASKS_SYSTEM_PROMPT",
    "TITLE_GENERATION_PROMPT",
    "TRANSLATION_PROMPT",
    "TemperaturePresets",
  ] as const;

  it.each(expectedFunctions)("exports %s as a function", (name) => {
    expect(typeof exported[name]).toBe("function");
  });

  it.each(expectedClasses)("exports %s as a constructable value", (name) => {
    expect(typeof exported[name]).toBe("function");
  });

  it.each(expectedConstants)("exports the %s constant", (name) => {
    expect(exported[name]).toBeDefined();
  });

  it("re-exports the default AI request types", () => {
    expect(terrenoAi.DEFAULT_AI_REQUEST_TYPES).toContain("general");
    expect(terrenoAi.DEFAULT_AI_REQUEST_TYPES).toContain("translation");

    // The tuple is frozen at the type level via `as const`; keep the runtime list stable
    // because request types are persisted on AIRequest documents.
    expect([...terrenoAi.DEFAULT_AI_REQUEST_TYPES]).toEqual([
      "general",
      "json_array",
      "json_object",
      "json_value",
      "remix",
      "summarization",
      "translation",
    ]);
  });
});
