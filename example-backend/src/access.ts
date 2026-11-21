import {mcpAdminStatements} from "@terreno/admin-backend";
import {
  ADMIN_MODEL_ACCESS,
  createAccess,
  OwnerScope,
  persistRbacAuditToAuditEvent,
  terrenoStatements,
} from "@terreno/api";
import mongoose from "mongoose";

import {User} from "./models/user";
import {appDefaultRoles} from "./rbacRoles";

export const appStatements = {
  ...terrenoStatements,
  adminAuditEvent: ["list", "read"],
  adminAuditLog: ["list", "read"],
  ...mcpAdminStatements,
  adminProject: ADMIN_MODEL_ACCESS,
  adminScreen: ["showcase", "syncLab"],
  adminTodo: ADMIN_MODEL_ACCESS,
  adminUser: ADMIN_MODEL_ACCESS,
  // Sign off clinic.intakeSummary approvals (granted by the clinician role).
  clinicalIntake: ["signoff"],
  todo: ["create", "read", "update", "delete", "list"],
} as const;

/** Optional labels for permissions this app adds on top of the framework vocabulary. */
const appStatementDescriptions = {
  adminAuditEvent: {
    list: "List audit events in the admin panel",
    read: "View an audit event in the admin panel",
  },
  adminAuditLog: {
    list: "List the audit log in the admin panel",
    read: "View an audit log entry in the admin panel",
  },
  adminMcpOAuthClient: {
    read: "View MCP OAuth clients in the admin panel",
    write: "Create and update any MCP OAuth client in the admin panel",
    writeOwned: "Create and update MCP OAuth clients you own in the admin panel",
  },
  adminMcpOAuthConnection: {
    read: "View MCP OAuth connections in the admin panel",
    write: "Create and update any MCP OAuth connection in the admin panel",
    writeOwned: "Create and update MCP OAuth connections you own in the admin panel",
  },
  adminMcpRequestLog: {
    read: "View MCP request logs in the admin panel",
    write: "Create and update any MCP request log in the admin panel",
    writeOwned: "Create and update MCP request logs you own in the admin panel",
  },
  adminMcpServiceToken: {
    read: "View MCP service tokens in the admin panel",
    write: "Create and update any MCP service token in the admin panel",
    writeOwned: "Create and update MCP service tokens you own in the admin panel",
  },
  adminMcpTool: {
    read: "View MCP tools in the admin panel",
    write: "Create and update any MCP tool in the admin panel",
    writeOwned: "Create and update MCP tools you own in the admin panel",
  },
  adminProject: {
    read: "View projects in the admin panel",
    write: "Create and update any project in the admin panel",
    writeOwned: "Create and update projects you own in the admin panel",
  },
  adminScreen: {
    showcase: "Open the UI showcase screen",
    syncLab: "Open the sync lab screen",
  },
  adminTodo: {
    read: "View todos in the admin panel",
    write: "Create and update any todo in the admin panel",
    writeOwned: "Create and update todos you own in the admin panel",
  },
  adminUser: {
    read: "View users in the admin panel",
    write: "Create and update any user in the admin panel",
    writeOwned: "Create and update users you own in the admin panel",
  },
  clinicalIntake: {
    signoff: "Sign off an AI intake summary before it is filed",
  },
  todo: {
    create: "Create a todo",
    delete: "Delete a todo",
    list: "List todos",
    read: "View a todo",
    update: "Update a todo",
  },
} as const;

export const access = createAccess({
  auditSink: persistRbacAuditToAuditEvent,
  connection: mongoose.connection,
  defaultRoles: appDefaultRoles,
  organizations: true,
  scopes: {
    "todo.delete": OwnerScope(),
    "todo.list": OwnerScope(),
    "todo.read": OwnerScope(),
    "todo.update": OwnerScope(),
  },
  statementDescriptions: appStatementDescriptions,
  statements: appStatements,
  userModel: User as unknown as import("@terreno/api").UserModel,
});
