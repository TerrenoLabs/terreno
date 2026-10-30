import {
  APIError,
  type JSONValue,
  modelRouter,
  type PermissionMethod,
  Permissions,
} from "@terreno/api";
import type express from "express";
import type mongoose from "mongoose";

import {GptSkill, setSkillFileStorage} from "../models/gptSkill";
import type {FileStorageService} from "../service/fileStorage";
import type {GptSkillDocument} from "../types/skills";

interface SkillRouteOptions {
  fileStorageService?: Pick<FileStorageService, "delete">;
  openApiOptions?: Record<string, unknown>;
}

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

export const addSkillRoutes = (router: express.Router, options?: SkillRouteOptions): void => {
  if (options?.fileStorageService) {
    setSkillFileStorage(options.fileStorageService);
  }

  router.use(
    "/gpt/skills",
    modelRouter(GptSkill, {
      ...options?.openApiOptions,
      audit: true,
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
