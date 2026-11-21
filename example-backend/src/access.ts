import {mcpAdminStatements} from "@terreno/admin-backend";
import {
  ADMIN_MODEL_ACCESS,
  adminModelDescriptions,
  createAccess,
  modelCrudDescriptions,
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
  adminMcpOAuthClient: adminModelDescriptions("MCP OAuth clients"),
  adminMcpOAuthConnection: adminModelDescriptions("MCP OAuth connections"),
  adminMcpRequestLog: adminModelDescriptions("MCP request logs"),
  adminMcpServiceToken: adminModelDescriptions("MCP service tokens"),
  adminMcpTool: adminModelDescriptions("MCP tools"),
  adminProject: adminModelDescriptions("projects"),
  adminScreen: {
    showcase: "Open the UI showcase screen",
    syncLab: "Open the sync lab screen",
  },
  adminTodo: adminModelDescriptions("todos"),
  adminUser: adminModelDescriptions("users"),
  clinicalIntake: {
    signoff: "Sign off an AI intake summary before it is filed",
  },
  todo: modelCrudDescriptions("todos"),
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
