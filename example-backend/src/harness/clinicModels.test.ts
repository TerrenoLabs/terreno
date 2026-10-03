import {describe, expect, it} from "bun:test";

import {CLINIC_DEMO_MODEL} from "./clinicDemoModel";
import {
  CLINIC_SERVER_FALLBACK_MODEL,
  CLINIC_SERVER_MODEL,
  clinicSummarizerModels,
  resolveExampleModel,
} from "./clinicModels";

const modelLabel = (model: ReturnType<typeof resolveExampleModel>): string =>
  typeof model === "string" ? model : `${model.provider}/${model.modelId}`;

describe("clinic summarizer models", () => {
  it("uses the configured Gemini model when GEMINI_API_KEY is set", () => {
    process.env.GEMINI_API_KEY = "test-api-key";
    expect(clinicSummarizerModels()).toEqual({
      fallbackModels: [CLINIC_SERVER_FALLBACK_MODEL],
      model: CLINIC_SERVER_MODEL,
    });
  });

  it("falls back to the demo model without provider credentials", () => {
    Reflect.deleteProperty(process.env, "GEMINI_API_KEY");
    expect(clinicSummarizerModels()).toEqual({fallbackModels: [], model: CLINIC_DEMO_MODEL});
  });

  it("forces the demo model with CLINIC_DEMO_MODEL=true", () => {
    process.env.GEMINI_API_KEY = "test-api-key";
    process.env.CLINIC_DEMO_MODEL = "true";
    expect(clinicSummarizerModels().model).toEqual(CLINIC_DEMO_MODEL);
  });

  it("resolves demo and google refs and refuses anything else", () => {
    expect(modelLabel(resolveExampleModel(CLINIC_DEMO_MODEL))).toBe("demo/clinic-summarizer-demo");
    process.env.GEMINI_API_KEY = "test-api-key";
    expect(modelLabel(resolveExampleModel(CLINIC_SERVER_MODEL))).toContain("gemini-2.5-flash");
    Reflect.deleteProperty(process.env, "GEMINI_API_KEY");
    expect(() => resolveExampleModel(CLINIC_SERVER_MODEL)).toThrow(
      "google/gemini-2.5-flash needs GEMINI_API_KEY or GOOGLE_VERTEX_PROJECT on the server"
    );
    expect(() => resolveExampleModel({modelId: "x", provider: "openai"})).toThrow(
      'The example backend has no model provider named "openai"'
    );
  });
});
