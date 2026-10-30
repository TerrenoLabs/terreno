import {
  APIError,
  isAuditRecorderInstalled,
  type JSONValue,
  logger,
  modelRouter,
  type PermissionMethod,
  Permissions,
  recordAuditEvent,
} from "@terreno/api";
import type express from "express";
import mongoose from "mongoose";
import multer from "multer";

import {GptSkill, setSkillFileStorage} from "../models/gptSkill";
import type {FileStorageService} from "../service/fileStorage";
import {parseSkillPackage} from "../service/skillPackage";
import type {GptSkillDocument, GptSkillFile} from "../types/skills";

interface SkillRouteOptions {
  fileStorageService?: Pick<FileStorageService, "delete" | "upload">;
  openApiOptions?: Record<string, unknown>;
}

const MAX_UPLOAD_BYTES = 10 * 1024 * 1024;

interface SkillUser {
  _id?: mongoose.Types.ObjectId;
  admin?: boolean;
  id?: string;
}

const UPDATABLE_FIELDS = ["name", "description", "instructions", "enabled"] as const;

/** User skills belong to their owner; global skills are readable by all and writable by admins. */
const canAccessSkill: PermissionMethod<GptSkillDocument> = (method, user, skill) => {
  if (!skill) {
    return true;
  }
  if (!user?.id) {
    return false;
  }
  if (skill.scope === "global") {
    return method === "read" || Boolean(user.admin);
  }
  return Boolean(skill.userId && String(skill.userId) === String(user.id));
};

// List never carries instructions or storage keys; single-skill responses add instructions.
const serializeSkill = (
  doc: GptSkillDocument,
  method: "list" | "create" | "read" | "update" | "delete"
): Record<string, unknown> => {
  const skill: Record<string, unknown> = {
    _id: String(doc._id),
    created: doc.created,
    description: doc.description,
    enabled: doc.enabled,
    files: (doc.files ?? []).map(({filename, mimeType, size}) => ({filename, mimeType, size})),
    name: doc.name,
    scope: doc.scope,
    updated: doc.updated,
  };
  if (method === "list") {
    return skill;
  }
  skill.instructions = doc.instructions;
  if ((method === "create" || method === "update") && doc.userId) {
    skill.userId = String(doc.userId);
  }
  return skill;
};

const uploadMiddleware = multer({
  limits: {fileSize: MAX_UPLOAD_BYTES, files: 1},
  storage: multer.memoryStorage(),
}).single("file");

// Multipart is parsed inside the action because actions run no per-route body middleware.
const readUpload = (req: express.Request, res: express.Response): Promise<Express.Multer.File> =>
  new Promise((resolve, reject) => {
    uploadMiddleware(req, res, (error: unknown) => {
      if (error instanceof multer.MulterError && error.code === "LIMIT_FILE_SIZE") {
        reject(new APIError({status: 413, title: "A skill package may be at most 10 MB"}));
        return;
      }
      if (error) {
        reject(
          new APIError({cause: error, status: 400, title: "Could not read the uploaded file"})
        );
        return;
      }
      const file = (req as express.Request & {file?: Express.Multer.File}).file;
      if (!file) {
        reject(new APIError({status: 400, title: "No file provided"}));
        return;
      }
      resolve(file);
    });
  });

const deleteStoredFiles = async (
  storage: Pick<FileStorageService, "delete">,
  files: GptSkillFile[]
): Promise<void> => {
  for (const file of files) {
    try {
      await storage.delete(file.gcsKey);
    } catch (error) {
      logger.warn(`Failed to delete skill file ${file.gcsKey}: ${String(error)}`);
    }
  }
};

/** Creates a skill from a `SKILL.md` or `.zip` upload; nothing is kept when any step fails. */
const uploadSkill = async ({
  fileStorageService,
  req,
  res,
}: {
  fileStorageService?: Pick<FileStorageService, "delete" | "upload">;
  req: express.Request;
  res: express.Response;
}): Promise<Record<string, unknown>> => {
  const upload = await readUpload(req, res);
  const user = req.user as SkillUser | undefined;
  const isGlobal = (req.body as {scope?: unknown} | undefined)?.scope === "global";
  if (isGlobal && !user?.admin) {
    throw new APIError({status: 403, title: "Only admins can create global skills"});
  }

  const parsed = await parseSkillPackage({buffer: upload.buffer, filename: upload.originalname});
  const storage = parsed.files.length ? fileStorageService : undefined;
  if (parsed.files.length && !storage) {
    throw new APIError({status: 400, title: "File storage is not configured"});
  }

  const skill = new GptSkill({
    _id: new mongoose.Types.ObjectId(),
    description: parsed.description,
    instructions: parsed.instructions,
    name: parsed.name,
    scope: isGlobal ? "global" : "user",
    ...(isGlobal ? {} : {userId: user?._id}),
  });
  // Name clashes and field errors fail here, before anything reaches storage.
  await skill.validate();

  const stored: GptSkillFile[] = [];
  try {
    for (const file of parsed.files) {
      if (!storage) {
        break;
      }
      const result = await storage
        .upload({
          buffer: Buffer.from(file.data),
          filename: file.filename,
          keyPrefix: `skills/${skill._id}`,
          mimeType: file.mimeType,
          userId: user?._id as mongoose.Types.ObjectId,
        })
        .catch((error: unknown) => {
          throw new APIError({
            cause: error,
            status: 500,
            title: "Could not store the skill's files",
          });
        });
      stored.push({
        filename: file.filename,
        gcsKey: result.gcsKey,
        mimeType: file.mimeType,
        size: file.data.length,
      });
    }
    skill.files = stored;
    await skill.save();
  } catch (error) {
    if (storage) {
      await deleteStoredFiles(storage, stored);
    }
    throw error;
  }

  if (isAuditRecorderInstalled()) {
    void recordAuditEvent({
      actorId: user?.id ?? (user?._id ? String(user._id) : undefined),
      after: serializeSkill(skill, "create"),
      modelName: GptSkill.modelName,
      operation: "create",
      recordId: String(skill._id),
      recordLabel: skill.name,
      source: "modelRouter",
      verb: "created",
    });
  }
  return serializeSkill(skill, "create");
};

export const addSkillRoutes = (router: express.Router, options?: SkillRouteOptions): void => {
  // Always set, so a host without storage never keeps an earlier registration's service.
  setSkillFileStorage(options?.fileStorageService);

  router.use(
    "/gpt/skills",
    modelRouter(GptSkill, {
      ...options?.openApiOptions,
      audit: true,
      collectionActions: {
        upload: {
          description:
            "Multipart `file` (a SKILL.md or .zip skill package, at most 10 MB) and optional `scope`.",
          handler: ({req, res}) =>
            uploadSkill({fileStorageService: options?.fileStorageService, req, res}),
          method: "POST",
          permissions: [Permissions.IsAuthenticated],
          status: 201,
          summary: "Create a skill from an uploaded SKILL.md or .zip package",
        },
      },
      permissions: {
        create: [Permissions.IsAuthenticated],
        delete: [Permissions.IsAuthenticated, canAccessSkill],
        list: [Permissions.IsAuthenticated],
        read: [Permissions.IsAuthenticated, canAccessSkill],
        update: [Permissions.IsAuthenticated, canAccessSkill],
      },
      preCreate: (body, req: express.Request) => {
        const user = req.user as SkillUser | undefined;
        const {description, instructions, name, scope} = body as Partial<GptSkillDocument>;
        if (scope === "global") {
          if (!user?.admin) {
            throw new APIError({status: 403, title: "Only admins can create global skills"});
          }
          return {description, instructions, name, scope: "global"} as GptSkillDocument;
        }
        return {
          description,
          instructions,
          name,
          scope: "user",
          userId: user?._id,
        } as GptSkillDocument;
      },
      preUpdate: (body) => {
        const update: Record<string, unknown> = {};
        for (const field of UPDATABLE_FIELDS) {
          const value = (body as Record<string, unknown>)[field];
          if (value !== undefined) {
            update[field] = value;
          }
        }
        return update as unknown as GptSkillDocument;
      },
      queryFields: ["name", "scope", "enabled"],
      queryFilter: (user?: {id?: string}) => ({
        $or: [{scope: "global"}, {scope: "user", userId: user?.id}],
      }),
      responseHandler: async (value, method) =>
        (Array.isArray(value)
          ? value.map((doc) => serializeSkill(doc, method))
          : serializeSkill(value, method)) as JSONValue,
      sort: "name",
    })
  );
};
