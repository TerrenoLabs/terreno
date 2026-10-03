import {
  AIService,
  addFileRoutes,
  addGptHistoryRoutes,
  addGptRoutes,
  addMcpRoutes,
  createVertexProvider,
  FileStorageService,
  GptHistory,
  getMCPTools,
  listEnabledVertexModels,
  listGeminiApiModels,
  MCPService,
  normalizeVertexModelId,
  preparePromptForAI,
  type TerrenoVertexProvider,
  verifyVertexModelsEnabled,
} from "@terreno/ai";
import type {ModelRouterOptions, User} from "@terreno/api";
import {APIError, logger, modelRouter, Permissions} from "@terreno/api";
import type {ImageModel, LanguageModel, Tool} from "ai";
import {generateImage, tool, zodSchema} from "ai";
import type express from "express";
import {DateTime} from "luxon";
import {PDFDocument, rgb, StandardFonts} from "pdf-lib";
import {z} from "zod";

import {fileUploadsEnabledForRequest} from "./fileUploads";

/** A provider that creates language models and image models from model IDs. */
interface AIProvider {
  (modelId: string): LanguageModel;
  image: (modelId: string) => ImageModel;
}

type GptRouteOptions = Parameters<typeof addGptRoutes>[1];

/** The subset of @ai-sdk/google we use (loaded dynamically). */
interface GoogleModule {
  createGoogleGenerativeAI: (opts: {apiKey: string}) => AIProvider;
  google: AIProvider;
}

let aiServiceInstance: AIService | undefined;
let mcpServiceInstance: MCPService | undefined;
let fileStorageServiceInstance: FileStorageService | undefined;

export const getFileStorageService = (): FileStorageService | undefined =>
  fileStorageServiceInstance;

export const setFileStorageService = (service: FileStorageService | undefined): void => {
  fileStorageServiceInstance = service;
};

const getGoogleModule = (): GoogleModule | undefined => {
  try {
    return require("@ai-sdk/google") as GoogleModule;
  } catch {
    return undefined;
  }
};

const DEFAULT_MODEL = "gemini-3.8-flash";
const VERTEX_IMAGE_MODEL = "gemini-3-pro-image";

/**
 * Curated fallback chat models (Gemini 3 family), used only when the live Google model listing cannot be retrieved
 * (no provider/API key configured, or the request failed). Kept to current Gemini 3
 * models so the picker never offers retired models.
 */
const DEFAULT_CHAT_MODEL_IDS = [
  "gemini-3.8-flash",
  "gemini-3.5-flash-lite",
  "gemini-3.1-pro-preview",
  "gemini-3-pro-image",
];

interface SelectableModel {
  label: string;
  value: string;
}

/** Derive a human-friendly label from a model id, e.g. "gemini-2.5-flash" -> "Gemini 2.5 Flash". */
const prettifyModelId = (id: string): string =>
  id
    .split(/[-_]/)
    .filter(Boolean)
    .map((part) => (/^\d/.test(part) ? part : part.charAt(0).toUpperCase() + part.slice(1)))
    .join(" ");

const toSelectableModel = (id: string): SelectableModel => ({
  label: prettifyModelId(id),
  value: id,
});

/**
 * Parse the optional GOOGLE_VERTEX_ALLOWED_MODELS env var (comma-separated). When unset/empty, all
 * Vertex models are permitted (the default).
 */
const getAllowedVertexModels = (): string[] | undefined => {
  const raw = process.env.GOOGLE_VERTEX_ALLOWED_MODELS;
  if (!raw) {
    return undefined;
  }
  const models = raw
    .split(",")
    .map((model) => model.trim())
    .filter(Boolean);
  return models.length > 0 ? models : undefined;
};

let vertexProviderInstance: TerrenoVertexProvider | undefined;

/**
 * Resolve the Vertex AI (Gemini Enterprise Agent Platform, formerly Vertex AI) provider. Uses
 * Application Default Credentials and honors an optional GOOGLE_VERTEX_ALLOWED_MODELS allow-list.
 * Only a successfully created provider is cached, so a later call can retry if config/SDK
 * become available.
 */
const getVertexProvider = (): TerrenoVertexProvider | undefined => {
  if (vertexProviderInstance) {
    return vertexProviderInstance;
  }
  vertexProviderInstance = createVertexProvider({
    allowedModels: getAllowedVertexModels(),
    location: process.env.GOOGLE_VERTEX_LOCATION,
    project: process.env.GOOGLE_VERTEX_PROJECT,
  });
  return vertexProviderInstance;
};

/** Pick a default model that respects the configured allow-list. */
const resolveDefaultVertexModel = (provider: TerrenoVertexProvider): string => {
  if (provider.isModelAllowed(DEFAULT_MODEL)) {
    return DEFAULT_MODEL;
  }
  return provider.allowedModels?.[0] ?? DEFAULT_MODEL;
};

/**
 * Verify configured allow-listed Vertex models are enabled/available for the project using the
 * Gemini Enterprise Agent Platform (Vertex AI) APIs. Logs results; never throws so startup is safe.
 */
const verifyAllowedVertexModels = async (provider: TerrenoVertexProvider): Promise<void> => {
  if (!provider.allowedModels || provider.allowedModels.length === 0) {
    return;
  }
  try {
    const result = await verifyVertexModelsEnabled({
      location: provider.location,
      models: provider.allowedModels,
      project: provider.project,
    });
    if (!result.checked) {
      logger.warn(
        "Could not verify configured Vertex models against the Gemini Enterprise Agent Platform APIs (missing credentials or network)."
      );
      return;
    }
    if (result.unavailable.length > 0) {
      logger.error(
        `Configured Vertex models are not enabled/available for project ${provider.project}: ${result.unavailable.join(
          ", "
        )}`
      );
      return;
    }
    logger.info(
      `Verified ${result.available.length} configured Vertex model(s) are enabled for project ${provider.project}.`
    );
  } catch (error) {
    logger.warn(`Vertex model verification skipped: ${(error as Error).message}`);
  }
};

/**
 * List the models actually available from Google for the configured provider: the Vertex / Gemini
 * Enterprise Agent Platform enabled-models list when Vertex is configured, otherwise the Gemini
 * Developer API models list for the configured API key. Returns `undefined` when no provider/key is
 * configured or the listing could not be retrieved.
 */
const listGoogleModels = async (): Promise<string[] | undefined> => {
  const vertexProvider = getVertexProvider();
  if (vertexProvider) {
    return listEnabledVertexModels({
      location: vertexProvider.location,
      project: vertexProvider.project,
    });
  }

  const apiKey = process.env.GEMINI_API_KEY;
  if (apiKey) {
    return listGeminiApiModels({apiKey});
  }

  return undefined;
};

/**
 * Resolve the chat models to offer in the picker. The source of truth is Google's live model list.
 * When the backend configures an acceptable allow-list, it is returned (narrowed to the models
 * Google reports as available, when that list is retrievable). Otherwise the full Google model list
 * is returned. Falls back to a small curated set only when Google can't be reached.
 */
const listAvailableModels = async (): Promise<SelectableModel[]> => {
  const allowed = getAllowedVertexModels();
  const available = await listGoogleModels();

  // Backend specified an acceptable allow-list: return it, narrowed to what Google reports as
  // available when we could retrieve that list.
  if (allowed && allowed.length > 0) {
    if (available && available.length > 0) {
      const availableSet = new Set(available.map(normalizeVertexModelId));
      const filtered = allowed.filter((id) => availableSet.has(normalizeVertexModelId(id)));
      return (filtered.length > 0 ? filtered : allowed).map(toSelectableModel);
    }
    return allowed.map(toSelectableModel);
  }

  // No allow-list: expose the full list of models from Google.
  if (available && available.length > 0) {
    return available.map(toSelectableModel);
  }

  // Google listing unavailable: no Vertex project and no Gemini API key are configured, so we can't
  // ask Google which models exist. Surface a curated current set and explain how to get the full,
  // live list (which is the only way newer models like 3.x appear — they must exist for the key).
  logger.info(
    "/ai/models: no GOOGLE_VERTEX_PROJECT or GEMINI_API_KEY configured; returning the curated " +
      "fallback model set. Configure a Gemini API key or Vertex project to serve Google's live " +
      "model list."
  );
  return DEFAULT_CHAT_MODEL_IDS.map(toSelectableModel);
};

const disabledCrud = {
  create: [],
  delete: [],
  list: [],
  read: [],
  update: [],
};

/**
 * Named collection action so GET `/ai/models` is registered through modelRouter,
 * not `router.get`.
 */
export const aiModelsRouter = modelRouter("/ai", GptHistory, {
  collectionActions: {
    models: {
      handler: async () => {
        const models = await listAvailableModels();
        return {models};
      },
      method: "GET",
      permissions: [Permissions.IsAuthenticated],
      summary: "List selectable AI chat models",
      tag: "ai",
    },
  },
  permissions: disabledCrud,
});

const getAiService = (): AIService | undefined => {
  if (aiServiceInstance) {
    return aiServiceInstance;
  }

  // Prefer Vertex AI / Gemini Enterprise Agent Platform (uses Application Default Credentials)
  const vertexProvider = getVertexProvider();
  if (vertexProvider) {
    aiServiceInstance = new AIService({
      model: vertexProvider.languageModel(resolveDefaultVertexModel(vertexProvider)),
    });
    return aiServiceInstance;
  }

  // Fall back to Gemini API key
  const google = getGoogleModule();
  if (!google) {
    return undefined;
  }

  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) {
    return undefined;
  }

  const provider = google.createGoogleGenerativeAI({apiKey});
  aiServiceInstance = new AIService({
    model: provider(DEFAULT_MODEL),
  });
  return aiServiceInstance;
};

/** Create a LanguageModel on the server side (Vertex AI / Gemini Enterprise Agent Platform or Gemini API key). Returns undefined if no provider is configured (falls through to demo mode). Throws if the requested model is not in the configured allow-list. */
const createServerModel = (modelId?: string) => {
  const vertexProvider = getVertexProvider();
  if (vertexProvider) {
    return vertexProvider.languageModel(modelId ?? resolveDefaultVertexModel(vertexProvider));
  }

  const google = getGoogleModule();
  const apiKey = process.env.GEMINI_API_KEY;
  if (google && apiKey) {
    const provider = google.createGoogleGenerativeAI({apiKey});
    return provider(modelId ?? DEFAULT_MODEL);
  }

  return undefined;
};

/** Create a LanguageModel from a per-request API key (always uses Gemini API). */
const createModelFromKey = (apiKey: string, modelId?: string) => {
  const google = getGoogleModule();
  if (!google) {
    throw new APIError({status: 500, title: "Missing @ai-sdk/google dependency."});
  }
  const provider = google.createGoogleGenerativeAI({apiKey});
  return provider(modelId ?? DEFAULT_MODEL);
};

const getMcpService = (): MCPService | undefined => {
  if (mcpServiceInstance) {
    return mcpServiceInstance;
  }

  const mcpUrl = process.env.MCP_SERVER_URL;
  if (!mcpUrl) {
    return undefined;
  }

  mcpServiceInstance = new MCPService([
    {
      name: "default",
      transport: {type: "sse", url: mcpUrl},
    },
  ]);

  // Connect asynchronously - don't block startup
  void mcpServiceInstance.connect();
  return mcpServiceInstance;
};

const initFileStorageService = (): FileStorageService | undefined => {
  if (fileStorageServiceInstance) {
    return fileStorageServiceInstance;
  }

  const gcsBucket = process.env.GCS_BUCKET;
  if (!gcsBucket) {
    return undefined;
  }

  fileStorageServiceInstance = new FileStorageService({bucketName: gcsBucket});
  return fileStorageServiceInstance;
};

const PDF_PAGE_WIDTH = 612;
const PDF_PAGE_HEIGHT = 792;
const PDF_MARGIN = 72;
const PDF_CONTENT_WIDTH = PDF_PAGE_WIDTH - 2 * PDF_MARGIN;
const PDF_FONT_SIZE = 12;
const PDF_TITLE_SIZE = 24;
const PDF_HEADING_SIZE = 16;
const PDF_LINE_HEIGHT = PDF_FONT_SIZE * 1.5;

const generatePdfBytes = async ({
  title,
  content,
  author,
}: {
  title: string;
  content: string;
  author?: string;
}): Promise<Uint8Array> => {
  const pdfDoc = await PDFDocument.create();
  pdfDoc.setTitle(title);
  if (author) {
    pdfDoc.setAuthor(author);
  }

  const font = await pdfDoc.embedFont(StandardFonts.Helvetica);
  const boldFont = await pdfDoc.embedFont(StandardFonts.HelveticaBold);

  let page = pdfDoc.addPage([PDF_PAGE_WIDTH, PDF_PAGE_HEIGHT]);
  let y = PDF_PAGE_HEIGHT - PDF_MARGIN;

  const ensureSpace = (needed: number): void => {
    if (y - needed < PDF_MARGIN) {
      page = pdfDoc.addPage([PDF_PAGE_WIDTH, PDF_PAGE_HEIGHT]);
      y = PDF_PAGE_HEIGHT - PDF_MARGIN;
    }
  };

  const drawWrappedText = (
    text: string,
    textFont: typeof font,
    fontSize: number,
    lineHeight: number
  ): void => {
    const words = text.split(" ");
    let line = "";

    for (const word of words) {
      const testLine = line ? `${line} ${word}` : word;
      const width = textFont.widthOfTextAtSize(testLine, fontSize);

      if (width > PDF_CONTENT_WIDTH && line) {
        ensureSpace(lineHeight);
        page.drawText(line, {
          color: rgb(0, 0, 0),
          font: textFont,
          size: fontSize,
          x: PDF_MARGIN,
          y,
        });
        y -= lineHeight;
        line = word;
      } else {
        line = testLine;
      }
    }

    if (line) {
      ensureSpace(lineHeight);
      page.drawText(line, {color: rgb(0, 0, 0), font: textFont, size: fontSize, x: PDF_MARGIN, y});
      y -= lineHeight;
    }
  };

  // Title
  ensureSpace(PDF_TITLE_SIZE + PDF_LINE_HEIGHT);
  const titleWidth = boldFont.widthOfTextAtSize(title, PDF_TITLE_SIZE);
  page.drawText(title, {
    color: rgb(0, 0, 0),
    font: boldFont,
    size: PDF_TITLE_SIZE,
    x: Math.max(PDF_MARGIN, (PDF_PAGE_WIDTH - titleWidth) / 2),
    y,
  });
  y -= PDF_TITLE_SIZE + PDF_LINE_HEIGHT;

  // Content - split by double newlines for paragraphs
  const paragraphs = content.split("\n");
  for (const paragraph of paragraphs) {
    const trimmed = paragraph.trim();
    if (!trimmed) {
      y -= PDF_LINE_HEIGHT * 0.5;
      continue;
    }

    // Detect markdown-style headings
    if (trimmed.startsWith("## ")) {
      y -= PDF_LINE_HEIGHT * 0.5;
      ensureSpace(PDF_HEADING_SIZE + PDF_LINE_HEIGHT);
      drawWrappedText(trimmed.slice(3), boldFont, PDF_HEADING_SIZE, PDF_HEADING_SIZE * 1.4);
      y -= PDF_LINE_HEIGHT * 0.3;
      continue;
    }
    if (trimmed.startsWith("# ")) {
      y -= PDF_LINE_HEIGHT * 0.5;
      ensureSpace(PDF_TITLE_SIZE + PDF_LINE_HEIGHT);
      drawWrappedText(trimmed.slice(2), boldFont, PDF_TITLE_SIZE * 0.8, PDF_TITLE_SIZE);
      y -= PDF_LINE_HEIGHT * 0.3;
      continue;
    }

    // Bullet points
    if (trimmed.startsWith("- ") || trimmed.startsWith("* ")) {
      ensureSpace(PDF_LINE_HEIGHT);
      page.drawText("•", {color: rgb(0, 0, 0), font, size: PDF_FONT_SIZE, x: PDF_MARGIN, y});
      const bulletText = trimmed.slice(2);
      const savedY = y;
      const bulletIndent = 15;
      const origWidth = PDF_CONTENT_WIDTH;
      // Draw indented text manually
      const bulletWords = bulletText.split(" ");
      let line = "";
      for (const word of bulletWords) {
        const testLine = line ? `${line} ${word}` : word;
        const width = font.widthOfTextAtSize(testLine, PDF_FONT_SIZE);
        if (width > origWidth - bulletIndent && line) {
          ensureSpace(PDF_LINE_HEIGHT);
          page.drawText(line, {
            color: rgb(0, 0, 0),
            font,
            size: PDF_FONT_SIZE,
            x: PDF_MARGIN + bulletIndent,
            y,
          });
          y -= PDF_LINE_HEIGHT;
          line = word;
        } else {
          line = testLine;
        }
      }
      if (line) {
        if (y === savedY) {
          // First line of bullet, draw next to bullet character
          page.drawText(line, {
            color: rgb(0, 0, 0),
            font,
            size: PDF_FONT_SIZE,
            x: PDF_MARGIN + bulletIndent,
            y,
          });
          y -= PDF_LINE_HEIGHT;
        } else {
          ensureSpace(PDF_LINE_HEIGHT);
          page.drawText(line, {
            color: rgb(0, 0, 0),
            font,
            size: PDF_FONT_SIZE,
            x: PDF_MARGIN + bulletIndent,
            y,
          });
          y -= PDF_LINE_HEIGHT;
        }
      }
      continue;
    }

    drawWrappedText(trimmed, font, PDF_FONT_SIZE, PDF_LINE_HEIGHT);
    y -= PDF_LINE_HEIGHT * 0.3;
  }

  return pdfDoc.save();
};

const createImageModel = (apiKey?: string) => {
  // Prefer Vertex AI / Gemini Enterprise Agent Platform for image generation, but only when the
  // Imagen model is permitted by the allow-list. Otherwise fall back to the Gemini API key.
  const vertexProvider = getVertexProvider();
  if (vertexProvider && !apiKey && vertexProvider.isModelAllowed(VERTEX_IMAGE_MODEL)) {
    return vertexProvider.imageModel(VERTEX_IMAGE_MODEL);
  }

  // Fall back to Gemini API with the provided key
  const google = getGoogleModule();
  if (!google) {
    throw new APIError({status: 500, title: "Missing @ai-sdk/google dependency."});
  }
  const effectiveKey = apiKey ?? process.env.GEMINI_API_KEY;
  if (!effectiveKey) {
    throw new APIError({status: 500, title: "No API key available for image generation."});
  }
  const provider = google.createGoogleGenerativeAI({apiKey: effectiveKey});
  return provider.image(VERTEX_IMAGE_MODEL);
};

const GENERATE_IMAGE_DESCRIPTION =
  "Generate an image from a text description. ONLY use this tool when the user explicitly asks to create, draw, or generate an image or picture. Do NOT use for regular text questions.";

const GENERATE_PDF_DESCRIPTION =
  "Generate a PDF document. ONLY use this tool when the user explicitly asks to create or generate a PDF file. Do NOT use for regular text questions. Use markdown-style formatting in content: # for main headings, ## for subheadings, - for bullet points, and blank lines between paragraphs.";

const createImageTool = (apiKey?: string): Tool => {
  const imageTool = tool({
    description: GENERATE_IMAGE_DESCRIPTION,
    execute: async ({prompt}: {prompt: string}) => {
      const imageModel = createImageModel(apiKey);
      const result = await generateImage({
        model: imageModel,
        prompt,
      });

      const image = result.image;
      if (!image) {
        return {description: "No image was generated. Try a different prompt.", success: false};
      }

      const mediaType = image.mediaType ?? "image/png";
      const dataUrl = `data:${mediaType};base64,${image.base64}`;
      return {
        description: `Generated image for: "${prompt}"`,
        fileData: dataUrl,
        filename: `image-${DateTime.now().toMillis()}.png`,
        mimeType: mediaType,
      };
    },
    inputSchema: zodSchema(
      z.object({
        prompt: z.string().describe("Detailed description of the image to generate"),
      })
    ),
  });
  // toModelOutput is an internal AI SDK property for tool output → model message conversion
  (imageTool as Record<string, unknown>).toModelOutput = ({
    output,
  }: {
    output: Record<string, unknown>;
  }) => [{text: (output.description as string) ?? "Image generated.", type: "text"}];
  return imageTool as Tool;
};

const createPerRequestTools = (req: express.Request): Record<string, Tool> => {
  const tools: Record<string, Tool> = {...getMCPTools(req.user as User | undefined)};

  const apiKey = req.headers["x-ai-api-key"] as string | undefined;
  if (apiKey) {
    tools.generate_image = createImageTool(apiKey);
  }

  return tools;
};

const pdfTool = tool({
  description: GENERATE_PDF_DESCRIPTION,
  execute: async ({title, content, author}: {title: string; content: string; author?: string}) => {
    const pdfBytes = await generatePdfBytes({author, content, title});
    const base64 = Buffer.from(pdfBytes).toString("base64");
    const sanitizedTitle = title.replace(/[^a-zA-Z0-9-_ ]/g, "").replace(/\s+/g, "_");
    const sizeKb = Math.round(pdfBytes.length / 1024);
    return {
      description: `Generated PDF document: "${title}" (${sizeKb}KB)`,
      fileData: `data:application/pdf;base64,${base64}`,
      filename: `${sanitizedTitle}.pdf`,
      mimeType: "application/pdf",
    };
  },
  inputSchema: zodSchema(
    z.object({
      author: z.string().optional().describe("Author name for PDF metadata"),
      content: z
        .string()
        .describe(
          "The document content. Use # for headings, ## for subheadings, - for bullet points, and blank lines between paragraphs."
        ),
      title: z.string().describe("Title displayed at the top of the PDF"),
    })
  ),
});
// toModelOutput is an internal AI SDK property for tool output → model message conversion
(pdfTool as Record<string, unknown>).toModelOutput = ({
  output,
}: {
  output: Record<string, unknown>;
}) => [{text: (output.description as string) ?? "PDF generated.", type: "text"}];

const JOKE_FALLBACK_SYSTEM_PROMPT =
  "You are a witty comedian. Tell a short, clever joke in 1-3 sentences. Be funny and concise.";

const jokeGeneratorTool = tool({
  description:
    "Generate a joke about any topic. Uses a Langfuse prompt template when configured, otherwise uses a built-in prompt.",
  execute: async ({topic, style}: {topic: string; style?: string}) => {
    const svc = getAiService();
    if (!svc) {
      return {joke: `Why did the developer quit? Because they couldn't find their ${topic}!`};
    }

    let systemPrompt = JOKE_FALLBACK_SYSTEM_PROMPT;
    try {
      const prepared = await preparePromptForAI({
        promptName: "joke-generator",
        variables: {style: style ?? "witty", topic},
      });
      if (typeof prepared.prompt === "string") {
        systemPrompt = prepared.prompt;
      }
    } catch (err) {
      logger.debug(`Langfuse prompt skipped for joke-generator: ${(err as Error).message}`);
    }

    const joke = await svc.generateText({
      prompt: `Tell me a ${style ?? "witty"} joke about: ${topic}`,
      systemPrompt,
      temperature: 1.2,
    });
    return {joke: joke.trim()};
  },
  inputSchema: zodSchema(
    z.object({
      style: z
        .string()
        .optional()
        .describe("Style of joke: witty, pun, dad joke, dark, absurdist, etc."),
      topic: z.string().describe("What the joke should be about"),
    })
  ),
});

// Sample tools for demo purposes
const getDemoTools = (): Record<string, Tool> => {
  const tools: Record<string, Tool> = {
    generate_joke: jokeGeneratorTool,
    generate_pdf: pdfTool,
    get_current_time: tool({
      description: "Get the current date and time",
      execute: async ({timezone}: {timezone?: string}) => {
        const now = DateTime.now().setZone(timezone ?? "UTC");
        if (!now.isValid) {
          throw new APIError({status: 400, title: `Invalid timezone: ${timezone}`});
        }
        return {
          time: now.setLocale("en-US").toLocaleString(DateTime.DATETIME_FULL_WITH_SECONDS),
          timezone: timezone ?? "UTC",
        };
      },
      inputSchema: zodSchema(
        z.object({
          timezone: z.string().optional().describe("IANA timezone name (e.g., America/New_York)"),
        })
      ),
    }),
  };

  // Add server-side image generation when a permitted Vertex image model or a server API key is available
  const vertexProvider = getVertexProvider();
  const vertexImageAvailable = Boolean(vertexProvider?.isModelAllowed(VERTEX_IMAGE_MODEL));
  if (vertexImageAvailable || process.env.GEMINI_API_KEY) {
    tools.generate_image = createImageTool();
  }

  return tools;
};

export const addAiRoutes = (
  router: express.Router,
  // noExplicitAny: ModelRouterOptions generic varies per downstream caller
  // biome-ignore lint/suspicious/noExplicitAny: ModelRouterOptions generic varies per downstream caller
  options?: Partial<ModelRouterOptions<any>>
): void => {
  const aiService = getAiService();
  const mcpService = getMcpService();
  const fileStorageService = initFileStorageService();

  // Verify any configured Vertex model allow-list is enabled/available via the Google APIs.
  const vertexProvider = getVertexProvider();
  if (vertexProvider) {
    void verifyAllowedVertexModels(vertexProvider);
  }

  addGptHistoryRoutes(router, options);
  addGptRoutes(router, {
    aiService,
    createModelFn: createModelFromKey,
    createRequestTools: createPerRequestTools as unknown as GptRouteOptions["createRequestTools"],
    createServerModelFn: createServerModel,
    demoMode: !aiService,
    fileUploadsEnabled: fileUploadsEnabledForRequest,
    langfuseSystemPromptName: "chat-assistant",
    maxSteps: 5,
    mcpService,
    openApiOptions: options,
    toolChoice: "auto",
    tools: getDemoTools() as unknown as GptRouteOptions["tools"],
  });
  if (fileStorageService) {
    addFileRoutes(router, {
      fileStorageService,
      fileUploadsEnabled: fileUploadsEnabledForRequest,
      gcsBucket: process.env.GCS_BUCKET ?? "",
      openApiOptions: options,
    });
  }

  if (mcpService) {
    addMcpRoutes(router, {mcpService, openApiOptions: options});
  }
};
