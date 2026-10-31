import {randomUUID} from "node:crypto";

import {logger} from "@terreno/api";
import {generateText, jsonSchema, type LanguageModel, type Tool, tool} from "ai";
import type express from "express";
import type mongoose from "mongoose";

import {FileAttachment} from "../models/fileAttachment";
import type {GptRouteOptions, ImageGenerationOptions} from "../types";
import {GENERATE_IMAGE_TOOL_DESCRIPTION} from "./prompts";
import {findVisibleSkill} from "./skills";

export const GENERATE_IMAGE_TOOL_NAME = "generate_image";

const DEFAULT_MAX_CALLS_PER_TURN = 4;
const MAX_PROMPT_LENGTH = 4000;
const MAX_REFERENCES = 4;
const SKILL_REF_PATTERN = /^skill:([a-z0-9-]{1,64})\/(.+)$/;
const ATTACHMENT_REF_PATTERN = /^attachment:(.+)$/;

const IMAGE_ERRORS = {
  limitReached: "Image limit reached for this turn",
  noImage: "The image model returned no image",
  unknownReference: (ref: string): string => `Unknown reference: ${ref}`,
};

/**
 * An image the tool made. `url` is what the history stores; `displayUrl` is what the client is
 * sent now. They differ only for a stored image, whose signed URL must not be saved in history.
 */
interface ToolGeneratedImage {
  displayUrl: string;
  gcsKey?: string;
  mimeType: string;
  url: string;
}

interface GenerateImageInput {
  prompt: string;
  references?: string[];
}

type GenerateImageResult = {images: {id: string; mimeType: string}[]} | {error: string};

interface ReferenceImage {
  bytes: Buffer;
  mimeType: string;
}

type FileStorage = GptRouteOptions["fileStorageService"];

const isImageType = (mimeType: string | undefined): mimeType is string =>
  typeof mimeType === "string" && mimeType.startsWith("image/");

/**
 * The bytes of one reference, read server-side through storage. Only a visible skill's image
 * file or an image the caller uploaded resolves; anything else, a raw URL included, does not.
 */
const resolveReference = async ({
  fileStorageService,
  ref,
  userId,
}: {
  fileStorageService: FileStorage;
  ref: string;
  userId: mongoose.Types.ObjectId;
}): Promise<ReferenceImage | undefined> => {
  if (!fileStorageService) {
    return undefined;
  }
  const skillMatch = SKILL_REF_PATTERN.exec(ref);
  if (skillMatch) {
    const skill = await findVisibleSkill({name: skillMatch[1], userId});
    const file = skill?.files?.find((candidate) => candidate.filename === skillMatch[2]);
    if (!file || !isImageType(file.mimeType)) {
      return undefined;
    }
    return {bytes: await fileStorageService.download(file.gcsKey), mimeType: file.mimeType};
  }
  const attachmentMatch = ATTACHMENT_REF_PATTERN.exec(ref);
  if (attachmentMatch) {
    const attachment = await FileAttachment.findOneOrNone({
      deleted: false,
      gcsKey: attachmentMatch[1],
      userId,
    });
    if (!attachment || !isImageType(attachment.mimeType)) {
      return undefined;
    }
    return {
      bytes: await fileStorageService.download(attachment.gcsKey),
      mimeType: attachment.mimeType,
    };
  }
  return undefined;
};

/** The style prompt for this request; a lookup that throws is logged and treated as empty. */
const resolveStylePrompt = async ({
  req,
  stylePrompt,
}: {
  req: express.Request;
  stylePrompt: ImageGenerationOptions["stylePrompt"];
}): Promise<string> => {
  try {
    const value = typeof stylePrompt === "function" ? await stylePrompt({req}) : stylePrompt;
    return value?.trim() ?? "";
  } catch (error) {
    logger.warn("Image style prompt lookup failed; generating without it", {
      error: error instanceof Error ? error.message : String(error),
    });
    return "";
  }
};

/** Stores the image when storage can upload, so the history keeps a key instead of the bytes. */
const saveImage = async ({
  base64,
  fileStorageService,
  mimeType,
  userId,
}: {
  base64: string;
  fileStorageService: FileStorage;
  mimeType: string;
  userId: mongoose.Types.ObjectId;
}): Promise<ToolGeneratedImage & {id: string}> => {
  if (!fileStorageService || !("upload" in fileStorageService)) {
    const url = `data:${mimeType};base64,${base64}`;
    return {displayUrl: url, id: randomUUID(), mimeType, url};
  }
  const extension = mimeType.split("/")[1]?.replace(/[^a-z0-9]/g, "") || "png";
  const uploaded = await fileStorageService.upload({
    buffer: Buffer.from(base64, "base64"),
    filename: `generated-${randomUUID()}.${extension}`,
    keyPrefix: "generated",
    mimeType,
    userId,
  });
  return {
    displayUrl: await fileStorageService.getSignedUrl(uploaded.gcsKey),
    gcsKey: uploaded.gcsKey,
    id: uploaded.id,
    mimeType,
    url: uploaded.url,
  };
};

/**
 * The built-in `generate_image` tool for one turn, or undefined when image generation is off or
 * the host has no image model for this request. Every call counts toward `maxCallsPerTurn`; `onImage` emits and records every image made.
 */
export const createGenerateImageTool = ({
  fileStorageService,
  imageGeneration,
  onImage,
  req,
  userId,
}: {
  fileStorageService: FileStorage;
  imageGeneration: ImageGenerationOptions | undefined;
  onImage: (image: ToolGeneratedImage) => void;
  req: express.Request;
  userId: mongoose.Types.ObjectId | undefined;
}): Tool | undefined => {
  if (!imageGeneration || !userId) {
    return undefined;
  }
  const model: LanguageModel | undefined = imageGeneration.model({
    modelId: imageGeneration.modelId,
    req,
  });
  if (!model) {
    return undefined;
  }
  const maxCalls = imageGeneration.maxCallsPerTurn ?? DEFAULT_MAX_CALLS_PER_TURN;
  let callCount = 0;

  return tool({
    description: GENERATE_IMAGE_TOOL_DESCRIPTION,
    execute: async ({
      prompt,
      references = [],
    }: GenerateImageInput): Promise<GenerateImageResult> => {
      if (callCount >= maxCalls) {
        return {error: IMAGE_ERRORS.limitReached};
      }
      // Counted before any await, so parallel calls in one step cannot all pass the limit.
      callCount += 1;
      const referenceImages: ReferenceImage[] = [];
      for (const ref of references) {
        const image = await resolveReference({fileStorageService, ref, userId});
        if (!image) {
          return {error: IMAGE_ERRORS.unknownReference(ref)};
        }
        referenceImages.push(image);
      }

      const style = await resolveStylePrompt({req, stylePrompt: imageGeneration.stylePrompt});
      const result = await generateText({
        messages: [
          {
            content: [
              {text: style ? `${style}\n\n${prompt}` : prompt, type: "text"},
              ...referenceImages.map((image) => ({
                image: image.bytes,
                mediaType: image.mimeType,
                type: "image" as const,
              })),
            ],
            role: "user",
          },
        ],
        model,
      });
      const file = result.files.find((candidate) => isImageType(candidate.mediaType));
      if (!file) {
        return {error: IMAGE_ERRORS.noImage};
      }
      const {id, ...image} = await saveImage({
        base64: file.base64,
        fileStorageService,
        mimeType: file.mediaType,
        userId,
      });
      onImage(image);
      return {images: [{id, mimeType: image.mimeType}]};
    },
    inputSchema: jsonSchema<GenerateImageInput>({
      additionalProperties: false,
      properties: {
        prompt: {
          description: "What the image should show",
          maxLength: MAX_PROMPT_LENGTH,
          minLength: 1,
          type: "string",
        },
        references: {
          description: "Reference images: skill:<name>/<filename> or attachment:<key> refs",
          items: {type: "string"},
          maxItems: MAX_REFERENCES,
          type: "array",
        },
      },
      required: ["prompt"],
      type: "object",
    }),
  });
};
