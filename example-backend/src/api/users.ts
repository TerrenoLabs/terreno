import {
  APIError,
  changeUserPassword,
  type JSONValue,
  modelRouter,
  Permissions,
  type User as TerrenoUser,
  z,
} from "@terreno/api";
import type {Document, Model} from "mongoose";
import {User} from "../models/user";
import type {UserDocument} from "../types/models/userTypes";

const setPasswordBodySchema = z
  .object({
    password: z.string().min(8),
  })
  .strict();

type SerializableUser = UserDocument | (Document & UserDocument);

const serializeUser = (doc: SerializableUser): Record<string, unknown> => {
  const obj = doc.toObject ? doc.toObject() : doc;
  const {hash, salt, ...rest} = obj as Record<string, unknown> & {hash?: unknown; salt?: unknown};
  return rest;
};

export const usersRouter = modelRouter("/users", User as unknown as Model<UserDocument>, {
  admin: {
    adminAccess: {},
    defaultSort: "-created",
    displayName: "Users",
    fieldsets: [
      {fields: ["email", "name"], title: "Profile"},
      {fields: ["admin", "roles", "oauthProvider"], title: "Access"},
    ],
    filters: [{field: "admin", kind: "boolean", label: "Admin user"}],
    group: "Demo: shared app data",
    hiddenFields: ["hash", "salt"],
    listDisplayLinks: ["email"],
    listFields: ["email", "name", "admin", "emailVerified", "created"],
    pageSize: 50,
    readonlyFields: ["email"],
    recordTitleField: "name",
    searchFields: ["email", "name"],
    sortableFields: ["email", "name", "admin", "created"],
  },
  instanceActions: {
    password: {
      body: setPasswordBodySchema,
      handler: async ({body, doc, req, user}) => {
        const password = (body as z.infer<typeof setPasswordBodySchema>).password;
        if (!password.trim() || password.trim().length < 8) {
          throw new APIError({status: 400, title: "Password must be at least 8 characters"});
        }
        const admin = user as {_id?: unknown; id?: string} | undefined;
        // Ends the user's refresh tokens, MCP credentials, and Better Auth sessions too.
        await changeUserPassword(doc as unknown as TerrenoUser, password, {
          adminId: admin?._id ?? admin?.id,
          app: req.app,
        });
        return {_id: doc._id.toString(), message: "Password updated"};
      },
      method: "POST",
      permissions: [Permissions.IsAdmin],
      response: z
        .object({
          _id: z.string(),
          message: z.string(),
        })
        .strict(),
      summary: "Set a user's password as an admin",
      tag: "admin-users",
    },
  },
  mcp: {
    excludeFields: ["hash", "salt", "attempts", "last"],
    methods: ["list", "read"],
  },
  permissions: {
    create: [Permissions.IsAdmin],
    delete: [Permissions.IsAdmin],
    list: [Permissions.IsAdmin],
    read: [Permissions.IsAdmin],
    update: [Permissions.IsAdmin],
  },
  queryFields: ["email", "name"],
  responseHandler: async (value): Promise<JSONValue> => {
    if (Array.isArray(value)) {
      return value.map(serializeUser) as JSONValue;
    }
    return serializeUser(value) as JSONValue;
  },
  sort: "-created",
});
