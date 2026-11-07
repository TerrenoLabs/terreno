import {APIError, asyncHandler, authenticateMiddleware, createOpenApiBuilder} from "@terreno/api";
import type express from "express";
import type mongoose from "mongoose";
import multer from "multer";

import {FileAttachment} from "../models/fileAttachment";
import type {FileStorageService} from "../service/fileStorage";
import {assertFileUploadsEnabled} from "../service/fileUploadsGate";
import type {FileRouteOptions} from "../types";

const ALLOWED_MIME_TYPES = new Set([
  "image/jpeg",
  "image/png",
  "image/gif",
  "image/webp",
  "application/pdf",
  "text/plain",
  "text/csv",
  "application/json",
]);

const DEFAULT_MAX_FILE_SIZE = 10 * 1024 * 1024; // 10MB

/** The `*gcsKey` wildcard as a key: Express 5 passes it as its path segments. */
const gcsKeyParam = (req: express.Request): string => {
  const param = (req.params as Record<string, string | string[]>).gcsKey ?? "";
  return Array.isArray(param) ? param.join("/") : param;
};

const requestUserId = (req: express.Request): mongoose.Types.ObjectId =>
  (req.user as {_id?: mongoose.Types.ObjectId} | undefined)?._id as mongoose.Types.ObjectId;

/**
 * A storage service, or a function that returns the current one. Pass a function when storage
 * can be configured or cleared at runtime: the routes stay mounted (and documented in OpenAPI)
 * and answer 503 while it returns `undefined`.
 */
export type FileStorageServiceSource = FileStorageService | (() => FileStorageService | undefined);

const resolveFileStorageService = (source: FileStorageServiceSource): FileStorageService => {
  const service = typeof source === "function" ? source() : source;
  if (!service) {
    throw new APIError({status: 503, title: "File storage is not configured"});
  }
  return service;
};

const uploadResultSchema = {
  filename: {type: "string"},
  gcsKey: {
    description: "Storage key; GET or DELETE /files/<gcsKey> reads or removes the file",
    type: "string",
  },
  id: {description: "The FileAttachment id", type: "string"},
  mimeType: {type: "string"},
  size: {description: "Size in bytes", type: "number"},
  url: {type: "string"},
};

export const addFileRoutes = (
  router: express.Router,
  options: FileRouteOptions & {fileStorageService: FileStorageServiceSource}
): void => {
  const {maxFileSize = DEFAULT_MAX_FILE_SIZE} = options;
  const fileStorageService = (): FileStorageService =>
    resolveFileStorageService(options.fileStorageService);

  const upload = multer({
    fileFilter: (_req, file, cb) => {
      if (ALLOWED_MIME_TYPES.has(file.mimetype)) {
        cb(null, true);
      } else {
        cb(new Error(`File type ${file.mimetype} is not allowed`));
      }
    },
    limits: {fileSize: maxFileSize},
    storage: multer.memoryStorage(),
  });

  router.post(
    "/files/upload",
    [
      authenticateMiddleware(),
      // Fail before multer buffers the upload when no storage is configured.
      (_req: express.Request, _res: express.Response, next: express.NextFunction): void => {
        try {
          fileStorageService();
          next();
        } catch (error) {
          next(error);
        }
      },
      upload.single("file"),
      createOpenApiBuilder(options.openApiOptions ?? {})
        .withTags(["files"])
        .withSummary("Upload a file")
        .withDescription(
          `Send the file as multipart/form-data in the \`file\` field. Allowed types: ${[
            ...ALLOWED_MIME_TYPES,
          ].join(", ")}. Maximum size: ${maxFileSize} bytes.`
        )
        .withRequestBody(
          {file: {format: "binary", required: true, type: "string"}},
          {mediaType: "multipart/form-data"}
        )
        .withResponse(
          200,
          {
            data: {
              properties: uploadResultSchema,
              required: Object.keys(uploadResultSchema),
              type: "object",
            },
          },
          {required: ["data"]}
        )
        // Multer puts the file on req.file, not req.body, so JSON body validation must stay off.
        .withValidation({enabled: false})
        .build(),
    ],
    asyncHandler(async (req: express.Request, res: express.Response) => {
      await assertFileUploadsEnabled(req, options.fileUploadsEnabled);
      const storage = fileStorageService();
      const file = (req as express.Request & {file?: Express.Multer.File}).file;
      const userId = requestUserId(req);

      if (!file) {
        throw new APIError({status: 400, title: "No file provided"});
      }

      const result = await storage.upload({
        buffer: file.buffer,
        filename: file.originalname,
        mimeType: file.mimetype,
        userId,
      });

      return res.json({data: result});
    })
  );

  router.get(
    "/files/*gcsKey",
    [
      authenticateMiddleware(),
      createOpenApiBuilder(options.openApiOptions ?? {})
        .withTags(["files"])
        .withSummary("Get file URL")
        .withPathParameter("gcsKey", {type: "string"})
        .withResponse(
          200,
          {
            data: {
              properties: {url: {description: "Signed URL for the file", type: "string"}},
              required: ["url"],
              type: "object",
            },
          },
          {required: ["data"]}
        )
        .build(),
    ],
    asyncHandler(async (req: express.Request, res: express.Response) => {
      const storage = fileStorageService();
      const gcsKey = gcsKeyParam(req);

      // Another user's file is "not found", so keys cannot be probed.
      const attachment = await FileAttachment.findOneOrNone({
        deleted: false,
        gcsKey,
        userId: requestUserId(req),
      });
      if (!attachment) {
        throw new APIError({status: 404, title: "File not found"});
      }

      const url = await storage.getSignedUrl(gcsKey);
      return res.json({data: {url}});
    })
  );

  router.delete(
    "/files/*gcsKey",
    [
      authenticateMiddleware(),
      createOpenApiBuilder(options.openApiOptions ?? {})
        .withTags(["files"])
        .withSummary("Delete a file")
        .withPathParameter("gcsKey", {type: "string"})
        .withResponse(
          200,
          {
            data: {
              properties: {success: {type: "boolean"}},
              required: ["success"],
              type: "object",
            },
          },
          {required: ["data"]}
        )
        .build(),
    ],
    asyncHandler(async (req: express.Request, res: express.Response) => {
      const storage = fileStorageService();
      const gcsKey = gcsKeyParam(req);
      const userId = requestUserId(req);

      const attachment = await FileAttachment.findOneOrNone({deleted: false, gcsKey});
      if (!attachment) {
        throw new APIError({status: 404, title: "File not found"});
      }

      if (attachment.userId.toString() !== userId.toString()) {
        throw new APIError({status: 403, title: "Not authorized to delete this file"});
      }

      await storage.delete(gcsKey);
      return res.json({data: {success: true}});
    })
  );
};
