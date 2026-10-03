import {logger} from "@terreno/api";

/**
 * Helper for listing models available to the Gemini Developer API (the API-key based
 * `generativelanguage.googleapis.com` service, distinct from Vertex / the Gemini Enterprise Agent
 * Platform). Used to drive model pickers from the live set of models Google actually exposes for a
 * given API key, so retired models (e.g. an old `gemini-2.5-flash`) never appear.
 */

/** Default Gemini Developer API base URL. */
export const GEMINI_API_BASE_URL = "https://generativelanguage.googleapis.com/v1beta";

const MAX_MODEL_LIST_PAGES = 10;
const MODEL_LIST_PAGE_SIZE = "200";
const GENERATE_CONTENT_METHOD = "generateContent";

export interface ListGeminiApiModelsOptions {
  /** Gemini Developer API key. */
  apiKey: string;
  /** Override the API base URL (primarily for testing). Defaults to `GEMINI_API_BASE_URL`. */
  baseUrl?: string;
  /**
   * When true (the default), only models that support `generateContent` (i.e. chat-capable models)
   * are returned. Set to false to return every listed model id.
   */
  chatOnly?: boolean;
  /** Injectable fetch implementation (defaults to the global `fetch`). */
  fetchImpl?: typeof fetch;
}

interface GeminiApiModel {
  name?: string;
  supportedGenerationMethods?: string[];
}

/** Strip the "models/" resource prefix from a Gemini model name (e.g. "models/gemini-3.8-flash"). */
export const normalizeGeminiModelId = (name: string): string => {
  return name.trim().replace(/^models\//, "");
};

/**
 * List the models available to a Gemini Developer API key via the `models` REST endpoint. Returns
 * normalized model ids (e.g. "gemini-3.8-flash"). By default only chat-capable models (those
 * supporting `generateContent`) are returned. Returns `undefined` when the listing could not be
 * retrieved (missing key, network error, non-200 response, etc.).
 */
export const listGeminiApiModels = async (
  options: ListGeminiApiModelsOptions
): Promise<string[] | undefined> => {
  const {apiKey} = options;
  if (!apiKey) {
    return undefined;
  }

  const fetchImpl = options.fetchImpl ?? globalThis.fetch;
  if (!fetchImpl) {
    logger.warn("No fetch implementation available for Gemini model listing.");
    return undefined;
  }

  const chatOnly = options.chatOnly ?? true;
  const baseUrl = options.baseUrl ?? GEMINI_API_BASE_URL;
  const models: string[] = [];
  let pageToken: string | undefined;
  let pages = 0;

  try {
    do {
      const url = new URL(`${baseUrl}/models`);
      url.searchParams.set("key", apiKey);
      url.searchParams.set("pageSize", MODEL_LIST_PAGE_SIZE);
      if (pageToken) {
        url.searchParams.set("pageToken", pageToken);
      }

      const response = await fetchImpl(url.toString());
      if (!response.ok) {
        logger.warn(`Gemini model listing failed with status ${response.status}.`);
        return undefined;
      }

      const body = (await response.json()) as {
        models?: GeminiApiModel[];
        nextPageToken?: string;
      };
      for (const model of body.models ?? []) {
        if (!model.name) {
          continue;
        }
        if (
          chatOnly &&
          !(model.supportedGenerationMethods ?? []).includes(GENERATE_CONTENT_METHOD)
        ) {
          continue;
        }
        models.push(normalizeGeminiModelId(model.name));
      }
      pageToken = body.nextPageToken;
      pages += 1;
    } while (pageToken && pages < MAX_MODEL_LIST_PAGES);
  } catch (error) {
    logger.warn(`Gemini model listing errored: ${(error as Error).message}`);
    return undefined;
  }

  if (pageToken) {
    logger.warn(
      `Gemini model listing exceeded ${MAX_MODEL_LIST_PAGES} pages; returning partial list.`
    );
  }

  return models;
};
