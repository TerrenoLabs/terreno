import {pipeline} from "node:stream/promises";
import {Storage} from "@google-cloud/storage";
import {
  type AdminContribution,
  APIError,
  asyncHandler,
  authenticateMiddleware,
  logger,
  type TerrenoPlugin,
} from "@terreno/api";
import type express from "express";
import {DateTime} from "luxon";
import multer from "multer";

import {assertFileUploadsEnabled, type FileUploadsEnabled} from "./fileUploadsGate";

export interface DocumentStorageOptions {
  bucketName: string;
  folderPrefix?: string;
  basePath?: string;
  allowedMimeTypes?: string[];
  maxFileSize?: number;
  signedUrlExpiration?: number;
  /**
   * When `false` or the function returns `false`, `POST` uploads are rejected.
   * Listing, download, and delete stay available. Omit or pass `true` to leave uploads enabled.
   */
  fileUploadsEnabled?: FileUploadsEnabled;
}

export interface DocumentFile {
  name: string;
  fullPath: string;
  size: number;
  contentType: string | undefined;
  updated: string;
  isFolder: boolean;
}

export interface DocumentListResponse {
  files: DocumentFile[];
  folders: string[];
  prefix: string;
}

// Express 5 wildcard route params (e.g. `*filepath`) come through as string[]
// when the URL has one or more path segments. Older signatures (and manual
// calls) may still provide a string. Normalize both shapes to a single
// forward-slash separated path.
const normalizePathParam = (value: unknown): string => {
  if (Array.isArray(value)) {
    return value.filter((segment): segment is string => typeof segment === "string").join("/");
  }
  if (typeof value === "string") {
    return value;
  }
  return "";
};

const DEFAULT_ALLOWED_MIME_TYPES = new Set([
  "image/jpeg",
  "image/png",
  "image/gif",
  "image/webp",
  "image/svg+xml",
  "application/pdf",
  "text/plain",
  "text/csv",
  "application/json",
  "application/msword",
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  "application/vnd.ms-excel",
  "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
]);

const DEFAULT_MAX_FILE_SIZE = 10 * 1024 * 1024; // 10MB

const isAdmin = (req: express.Request): boolean => {
  const user = req.user as {admin?: boolean} | undefined;
  return user?.admin === true;
};

export class DocumentStorageApp implements TerrenoPlugin {
  private options: DocumentStorageOptions;
  private storage: Storage;

  constructor(options: DocumentStorageOptions) {
    this.options = options;
    this.storage = new Storage();
  }

  adminContribution(): AdminContribution {
    return {
      customScreens: [{displayName: "Documents", icon: "folder", name: "documents"}],
    };
  }

  private get bucket() {
    const bucketName = this.options.bucketName || process.env.GCS_BUCKET;
    if (!bucketName) {
      throw new APIError({
        detail: "Configure storage settings before accessing files.",
        disableExternalErrorTracking: true,
        status: 503,
        title: "Storage not configured",
      });
    }
    return this.storage.bucket(bucketName);
  }

  private get prefix() {
    return this.options.folderPrefix ?? "";
  }

  private get allowedMimeTypes(): Set<string> {
    if (this.options.allowedMimeTypes) {
      return new Set(this.options.allowedMimeTypes);
    }
    return DEFAULT_ALLOWED_MIME_TYPES;
  }

  register(app: express.Application): void {
    const basePath = this.options.basePath ?? "/documents";
    const maxFileSize = this.options.maxFileSize ?? DEFAULT_MAX_FILE_SIZE;

    const allowedMimeTypes = this.allowedMimeTypes;

    const upload = multer({
      fileFilter: (_req, file, cb) => {
        if (allowedMimeTypes.has(file.mimetype)) {
          cb(null, true);
        } else {
          cb(
            new APIError({
              detail: `File type ${file.mimetype} is not allowed`,
              disableExternalErrorTracking: true,
              status: 400,
              title: "File type not allowed",
            })
          );
        }
      },
      limits: {fileSize: maxFileSize},
      storage: multer.memoryStorage(),
    });

    const adminGuard = [
      authenticateMiddleware(),
      (req: express.Request, _res: express.Response, next: express.NextFunction) => {
        if (!isAdmin(req)) {
          throw new APIError({status: 403, title: "Admin access required"});
        }
        next();
      },
    ];

    // GET basePath/ — List files and folders
    app.get(
      `${basePath}/`,
      ...adminGuard,
      asyncHandler(async (req: express.Request, res: express.Response) => {
        const queryPrefix = (req.query.prefix as string) ?? "";
        const fullPrefix = `${this.prefix}${queryPrefix}`;

        const [files, , apiResponse] = await this.bucket.getFiles({
          delimiter: "/",
          prefix: fullPrefix,
        });

        const documentFiles: DocumentFile[] = files
          .filter((file) => file.name !== fullPrefix)
          .map((file) => ({
            contentType: file.metadata.contentType as string | undefined,
            fullPath: file.name.slice(this.prefix.length),
            isFolder: false,
            name: file.name.split("/").filter(Boolean).pop() ?? file.name,
            size: Number(file.metadata.size ?? 0),
            updated: file.metadata.updated as string,
          }));

        const prefixes =
          ((apiResponse as {prefixes?: string[]})?.prefixes as string[] | undefined) ?? [];
        const folders = prefixes.map((p) => {
          const relative = p.slice(this.prefix.length);
          return relative;
        });

        const response: DocumentListResponse = {
          files: documentFiles,
          folders,
          prefix: queryPrefix,
        };

        return res.json(response);
      })
    );

    // POST basePath/ — Upload a file
    app.post(
      `${basePath}/`,
      ...adminGuard,
      upload.single("file") as unknown as express.RequestHandler,
      asyncHandler(async (req: express.Request, res: express.Response) => {
        await assertFileUploadsEnabled(req, this.options.fileUploadsEnabled);
        const file = (req as unknown as {file?: Express.Multer.File}).file;
        if (!file) {
          throw new APIError({status: 400, title: "No file provided"});
        }

        const targetPrefix = (req.body.prefix as string) ?? "";
        const sanitizedFilename = file.originalname.replace(/[^a-zA-Z0-9._-]/g, "_");
        const gcsPath = `${this.prefix}${targetPrefix}${sanitizedFilename}`;

        const gcsFile = this.bucket.file(gcsPath);
        await gcsFile.save(file.buffer, {
          contentType: file.mimetype,
        });

        const documentFile: DocumentFile = {
          contentType: file.mimetype,
          fullPath: `${targetPrefix}${sanitizedFilename}`,
          isFolder: false,
          name: sanitizedFilename,
          size: file.buffer.length,
          updated: DateTime.now().toISO(),
        };

        return res.json(documentFile);
      })
    );

    // GET basePath/download/* — Stream file download
    app.get(
      `${basePath}/download/*filepath`,
      ...adminGuard,
      asyncHandler(async (req: express.Request, res: express.Response) => {
        const filePath = normalizePathParam(req.params.filepath);
        if (!filePath) {
          throw new APIError({status: 400, title: "File path is required"});
        }

        const gcsPath = `${this.prefix}${filePath}`;
        const gcsFile = this.bucket.file(gcsPath);

        let metadata: Record<string, unknown>;
        try {
          const [meta] = await gcsFile.getMetadata();
          metadata = meta as Record<string, unknown>;
        } catch (err: unknown) {
          const storageErr = err as {
            code?: number;
            status?: number;
          };
          if (storageErr?.code === 404) {
            throw new APIError({
              disableExternalErrorTracking: true,
              status: 404,
              title: "File not found",
            });
          }
          logger.error("Document download metadata failed", {
            status: storageErr?.code ?? storageErr?.status,
          });
          throw new APIError({
            status: 500,
            title: "Failed to access file",
          });
        }

        const contentType =
          (metadata.contentType as string | undefined) ?? "application/octet-stream";
        const filename = filePath.split("/").filter(Boolean).pop() ?? "download";

        res.setHeader("Content-Type", contentType);
        res.setHeader("Content-Disposition", `attachment; filename="${filename}"`);
        if (metadata.size) {
          res.setHeader("Content-Length", String(metadata.size));
        }

        try {
          await pipeline(gcsFile.createReadStream(), res);
        } catch (err: unknown) {
          const pipelineErr = err as {code?: number};
          logger.error("Document download stream failed", {
            status: pipelineErr?.code,
          });
          if (!res.headersSent) {
            throw new APIError({
              status: 500,
              title: "Failed to stream file",
            });
          }
        }
      })
    );

    // POST basePath/folder — Create a folder
    app.post(
      `${basePath}/folder`,
      ...adminGuard,
      asyncHandler(async (req: express.Request, res: express.Response) => {
        const {folderName, prefix} = req.body as {folderName?: string; prefix?: string};
        if (!folderName) {
          throw new APIError({status: 400, title: "Folder name is required"});
        }

        const sanitizedName = folderName.replace(/[^a-zA-Z0-9._-]/g, "_");
        const targetPrefix = prefix ?? "";
        const gcsPath = `${this.prefix}${targetPrefix}${sanitizedName}/`;

        const gcsFile = this.bucket.file(gcsPath);
        await gcsFile.save(Buffer.alloc(0), {contentType: "application/x-directory"});

        return res.json({folder: `${targetPrefix}${sanitizedName}/`});
      })
    );

    // DELETE basePath/folder/* — Delete a folder and all its contents
    app.delete(
      `${basePath}/folder/*folderpath`,
      ...adminGuard,
      asyncHandler(async (req: express.Request, res: express.Response) => {
        const folderPath = normalizePathParam(req.params.folderpath);
        if (!folderPath) {
          throw new APIError({status: 400, title: "Folder path is required"});
        }

        const gcsPrefix = `${this.prefix}${folderPath}`;
        const [files] = await this.bucket.getFiles({prefix: gcsPrefix});
        await Promise.all(files.map((f) => f.delete({ignoreNotFound: true})));

        return res.json({success: true});
      })
    );

    // DELETE basePath/* — Delete a file
    app.delete(
      `${basePath}/*filepath`,
      ...adminGuard,
      asyncHandler(async (req: express.Request, res: express.Response) => {
        const filePath = normalizePathParam(req.params.filepath);
        if (!filePath) {
          throw new APIError({status: 400, title: "File path is required"});
        }

        const gcsPath = `${this.prefix}${filePath}`;
        const gcsFile = this.bucket.file(gcsPath);

        await gcsFile.delete({ignoreNotFound: true});

        return res.json({success: true});
      })
    );
  }
}
