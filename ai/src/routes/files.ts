import {APIError, asyncHandler, authenticateMiddleware, createOpenApiBuilder} from "@terreno/api";
import type express from "express";
import type mongoose from "mongoose";
import multer from "multer";

import {FileAttachment} from "../models/fileAttachment";
import type {FileStorageService} from "../service/fileStorage";
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

export const addFileRoutes = (
  router: express.Router,
  options: FileRouteOptions & {fileStorageService: FileStorageService}
): void => {
  const {fileStorageService, maxFileSize = DEFAULT_MAX_FILE_SIZE} = options;

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
      upload.single("file"),
      createOpenApiBuilder(options.openApiOptions ?? {})
        .withTags(["files"])
        .withSummary("Upload a file")
        .withResponse(200, {
          filename: {type: "string"},
          gcsKey: {type: "string"},
          id: {type: "string"},
          mimeType: {type: "string"},
          size: {type: "number"},
          url: {type: "string"},
        })
        .build(),
    ],
    asyncHandler(async (req: express.Request, res: express.Response) => {
      const file = (req as express.Request & {file?: Express.Multer.File}).file;
      const userId = requestUserId(req);

      if (!file) {
        throw new APIError({status: 400, title: "No file provided"});
      }

      const result = await fileStorageService.upload({
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
        .withResponse(200, {url: {type: "string"}})
        .build(),
    ],
    asyncHandler(async (req: express.Request, res: express.Response) => {
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

      const url = await fileStorageService.getSignedUrl(gcsKey);
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
        .withResponse(200, {success: {type: "boolean"}})
        .build(),
    ],
    asyncHandler(async (req: express.Request, res: express.Response) => {
      const gcsKey = gcsKeyParam(req);
      const userId = requestUserId(req);

      const attachment = await FileAttachment.findOneOrNone({deleted: false, gcsKey});
      if (!attachment) {
        throw new APIError({status: 404, title: "File not found"});
      }

      if (attachment.userId.toString() !== userId.toString()) {
        throw new APIError({status: 403, title: "Not authorized to delete this file"});
      }

      await fileStorageService.delete(gcsKey);
      return res.json({data: {success: true}});
    })
  );
};
