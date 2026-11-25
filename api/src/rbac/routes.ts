import express from "express";

import {asyncHandler} from "../api";
import {authenticateMiddleware, type TerrenoUserModel, type User} from "../auth";
import {APIError} from "../errors";
import type {TerrenoPlugin} from "../terrenoPlugin";
import type {AnyTerrenoAccess} from "./types";

const pathParam = (value: string | string[] | undefined, title: string): string => {
  if (typeof value !== "string" || value.length === 0) {
    throw new APIError({status: 400, title});
  }
  return value;
};

export interface RbacRouterOptions {
  access: AnyTerrenoAccess;
  userModel: TerrenoUserModel;
  basePath?: string;
}

export const rbacRouter = ({
  access,
  userModel,
  basePath = "/rbac",
}: RbacRouterOptions): TerrenoPlugin => {
  return {
    register: (app: express.Application): void => {
      const router = express.Router();

      router.get(
        "/statements",
        authenticateMiddleware(),
        access.middleware({rbac: ["read"]}),
        asyncHandler(async (_req, res) => {
          return res.json({
            data: {
              statementDescriptions: access.statementDescriptions,
              statements: access.statements,
            },
          });
        })
      );

      router.get(
        "/roles",
        authenticateMiddleware(),
        access.middleware({rbac: ["read"]}),
        asyncHandler(async (_req, res) => {
          const roles = await access.roles.list();
          return res.json({data: roles});
        })
      );

      router.post(
        "/roles",
        authenticateMiddleware(),
        access.middleware({rbac: ["manageRoles"]}),
        asyncHandler(async (req, res) => {
          const actor = req.user;
          if (!actor) {
            throw new APIError({status: 401, title: "Unauthorized"});
          }
          const role = await access.roles.create({actor, role: req.body});
          return res.status(201).json({data: role});
        })
      );

      router.patch(
        "/roles/:name",
        authenticateMiddleware(),
        access.middleware({rbac: ["manageRoles"]}),
        asyncHandler(async (req, res) => {
          const actor = req.user;
          if (!actor) {
            throw new APIError({status: 401, title: "Unauthorized"});
          }
          const role = await access.roles.update({
            actor,
            changes: req.body,
            roleName: pathParam(req.params.name, "Role name is required"),
          });
          return res.json({data: role});
        })
      );

      router.delete(
        "/roles/:name",
        authenticateMiddleware(),
        access.middleware({rbac: ["manageRoles"]}),
        asyncHandler(async (req, res) => {
          const actor = req.user;
          if (!actor) {
            throw new APIError({status: 401, title: "Unauthorized"});
          }
          await access.roles.remove({
            actor,
            roleName: pathParam(req.params.name, "Role name is required"),
          });
          return res.status(204).send();
        })
      );

      router.post(
        "/roles/:name/preview",
        authenticateMiddleware(),
        access.middleware({rbac: ["manageRoles"]}),
        asyncHandler(async (req, res) => {
          const diff = await access.roles.previewRoleChange({
            permissions: req.body.permissions,
            roleName: pathParam(req.params.name, "Role name is required"),
          });
          return res.json({data: diff});
        })
      );

      router.get(
        "/users/:id/permissions",
        authenticateMiddleware(),
        access.middleware({rbac: ["read"]}),
        asyncHandler(async (req, res) => {
          const user = await userModel.findById(pathParam(req.params.id, "User id is required"));
          if (!user) {
            throw new APIError({status: 404, title: "User not found"});
          }
          const permissions = await access.getPermissions({
            user: user as never,
          });
          const withRoles = user as {roles?: string[]};
          return res.json({
            data: {
              permissions,
              roles: withRoles.roles ?? [],
            },
          });
        })
      );

      router.put(
        "/users/:id/roles",
        authenticateMiddleware(),
        access.middleware({rbac: ["assignRoles"]}),
        asyncHandler(async (req, res) => {
          const actor = req.user;
          if (!actor) {
            throw new APIError({status: 401, title: "Unauthorized"});
          }
          if (!Array.isArray(req.body.roleNames)) {
            throw new APIError({status: 400, title: "roleNames is required"});
          }
          await access.roles.assign({
            actor,
            roleNames: req.body.roleNames,
            userId: pathParam(req.params.id, "User id is required"),
          });
          return res.json({data: {success: true}});
        })
      );

      router.post(
        "/users/:id/roles/preview",
        authenticateMiddleware(),
        access.middleware({rbac: ["assignRoles"]}),
        asyncHandler(async (req, res) => {
          if (!Array.isArray(req.body.roleNames)) {
            throw new APIError({status: 400, title: "roleNames is required"});
          }
          const actor = req.user as User;
          const diff = await access.roles.previewAssignment({
            actor,
            roleNames: req.body.roleNames,
            userId: pathParam(req.params.id, "User id is required"),
          });
          return res.json({data: diff});
        })
      );

      app.use(basePath, router);
    },
  };
};
