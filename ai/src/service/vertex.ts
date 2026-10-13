import {APIError, logger} from "@terreno/api";
import type {ImageModel, LanguageModel} from "ai";

/**
 * Helper for Google's Vertex AI provider, now part of the "Gemini Enterprise Agent Platform"
 * (formerly Vertex AI), renamed at Google Cloud Next 2026. The `@ai-sdk/google-vertex` provider
 * and the underlying `*-aiplatform.googleapis.com` REST endpoints are unchanged by the rename;
 * this module centralizes provider creation, model allow-listing, and enabled-model verification
 * against the Gemini Enterprise Agent Platform (Vertex AI) APIs.
 *
 * Behavior:
 * - By default ALL Vertex models are permitted (no allow-list).
 * - Consumers may pass `allowedModels` to restrict which models can be resolved when initializing.
 * - `verifyVertexModelsEnabled` / `assertVertexModelsEnabled` confirm that the requested models are
 *   actually enabled/available for the project using the Google publisher-models listing API.
 */

/** Default Vertex / Gemini Enterprise Agent Platform region. Only global is supported for Gemini 3. */
export const DEFAULT_VERTEX_LOCATION = "global";

const CLOUD_PLATFORM_SCOPE = "https://www.googleapis.com/auth/cloud-platform";
const MAX_MODEL_LIST_PAGES = 10;
const MODEL_LIST_PAGE_SIZE = "200";

/** Provider returned by `@ai-sdk/google-vertex` `createVertex`. */
export interface VertexLanguageModelProvider {
  (modelId: string): LanguageModel;
  image: (modelId: string) => ImageModel;
}

interface VertexModule {
  createVertex: (opts: {location: string; project: string}) => VertexLanguageModelProvider;
}

export interface CreateVertexProviderOptions {
  /**
   * Optional allow-list of model ids consumers may use. When omitted or empty (the default), ALL
   * Vertex models are permitted. When provided, only listed models may be resolved.
   */
  allowedModels?: string[];
  /** Vertex location/region. Forced to global endpoint for Gemini 3 support. */
  location?: string;
  /** GCP project id. Falls back to the GOOGLE_VERTEX_PROJECT env var. */
  project?: string;
  /**
   * Injectable loader for the `@ai-sdk/google-vertex` module, primarily for testing the
   * "module not installed" fallback deterministically. Defaults to a `require`-based loader.
   */
  loadModule?: () => VertexModule | undefined;
  /**
   * Injectable factory for the `@ai-sdk/google-vertex` provider, primarily for testing. When
   * omitted, the provider is loaded dynamically from `@ai-sdk/google-vertex`.
   */
  vertexFactory?: (opts: {location: string; project: string}) => VertexLanguageModelProvider;
}

export interface TerrenoVertexProvider {
  /** Configured allow-list (`undefined` means all models are allowed). */
  allowedModels?: string[];
  /** Resolve an image model, enforcing the allow-list. Throws `APIError(400)` when disallowed. */
  imageModel: (modelId: string) => ImageModel;
  /** Returns true when the model id is permitted by the configured allow-list. */
  isModelAllowed: (modelId: string) => boolean;
  /** Resolve a language model, enforcing the allow-list. Throws `APIError(400)` when disallowed. */
  languageModel: (modelId: string) => LanguageModel;
  /** Configured Vertex location. */
  location: string;
  /** Configured GCP project id. */
  project: string;
  /** Underlying `@ai-sdk/google-vertex` provider. */
  raw: VertexLanguageModelProvider;
}

export interface ListEnabledVertexModelsOptions {
  /** Injectable fetch implementation (defaults to the global `fetch`). */
  fetchImpl?: typeof fetch;
  /** Injectable access-token getter (defaults to Application Default Credentials). */
  getAccessToken?: () => Promise<string | undefined>;
  /** Vertex location/region. Forced to global endpoint for Gemini 3 support. */
  location?: string;
  /** GCP project id. */
  project: string;
}

export interface VertexModelAvailability {
  /** Requested models confirmed available/enabled via the Google API. */
  available: string[];
  /** Whether the Google API listing was successfully retrieved (false means it was skipped). */
  checked: boolean;
  /** Requested models that were NOT found in the Google API listing. */
  unavailable: string[];
}

export interface VerifyVertexModelsOptions extends ListEnabledVertexModelsOptions {
  /** Injectable model-listing function, primarily for testing. */
  listModelsFn?: (options: ListEnabledVertexModelsOptions) => Promise<string[] | undefined>;
  /** Models to verify are enabled/available for the project. */
  models: string[];
}

/**
 * Normalize a publisher model resource name (e.g. "publishers/google/models/gemini-3.8-flash" or
 * "gemini-3.8-flash@001") down to its bare model id (e.g. "gemini-3.8-flash").
 */
export const normalizeVertexModelId = (modelName: string): string => {
  const lastSegment = modelName.trim().split("/").pop() ?? modelName.trim();
  return lastSegment.split("@")[0] ?? lastSegment;
};

/**
 * Returns true when the model id is permitted. An empty/undefined allow-list permits all models.
 * Both the requested model id and allow-list entries are normalized (publisher paths and `@version`
 * suffixes stripped) so matching stays consistent with `verifyVertexModelsEnabled`.
 */
export const isVertexModelAllowed = (modelId: string, allowedModels?: string[]): boolean => {
  if (!allowedModels || allowedModels.length === 0) {
    return true;
  }
  const normalized = normalizeVertexModelId(modelId);
  return allowedModels.some((allowed) => normalizeVertexModelId(allowed) === normalized);
};

const loadVertexModule = (): VertexModule | undefined => {
  try {
    return require("@ai-sdk/google-vertex") as VertexModule;
  } catch {
    return undefined;
  }
};

const getDefaultAccessToken = async (): Promise<string | undefined> => {
  try {
    // google-auth-library is a transitive dependency of @ai-sdk/google-vertex.
    const {GoogleAuth} = require("google-auth-library") as {
      GoogleAuth: new (opts: {
        scopes: string[];
      }) => {
        getClient: () => Promise<{getAccessToken: () => Promise<{token?: string | null}>}>;
      };
    };
    const auth = new GoogleAuth({scopes: [CLOUD_PLATFORM_SCOPE]});
    const client = await auth.getClient();
    const result = await client.getAccessToken();
    return result?.token ?? undefined;
  } catch (error) {
    logger.warn(
      `Unable to acquire Google access token for Vertex model verification: ${
        (error as Error).message
      }`
    );
    return undefined;
  }
};

const resolveLocation = (_location?: string): string => "global";

const aiPlatformHost = (location: string): string =>
  location === "global" ? "aiplatform.googleapis.com" : `${location}-aiplatform.googleapis.com`;

/**
 * Create a Vertex AI (Gemini Enterprise Agent Platform) provider that enforces an optional model
 * allow-list. Returns `undefined` when no project is configured or `@ai-sdk/google-vertex` is not
 * installed, so callers can fall back to another provider or demo mode.
 */
export const createVertexProvider = (
  options: CreateVertexProviderOptions = {}
): TerrenoVertexProvider | undefined => {
  const project = options.project ?? process.env.GOOGLE_VERTEX_PROJECT;
  if (!project) {
    return undefined;
  }

  const location = resolveLocation(options.location);
  const allowedModels =
    options.allowedModels && options.allowedModels.length > 0 ? options.allowedModels : undefined;

  const loadModule = options.loadModule ?? loadVertexModule;
  const factory = options.vertexFactory ?? loadModule()?.createVertex;
  if (!factory) {
    logger.warn(
      "Vertex AI (Gemini Enterprise Agent Platform) provider requested but @ai-sdk/google-vertex is not installed."
    );
    return undefined;
  }

  const raw = factory({location, project});

  const assertAllowed = (modelId: string): void => {
    if (isVertexModelAllowed(modelId, allowedModels)) {
      return;
    }
    throw new APIError({
      detail: `Model "${modelId}" is not in the configured Vertex model allow-list (${(
        allowedModels ?? []
      ).join(", ")}).`,
      status: 400,
      title: "Model not permitted",
    });
  };

  return {
    allowedModels,
    imageModel: (modelId: string): ImageModel => {
      assertAllowed(modelId);
      return raw.image(modelId);
    },
    isModelAllowed: (modelId: string): boolean => isVertexModelAllowed(modelId, allowedModels),
    languageModel: (modelId: string): LanguageModel => {
      assertAllowed(modelId);
      return raw(modelId);
    },
    location,
    project,
    raw,
  };
};

/**
 * List the Google publisher models available to a project via the Gemini Enterprise Agent Platform
 * (Vertex AI) `publishers/google/models` endpoint. Returns the normalized model ids, or `undefined`
 * when the listing could not be retrieved (missing credentials, network error, etc.).
 */
export const listEnabledVertexModels = async (
  options: ListEnabledVertexModelsOptions
): Promise<string[] | undefined> => {
  const {project} = options;
  if (!project) {
    return undefined;
  }

  const fetchImpl = options.fetchImpl ?? globalThis.fetch;
  if (!fetchImpl) {
    logger.warn("No fetch implementation available for Vertex model listing.");
    return undefined;
  }

  const getToken = options.getAccessToken ?? getDefaultAccessToken;
  const token = await getToken();
  if (!token) {
    return undefined;
  }

  const location = resolveLocation(options.location);
  const baseUrl = `https://${aiPlatformHost(location)}/v1beta1/publishers/google/models`;
  const models: string[] = [];
  let pageToken: string | undefined;
  let pages = 0;

  try {
    do {
      const url = new URL(baseUrl);
      url.searchParams.set("pageSize", MODEL_LIST_PAGE_SIZE);
      if (pageToken) {
        url.searchParams.set("pageToken", pageToken);
      }

      const response = await fetchImpl(url.toString(), {
        headers: {Authorization: `Bearer ${token}`},
      });
      if (!response.ok) {
        logger.warn(`Vertex model listing failed with status ${response.status}.`);
        return undefined;
      }

      const body = (await response.json()) as {
        nextPageToken?: string;
        publisherModels?: Array<{name?: string}>;
      };
      for (const model of body.publisherModels ?? []) {
        if (model.name) {
          models.push(normalizeVertexModelId(model.name));
        }
      }
      pageToken = body.nextPageToken;
      pages += 1;
    } while (pageToken && pages < MAX_MODEL_LIST_PAGES);
  } catch (error) {
    logger.warn(`Vertex model listing errored: ${(error as Error).message}`);
    return undefined;
  }

  // More pages remained than we were willing to fetch. Returning the partial list would let
  // verification falsely mark enabled models as unavailable, so treat it as inconclusive instead.
  if (pageToken) {
    logger.warn(
      `Vertex model listing exceeded ${MAX_MODEL_LIST_PAGES} pages; treating verification as inconclusive.`
    );
    return undefined;
  }

  return models;
};

/**
 * Verify that the requested models are enabled/available for the project using the Google APIs.
 * When the listing cannot be retrieved (e.g. no credentials), `checked` is false and verification
 * is treated as inconclusive rather than failing.
 */
export const verifyVertexModelsEnabled = async (
  options: VerifyVertexModelsOptions
): Promise<VertexModelAvailability> => {
  const {listModelsFn, models, ...listOptions} = options;
  const requested = [...new Set(models.map((model) => normalizeVertexModelId(model)))];

  const list = listModelsFn ?? listEnabledVertexModels;
  const enabled = await list(listOptions);

  if (!enabled) {
    return {available: requested, checked: false, unavailable: []};
  }

  const enabledSet = new Set(enabled.map((model) => normalizeVertexModelId(model)));
  const available: string[] = [];
  const unavailable: string[] = [];
  for (const model of requested) {
    if (enabledSet.has(model)) {
      available.push(model);
    } else {
      unavailable.push(model);
    }
  }
  return {available, checked: true, unavailable};
};

/**
 * Like `verifyVertexModelsEnabled`, but throws an `APIError` when the listing was retrieved and one
 * or more requested models are not enabled/available. Inconclusive checks (no credentials/network)
 * do not throw so local development and offline environments keep working.
 */
export const assertVertexModelsEnabled = async (
  options: VerifyVertexModelsOptions
): Promise<VertexModelAvailability> => {
  const result = await verifyVertexModelsEnabled(options);
  if (result.checked && result.unavailable.length > 0) {
    throw new APIError({
      detail: `The following models are not enabled/available on the Gemini Enterprise Agent Platform (Vertex AI) for this project: ${result.unavailable.join(
        ", "
      )}.`,
      status: 400,
      title: "Vertex models unavailable",
    });
  }
  return result;
};
