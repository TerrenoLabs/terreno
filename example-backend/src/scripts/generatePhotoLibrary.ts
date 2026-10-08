/**
 * Generate the example app's shared photo library: `bun run photos:generate [--force]`.
 *
 * For each prompt in `photoPrompts.ts` this generates one image with the AI SDK's
 * `generateImage` and the Vertex image model, uploads it with `FileStorageService.upload`, and
 * upserts a `PhotoLibraryEntry` by `prompt`. Prompts that already have an entry are skipped, so
 * re-runs only fill gaps. `--force` regenerates every prompt and updates its entry in place.
 *
 * This is an operator step, run once per environment. A prompt that fails is logged and the run
 * continues; the summary lists every failure and the process exits non-zero when any failed.
 *
 * Environment (checked before anything runs; every missing variable is listed at once):
 * - `GOOGLE_VERTEX_PROJECT` (required): GCP project for Vertex AI, as the server uses it.
 * - `GCS_BUCKET` (required): bucket the photos are uploaded to, as the server uses it.
 * - Vertex credentials: Application Default Credentials (`GOOGLE_APPLICATION_CREDENTIALS`, or
 *   `gcloud auth application-default login`), checked before the first prompt.
 * - `PHOTO_IMAGE_MODEL` (optional): image model id, default `imagen-4.0-fast-generate-001`.
 * - `GOOGLE_VERTEX_LOCATION` (optional): Vertex region for image calls, default `us-central1`
 *   (Imagen is served from regional endpoints, not the `global` one chat uses).
 * - `GOOGLE_VERTEX_ALLOWED_MODELS` (optional): the server's allow-list, honoured here too.
 * - `MONGO_URI` / `MONGO_DB_NAME`: the database, as for the server.
 *
 * Uploads are owned by a dedicated system user (`photo-library@system.invalid`, found or created,
 * no password, not an admin). The library is served through its own shared read path, so the
 * owner is bookkeeping only.
 */
import {createVertex} from "@ai-sdk/google-vertex";
import {createVertexProvider, FileStorageService} from "@terreno/ai";
import {logger} from "@terreno/api";
import {generateImage, type ImageModel} from "ai";
import {GoogleAuth} from "google-auth-library";
import {DateTime} from "luxon";
import mongoose from "mongoose";

import {PhotoLibraryEntry} from "../models/photoLibraryEntry";
import {User} from "../models/user";
import type {UserDocument} from "../types/models/userTypes";
import {connectToMongoDB} from "../utils/database";
import {PHOTO_PROMPTS, type PhotoPrompt} from "./photoPrompts";

export const DEFAULT_PHOTO_IMAGE_MODEL = "imagen-4.0-fast-generate-001";
const DEFAULT_PHOTO_IMAGE_LOCATION = "us-central1";
const REQUIRED_PHOTO_ENV = ["GOOGLE_VERTEX_PROJECT", "GCS_BUCKET"] as const;
const CLOUD_PLATFORM_SCOPE = "https://www.googleapis.com/auth/cloud-platform";

export const PHOTO_LIBRARY_USER_EMAIL = "photo-library@system.invalid";
const PHOTO_LIBRARY_USER_NAME = "Photo library";

const EXTENSION_BY_MEDIA_TYPE: Record<string, string> = {
  "image/jpeg": "jpg",
  "image/png": "png",
  "image/webp": "webp",
};

export type PhotoUploadParams = Parameters<FileStorageService["upload"]>[0];
export type PhotoUploadResult = Awaited<ReturnType<FileStorageService["upload"]>>;
export type PhotoStorage = Pick<FileStorageService, "upload">;

export interface PhotoLibraryLogger {
  error: (message: string) => void;
  info: (message: string) => void;
}

export interface PhotoLibraryConfig {
  bucketName: string;
  imageModelId: string;
  location: string;
  project: string;
}

export interface GeneratePhotoLibraryResult {
  created: string[];
  failed: {error: string; prompt: string}[];
  skipped: string[];
  updated: string[];
}

/**
 * Read the script's configuration from `env`, throwing one error that names every missing
 * required variable.
 */
export const resolvePhotoLibraryEnv = ({
  env,
}: {
  env: Record<string, string | undefined>;
}): PhotoLibraryConfig => {
  const missing = REQUIRED_PHOTO_ENV.filter((name) => !env[name]?.trim());
  if (missing.length > 0) {
    throw new Error(
      `Missing required environment variables for photos:generate: ${missing.join(", ")}`
    );
  }
  return {
    bucketName: (env.GCS_BUCKET ?? "").trim(),
    imageModelId: env.PHOTO_IMAGE_MODEL?.trim() || DEFAULT_PHOTO_IMAGE_MODEL,
    location: env.GOOGLE_VERTEX_LOCATION?.trim() || DEFAULT_PHOTO_IMAGE_LOCATION,
    project: (env.GOOGLE_VERTEX_PROJECT ?? "").trim(),
  };
};

/** Parse the CLI flags. Only `--force` is accepted, so a typo cannot silently do nothing. */
export const parsePhotoLibraryArgs = ({argv}: {argv: string[]}): {force: boolean} => {
  const unknown = argv.filter((arg) => arg !== "--force");
  if (unknown.length > 0) {
    throw new Error(`Unknown arguments for photos:generate: ${unknown.join(" ")} (only --force)`);
  }
  return {force: argv.includes("--force")};
};

/** Find or create the system user that owns the library's uploads. */
export const ensurePhotoLibraryUser = async (): Promise<UserDocument> => {
  const existing = await User.findOneOrNone({email: PHOTO_LIBRARY_USER_EMAIL});
  if (existing) {
    return existing as UserDocument;
  }
  return User.create({
    admin: false,
    email: PHOTO_LIBRARY_USER_EMAIL,
    name: PHOTO_LIBRARY_USER_NAME,
  });
};

const photoFilename = ({prompt, mediaType}: {prompt: string; mediaType: string}): string => {
  const slug = prompt
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 48);
  return `photo-${slug || "image"}.${EXTENSION_BY_MEDIA_TYPE[mediaType] ?? "png"}`;
};

const errorMessage = (error: unknown): string =>
  error instanceof Error ? error.message : String(error);

/**
 * Generate, upload, and upsert one library entry per prompt. Existing prompts are skipped unless
 * `force` is set. A failed prompt is logged and recorded in `failed`; the rest still run.
 */
export const generatePhotoLibrary = async ({
  force = false,
  imageModel,
  logger: log = logger,
  prompts,
  storage,
  userId,
}: {
  force?: boolean;
  imageModel: ImageModel;
  logger?: PhotoLibraryLogger;
  prompts: PhotoPrompt[];
  storage: PhotoStorage;
  userId: mongoose.Types.ObjectId;
}): Promise<GeneratePhotoLibraryResult> => {
  const result: GeneratePhotoLibraryResult = {created: [], failed: [], skipped: [], updated: []};

  for (const entry of prompts) {
    const existing = await PhotoLibraryEntry.findOneOrNone({prompt: entry.prompt});
    if (existing && !force) {
      result.skipped.push(entry.prompt);
      continue;
    }

    try {
      const {image} = await generateImage({model: imageModel, prompt: entry.prompt});
      const mediaType = image.mediaType || "image/png";
      const upload = await storage.upload({
        buffer: Buffer.from(image.uint8Array),
        filename: photoFilename({mediaType, prompt: entry.prompt}),
        mimeType: mediaType,
        userId,
      });
      await PhotoLibraryEntry.upsert(
        {prompt: entry.prompt},
        {
          alt: entry.alt,
          fileAttachmentId: new mongoose.Types.ObjectId(upload.id),
          gcsKey: upload.gcsKey,
          tags: entry.tags,
        }
      );
      (existing ? result.updated : result.created).push(entry.prompt);
      log.info(`[PhotoLibrary] ${existing ? "Regenerated" : "Generated"} "${entry.prompt}"`);
    } catch (error: unknown) {
      result.failed.push({error: errorMessage(error), prompt: entry.prompt});
      log.error(`[PhotoLibrary] Failed "${entry.prompt}": ${errorMessage(error)}`);
    }
  }

  return result;
};

const parseAllowedModels = (raw?: string): string[] | undefined => {
  const models = (raw ?? "")
    .split(",")
    .map((model) => model.trim())
    .filter(Boolean);
  return models.length > 0 ? models : undefined;
};

/** Resolve the Vertex image model through the shared provider, honouring the allow-list. */
const createPhotoImageModel = (config: PhotoLibraryConfig): ImageModel => {
  const provider = createVertexProvider({
    allowedModels: parseAllowedModels(process.env.GOOGLE_VERTEX_ALLOWED_MODELS),
    project: config.project,
    // The shared provider pins chat to the global endpoint; Imagen needs a regional one.
    vertexFactory: ({project}) => createVertex({location: config.location, project}),
  });
  if (!provider) {
    throw new Error("Vertex AI provider could not be created; check GOOGLE_VERTEX_PROJECT.");
  }
  return provider.imageModel(config.imageModelId);
};

const assertVertexCredentials = async (): Promise<void> => {
  try {
    await new GoogleAuth({scopes: [CLOUD_PLATFORM_SCOPE]}).getClient();
  } catch (error: unknown) {
    throw new Error(
      "Vertex credentials not found. Set GOOGLE_APPLICATION_CREDENTIALS or run " +
        `\`gcloud auth application-default login\`. (${errorMessage(error)})`
    );
  }
};

const runCli = async (): Promise<number> => {
  const {force} = parsePhotoLibraryArgs({argv: process.argv.slice(2)});
  const config = resolvePhotoLibraryEnv({env: process.env});
  await assertVertexCredentials();
  const imageModel = createPhotoImageModel(config);
  const storage = new FileStorageService({bucketName: config.bucketName});

  await connectToMongoDB();
  const startedAt = DateTime.now();
  try {
    const user = await ensurePhotoLibraryUser();
    logger.info(
      `[PhotoLibrary] ${PHOTO_PROMPTS.length} prompts, model ${config.imageModelId}, ` +
        `bucket ${config.bucketName}${force ? ", --force" : ""}`
    );
    const result = await generatePhotoLibrary({
      force,
      imageModel,
      prompts: PHOTO_PROMPTS,
      storage,
      userId: user._id,
    });
    const seconds = DateTime.now().diff(startedAt, "seconds").seconds.toFixed(0);
    logger.info(
      `[PhotoLibrary] Done in ${seconds}s: ${result.created.length} created, ` +
        `${result.updated.length} updated, ${result.skipped.length} skipped, ` +
        `${result.failed.length} failed`
    );
    for (const failure of result.failed) {
      logger.error(`[PhotoLibrary] Failed "${failure.prompt}": ${failure.error}`);
    }
    return result.failed.length > 0 ? 1 : 0;
  } finally {
    await mongoose.disconnect();
  }
};

if (import.meta.main) {
  runCli()
    .then((code) => {
      process.exit(code);
    })
    .catch((error: unknown) => {
      logger.error(`[PhotoLibrary] ${errorMessage(error)}`);
      process.exit(1);
    });
}
