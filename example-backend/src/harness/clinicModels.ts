import type {HarnessModelRef, HarnessModelResolver} from "@terreno/ai/harness";
import type {LanguageModel} from "ai";

import {createServerModel} from "../api/ai";
import {CLINIC_DEMO_MODEL, createClinicDemoModel} from "./clinicDemoModel";

/** The configured-provider model the summarizer uses when Gemini or Vertex credentials exist. */
export const CLINIC_SERVER_MODEL: HarnessModelRef = {
  modelId: "gemini-2.5-flash",
  provider: "google",
};

/** Tried after the server model's retryable failures run out. */
export const CLINIC_SERVER_FALLBACK_MODEL: HarnessModelRef = {
  modelId: "gemini-2.5-flash-lite",
  provider: "google",
};

/**
 * The summarizer's model: the deterministic demo model when `CLINIC_DEMO_MODEL=true` or when
 * no provider is configured (no `GOOGLE_VERTEX_PROJECT` and no `GEMINI_API_KEY`), otherwise
 * `CLINIC_SERVER_MODEL`. Decided once when the harness opens; each conversation keeps the
 * model it started with.
 */
export const clinicSummarizerModels = (): {
  fallbackModels: HarnessModelRef[];
  model: HarnessModelRef;
} => {
  if (process.env.CLINIC_DEMO_MODEL === "true" || !createServerModel()) {
    return {fallbackModels: [], model: CLINIC_DEMO_MODEL};
  }
  return {fallbackModels: [CLINIC_SERVER_FALLBACK_MODEL], model: CLINIC_SERVER_MODEL};
};

/**
 * `Harness.open({models})` for the example: `demo/*` refs get the local demo model, `google/*`
 * refs the configured Gemini / Vertex model. Anything else (or Google without credentials)
 * throws, which fails the turn with `Model ... could not be resolved`.
 */
export const resolveExampleModel: HarnessModelResolver = (ref): LanguageModel => {
  if (ref.provider === CLINIC_DEMO_MODEL.provider) {
    return createClinicDemoModel();
  }
  if (ref.provider === CLINIC_SERVER_MODEL.provider) {
    const model = createServerModel(ref.modelId);
    if (model) {
      return model;
    }
    throw new Error(
      `${ref.provider}/${ref.modelId} needs GEMINI_API_KEY or GOOGLE_VERTEX_PROJECT on the server`
    );
  }
  throw new Error(`The example backend has no model provider named "${ref.provider}"`);
};
