import {
  APIError,
  authenticateMiddleware,
  getOrgContext,
  Membership,
  modelRouter,
  OrgQueryFilter,
  orgContextMiddleware,
  Permissions,
  type TerrenoPlugin,
} from "@terreno/api";
import type express from "express";
import {Project} from "../models/project";
import type {ProjectDocument} from "../types/models/projectTypes";

/**
 * Tenant-scoped sync example: every member of a project's organization shares the
 * same stream (`projects|tenant:{organizationId}`), resolved through the SyncApp's
 * `getUserScopes` callback (see server.ts).
 *
 * Access is gated by active Membership rows and request organization context.
 */
export const projectRouter = modelRouter("/projects", Project, {
  permissions: {
    create: [Permissions.IsAuthenticated, Permissions.IsOrganizationMember],
    delete: [Permissions.IsAuthenticated, Permissions.IsOrganizationMember],
    list: [Permissions.IsAuthenticated],
    read: [Permissions.IsAuthenticated, Permissions.IsOrganizationMember],
    update: [Permissions.IsAuthenticated, Permissions.IsOrganizationMember],
  },
  preCreate: async (body, req) => {
    const contextOrganizationId = getOrgContext()?.organization?._id;
    if (contextOrganizationId) {
      return {
        ...body,
        organizationId: String(contextOrganizationId),
      } as ProjectDocument;
    }
    const user = req.user;
    const userId = user?.id ?? (user?._id ? String(user._id) : undefined);
    if (!userId) {
      throw new APIError({
        status: 403,
        title: "Organization membership required",
      });
    }
    const memberships = await Membership.findActiveForUser(userId);
    const membershipIds = memberships.map((membership) => String(membership.organizationId));
    const requested = (body as Partial<ProjectDocument>)?.organizationId;
    const organizationId = requested ?? membershipIds[0];
    if (!organizationId || !membershipIds.includes(organizationId)) {
      throw new APIError({status: 403, title: "Organization membership required"});
    }
    return {
      ...body,
      organizationId,
    } as ProjectDocument;
  },
  queryFields: ["organizationId", "title"],
  queryFilter: OrgQueryFilter,
  sort: "-created",
  // Local-first sync (@terreno/syncdb): stream = projects|tenant:{organizationId}.
  sync: {scope: {field: "organizationId", type: "tenant"}},
  validation: {
    validateCreate: true,
    validateQuery: true,
    validateUpdate: true,
  },
});

/** Adds request organization context only to the tenant-scoped project routes. */
export const projectOrgContextPlugin: TerrenoPlugin = {
  register(app: express.Application): void {
    app.use("/projects", authenticateMiddleware(), orgContextMiddleware({required: true}));
  },
};
