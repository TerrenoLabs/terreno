/**
 * Admin windowed sync write authorization: REST and `POST /sync/mutate` with
 * `mutationMode: "adminWindow"` must enforce the same AdminApp semantics.
 */
import {afterEach, beforeEach, describe, expect, it} from "bun:test";
import {
  ADMIN_MODEL_ACCESS,
  addAuthRoutes,
  apiErrorMiddleware,
  apiUnauthorizedMiddleware,
  clearSyncRegistry,
  createAccess,
  createdUpdatedPlugin,
  findOneOrNoneFor,
  isDeletedPlugin,
  Membership,
  Organization,
  orgScopedPlugin,
  type PermissionSet,
  Permissions,
  registerSync,
  SyncApp,
  setupAuth,
  syncPlugin,
  terrenoStatements,
  type User,
  type UserModel as UserModelType,
} from "@terreno/api";
import {authAsUser, getBaseServer, setupDb, UserModel} from "@terreno/api/testing";
import {assert} from "chai";
import type express from "express";
import mongoose from "mongoose";
import type TestAgent from "supertest/lib/agent";

import type {AdminAuditEvent, AdminModelConfig} from "./adminApp";
import {AdminApp, adminOwnedBy} from "./adminApp";

interface WindowTodo {
  _id: string;
  ownerId: string;
  title: string;
  protectedLabel?: string;
  _syncSeq?: number;
}

const windowTodoSchema = new mongoose.Schema<WindowTodo>({
  _id: {
    default: (): string => new mongoose.Types.ObjectId().toHexString(),
    description: "Client-minted string id",
    type: String,
  },
  ownerId: {description: "Owner user id", required: true, type: String},
  protectedLabel: {description: "Admin readonly label", type: String},
  title: {description: "Todo title", required: true, type: String},
});
windowTodoSchema.plugin(isDeletedPlugin);
windowTodoSchema.plugin(createdUpdatedPlugin);
windowTodoSchema.plugin(syncPlugin);

const WindowTodoModel =
  mongoose.models.WindowTodo ?? mongoose.model<WindowTodo>("WindowTodo", windowTodoSchema);

const windowTodoAdminConfig: AdminModelConfig = {
  adminAccess: {isOwned: adminOwnedBy("ownerId")},
  displayName: "Window todos",
  listFields: ["title", "ownerId", "protectedLabel"],
  model: WindowTodoModel,
  permissions: {delete: false, update: true},
  readonlyFields: ["protectedLabel"],
  routePath: "/window-todos",
};

const productSyncOptions = {
  permissions: {
    create: [Permissions.IsAuthenticated],
    delete: [Permissions.IsAuthenticated],
    list: [Permissions.IsAuthenticated],
    read: [Permissions.IsAuthenticated],
    update: [Permissions.IsOwner],
  },
  preCreate: (body: Record<string, unknown>, req: express.Request): Record<string, unknown> => ({
    ...body,
    ownerId: String((req.user as {id?: string} | undefined)?.id ?? body.ownerId),
  }),
  sync: {adminBroadcast: true, scope: {type: "owner" as const}},
};

const buildHarness = ({
  adminModelOverrides,
  grants,
  onAdminAudit,
  productHookTracker,
  resolvePermissions,
}: {
  adminModelOverrides?: Partial<AdminModelConfig>;
  grants: Record<string, string[]>;
  onAdminAudit?: (event: AdminAuditEvent) => void | Promise<void>;
  productHookTracker?: {postUpdateCalls: number; preCreateCalls: number; preUpdateCalls: number};
  resolvePermissions?: (args: {user: User}) => Promise<Record<string, string[]>>;
}): express.Application => {
  clearSyncRegistry();
  registerSync({
    config: {adminBroadcast: true, scope: {type: "owner"}},
    model: WindowTodoModel,
    options: {
      ...productSyncOptions,
      postUpdate: async (doc, cleanedBody, request, prevDoc) => {
        if (productHookTracker) {
          productHookTracker.postUpdateCalls++;
        }
        void doc;
        void cleanedBody;
        void request;
        void prevDoc;
      },
      preCreate: (body, req) => {
        if (productHookTracker) {
          productHookTracker.preCreateCalls++;
        }
        return productSyncOptions.preCreate(body as Record<string, unknown>, req);
      },
      preUpdate: (body, _req) => {
        if (productHookTracker) {
          productHookTracker.preUpdateCalls++;
        }
        return body as Record<string, unknown>;
      },
    },
    routePath: "/window-todos",
  });

  const accessControl = createAccess({
    connection: mongoose.connection,
    resolvePermissions:
      resolvePermissions ??
      (async ({user}) => {
        if (user?.admin) {
          return grants;
        }
        return {};
      }),
    statements: {...terrenoStatements, adminWindowTodo: ADMIN_MODEL_ACCESS},
  });

  const app = getBaseServer();
  setupAuth(app, UserModel as unknown as UserModelType);
  addAuthRoutes(app, UserModel as unknown as UserModelType);
  new AdminApp({
    accessControl,
    basePath: "/admin",
    models: [
      {
        ...windowTodoAdminConfig,
        adminAccess: {
          isOwned: adminOwnedBy("ownerId"),
          resource: "adminWindowTodo",
        },
        ...adminModelOverrides,
      },
    ],
    onAdminAudit,
  }).register(app);
  new SyncApp({accessControl}).register(app);
  app.use(apiUnauthorizedMiddleware);
  app.use(apiErrorMiddleware);
  return app;
};

const adminWindowMutate = (body: Record<string, unknown>): Record<string, unknown> => ({
  ...body,
  mutationMode: "adminWindow",
});

describe("admin window sync mutation authorization", () => {
  let agent: TestAgent;
  let actorId: string;
  let otherOwnerId: string;

  beforeEach(async () => {
    await setupDb();
    otherOwnerId = new mongoose.Types.ObjectId().toHexString();
    const app = buildHarness({
      grants: {admin: ["access"], adminWindowTodo: ["read", "writeOwned"]},
    });
    agent = await authAsUser(app, "admin");
    const actor = await findOneOrNoneFor(UserModel, {email: "admin@example.com"});
    assert.exists(actor);
    actorId = String(actor?._id);
  });

  afterEach(async () => {
    clearSyncRegistry();
    await WindowTodoModel.deleteMany({});
  });

  it("REST PATCH and admin-window sync both deny writeOwned update on another owner's row", async () => {
    const owned = await WindowTodoModel.create({
      ownerId: actorId,
      protectedLabel: "mine",
      title: "Owned",
    });
    const other = await WindowTodoModel.create({
      ownerId: otherOwnerId,
      protectedLabel: "theirs",
      title: "Other",
    });

    await agent.patch(`/admin/window-todos/${other._id}`).send({title: "REST blocked"}).expect(403);

    const syncRes = await agent
      .post("/sync/mutate")
      .send(
        adminWindowMutate({
          baseVersion: other._syncSeq ?? 1,
          collection: "window-todos",
          data: {title: "Sync blocked"},
          id: other._id,
          mutationId: "admin-writeowned-deny",
          operation: "update",
        })
      )
      .expect(403);

    expect(syncRes.body.nack.code).toBe("unauthorized");
    const reloaded = await WindowTodoModel.findById(other._id).lean();
    expect(reloaded?.title).toBe("Other");

    await agent.patch(`/admin/window-todos/${owned._id}`).send({title: "REST ok"}).expect(200);
  });

  it("REST PATCH and admin-window sync both strip readonlyFields", async () => {
    const row = await WindowTodoModel.create({
      ownerId: actorId,
      protectedLabel: "keep-me",
      title: "Before",
    });

    await agent
      .patch(`/admin/window-todos/${row._id}`)
      .send({protectedLabel: "REST stripped", title: "After REST"})
      .expect(200);

    const afterRest = await WindowTodoModel.findById(row._id).lean();
    expect(afterRest?.protectedLabel).toBe("keep-me");
    expect(afterRest?.title).toBe("After REST");

    const syncRes = await agent
      .post("/sync/mutate")
      .send(
        adminWindowMutate({
          baseVersion: afterRest?._syncSeq ?? 2,
          collection: "window-todos",
          data: {protectedLabel: "Sync stripped", title: "After sync"},
          id: row._id,
          mutationId: "admin-readonly-strip",
          operation: "update",
        })
      )
      .expect(200);

    expect(syncRes.body.ack.mutationId).toBe("admin-readonly-strip");
    const afterSync = await WindowTodoModel.findById(row._id).lean();
    expect(afterSync?.protectedLabel).toBe("keep-me");
    expect(afterSync?.title).toBe("After sync");
  });

  it("REST DELETE disabled and admin-window sync delete both return unauthorized", async () => {
    const row = await WindowTodoModel.create({
      ownerId: actorId,
      title: "To delete",
    });

    const restDelete = await agent.delete(`/admin/window-todos/${row._id}`);
    expect([403, 405]).toContain(restDelete.status);

    const syncRes = await agent
      .post("/sync/mutate")
      .send(
        adminWindowMutate({
          collection: "window-todos",
          id: row._id,
          mutationId: "admin-delete-disabled",
          operation: "delete",
        })
      )
      .expect(403);

    expect(syncRes.body.nack.code).toBe("unauthorized");
    const stillThere = await WindowTodoModel.findById(row._id).lean();
    expect(stillThere?.deleted).not.toBe(true);
  });

  it("onAdminAudit fires for REST PATCH and admin-window sync update", async () => {
    const auditEvents: AdminAuditEvent[] = [];
    const app = buildHarness({
      grants: {admin: ["access"], adminWindowTodo: ["read", "write"]},
      onAdminAudit: async (event) => {
        auditEvents.push(event);
      },
    });
    const writer = await authAsUser(app, "admin");
    const row = await WindowTodoModel.create({
      ownerId: actorId,
      title: "Audited",
    });

    await writer.patch(`/admin/window-todos/${row._id}`).send({title: "REST audit"}).expect(200);
    expect(auditEvents.filter((event) => event.verb === "updated")).toHaveLength(1);

    const current = await WindowTodoModel.findById(row._id).lean();
    await writer
      .post("/sync/mutate")
      .send(
        adminWindowMutate({
          baseVersion: current?._syncSeq ?? 2,
          collection: "window-todos",
          data: {title: "Sync audit"},
          id: row._id,
          mutationId: "admin-sync-audit",
          operation: "update",
        })
      )
      .expect(200);

    expect(auditEvents.filter((event) => event.verb === "updated")).toHaveLength(2);
  });

  it("rejects admin-window marker spoofing from a non-admin product user", async () => {
    const app = buildHarness({
      grants: {admin: ["access"], adminWindowTodo: ["read", "write"]},
    });
    const stranger = await authAsUser(app, "notAdmin");
    const row = await WindowTodoModel.create({
      ownerId: otherOwnerId,
      title: "Protected",
    });

    const syncRes = await stranger
      .post("/sync/mutate")
      .send(
        adminWindowMutate({
          baseVersion: row._syncSeq ?? 1,
          collection: "window-todos",
          data: {title: "Spoofed"},
          id: row._id,
          mutationId: "spoof-admin-window",
          operation: "update",
        })
      )
      .expect(403);

    expect(syncRes.body.nack.code).toBe("unauthorized");
    const reloaded = await WindowTodoModel.findById(row._id).lean();
    expect(reloaded?.title).toBe("Protected");
  });

  it("product sync path without admin-window marker keeps IsOwner semantics", async () => {
    const app = buildHarness({
      grants: {admin: ["access"], adminWindowTodo: ["read", "write"]},
    });
    const productUser = await authAsUser(app, "notAdmin");
    const row = await WindowTodoModel.create({
      ownerId: otherOwnerId,
      title: "Product path",
    });

    const syncRes = await productUser
      .post("/sync/mutate")
      .send({
        baseVersion: row._syncSeq ?? 1,
        collection: "window-todos",
        data: {title: "Product denied"},
        id: row._id,
        mutationId: "product-isowner-deny",
        operation: "update",
      })
      .expect(403);

    expect(syncRes.body.nack.code).toBe("unauthorized");
    const reloaded = await WindowTodoModel.findById(row._id).lean();
    expect(reloaded?.title).toBe("Product path");
  });

  it("admin-window sync does not run product pre/post hooks", async () => {
    const tracker = {postUpdateCalls: 0, preCreateCalls: 0, preUpdateCalls: 0};
    const app = buildHarness({
      grants: {admin: ["access"], adminWindowTodo: ["read", "write"]},
      productHookTracker: tracker,
    });
    const writer = await authAsUser(app, "admin");
    const row = await WindowTodoModel.create({
      ownerId: actorId,
      title: "Hook isolation",
    });

    await writer
      .post("/sync/mutate")
      .send(
        adminWindowMutate({
          baseVersion: row._syncSeq ?? 1,
          collection: "window-todos",
          data: {title: "Admin hooks only"},
          id: row._id,
          mutationId: "admin-hook-isolation",
          operation: "update",
        })
      )
      .expect(200);

    expect(tracker.preCreateCalls).toBe(0);
    expect(tracker.preUpdateCalls).toBe(0);
    expect(tracker.postUpdateCalls).toBe(0);
  });

  it("product sync without admin-window marker still runs product preUpdate", async () => {
    const tracker = {postUpdateCalls: 0, preCreateCalls: 0, preUpdateCalls: 0};
    const app = buildHarness({
      grants: {admin: ["access"], adminWindowTodo: ["read", "write"]},
      productHookTracker: tracker,
    });
    const owner = await authAsUser(app, "notAdmin");
    const ownerDoc = await findOneOrNoneFor(UserModel, {email: "notAdmin@example.com"});
    assert.exists(ownerDoc);
    const ownerUserId = String(ownerDoc?._id);
    const row = await WindowTodoModel.create({
      ownerId: ownerUserId,
      title: "Owned",
    });

    await owner
      .post("/sync/mutate")
      .send({
        baseVersion: row._syncSeq ?? 1,
        collection: "window-todos",
        data: {title: "Product hook ok"},
        id: row._id,
        mutationId: "product-preupdate-runs",
        operation: "update",
      })
      .expect(200);

    expect(tracker.preUpdateCalls).toBe(1);
    expect(tracker.postUpdateCalls).toBe(1);
    expect(tracker.preCreateCalls).toBe(0);
  });

  it("admin-window sync update invokes AdminApp post hooks for audit", async () => {
    const auditEvents: AdminAuditEvent[] = [];
    const app = buildHarness({
      grants: {admin: ["access"], adminWindowTodo: ["read", "write"]},
      onAdminAudit: async (event) => {
        auditEvents.push(event);
      },
    });
    const writer = await authAsUser(app, "admin");
    const row = await WindowTodoModel.create({
      ownerId: actorId,
      title: "Post hook audit",
    });

    await writer
      .post("/sync/mutate")
      .send(
        adminWindowMutate({
          baseVersion: row._syncSeq ?? 1,
          collection: "window-todos",
          data: {title: "Audited via post hook"},
          id: row._id,
          mutationId: "admin-post-hook-audit",
          operation: "update",
        })
      )
      .expect(200);

    expect(auditEvents).toHaveLength(1);
    expect(auditEvents[0]?.verb).toBe("updated");
    expect(auditEvents[0]?.actorId).toBe(actorId);
  });
});

interface WindowOrgTodo {
  _id: string;
  organizationId: mongoose.Types.ObjectId;
  title: string;
  _syncSeq?: number;
}

const windowOrgTodoSchema = new mongoose.Schema<WindowOrgTodo>({
  _id: {
    default: (): string => new mongoose.Types.ObjectId().toHexString(),
    description: "Client-minted string id",
    type: String,
  },
  title: {description: "Todo title", required: true, type: String},
});
windowOrgTodoSchema.plugin(orgScopedPlugin);
windowOrgTodoSchema.plugin(isDeletedPlugin);
windowOrgTodoSchema.plugin(createdUpdatedPlugin);
windowOrgTodoSchema.plugin(syncPlugin);

const WindowOrgTodoModel =
  mongoose.models.WindowOrgTodo ??
  mongoose.model<WindowOrgTodo>("WindowOrgTodo", windowOrgTodoSchema);

const buildOrgWindowHarness = (): express.Application => {
  clearSyncRegistry();
  registerSync({
    config: {adminBroadcast: true, scope: {field: "organizationId", type: "tenant"}},
    model: WindowOrgTodoModel,
    options: {
      permissions: {
        create: [Permissions.IsAuthenticated],
        delete: [Permissions.IsAuthenticated],
        list: [Permissions.IsAuthenticated],
        read: [Permissions.IsAuthenticated],
        update: [Permissions.IsAuthenticated],
      },
      sync: {adminBroadcast: true, scope: {field: "organizationId", type: "tenant" as const}},
    },
    routePath: "/window-org-todos",
  });

  const accessControl = createAccess({
    connection: mongoose.connection,
    organizations: true,
    resolvePermissions: async ({user}): Promise<PermissionSet> => {
      if (user?.admin) {
        return {admin: ["access"], adminWindowOrgTodo: ["read", "write"]};
      }
      return {};
    },
    statements: {...terrenoStatements, adminWindowOrgTodo: ADMIN_MODEL_ACCESS},
    userModel: UserModel as unknown as UserModelType,
  });

  const app = getBaseServer();
  setupAuth(app, UserModel as unknown as UserModelType);
  addAuthRoutes(app, UserModel as unknown as UserModelType);
  new AdminApp({
    accessControl,
    basePath: "/admin",
    models: [
      {
        adminAccess: {resource: "adminWindowOrgTodo"},
        displayName: "Window org todos",
        listFields: ["title", "organizationId"],
        model: WindowOrgTodoModel,
        routePath: "/window-org-todos",
      },
    ],
    organizations: true,
  }).register(app);
  new SyncApp({accessControl}).register(app);
  app.use(apiUnauthorizedMiddleware);
  app.use(apiErrorMiddleware);
  return app;
};

describe("admin window org-scoped mutation membership", () => {
  let agent: TestAgent;
  let firstOrgId: string;
  let secondOrgId: string;

  beforeEach(async () => {
    const [admin] = await setupDb();
    admin.roles = ["operator"];
    await admin.save();
    await Promise.all([
      Membership.deleteMany({}),
      Organization.deleteMany({}),
      WindowOrgTodoModel.deleteMany({}),
    ]);
    const app = buildOrgWindowHarness();
    agent = await authAsUser(app, "admin");
    const [firstOrg, secondOrg] = await Organization.create([
      {name: "First Org", ownerId: admin._id},
      {name: "Second Org", ownerId: admin._id},
    ]);
    firstOrgId = String(firstOrg._id);
    secondOrgId = String(secondOrg._id);
  });

  afterEach(async () => {
    clearSyncRegistry();
    await WindowOrgTodoModel.deleteMany({});
  });

  it("REST PATCH denies another org's row; admin-window sync is disabled for org-scoped models", async () => {
    const other = await WindowOrgTodoModel.create({
      organizationId: secondOrgId,
      title: "Other org",
    });

    await agent
      .patch(`/admin/window-org-todos/${other._id}`)
      .set("X-Organization-Id", firstOrgId)
      .send({title: "REST blocked"})
      .expect(403);

    const syncRes = await agent
      .post("/sync/mutate")
      .set("X-Organization-Id", firstOrgId)
      .send(
        adminWindowMutate({
          baseVersion: other._syncSeq ?? 1,
          collection: "window-org-todos",
          data: {title: "Sync blocked"},
          id: other._id,
          mutationId: "admin-org-membership-deny",
          operation: "update",
        })
      )
      .expect(403);

    expect(JSON.stringify(syncRes.body)).toContain("adminBroadcast");
    const reloaded = await WindowOrgTodoModel.findById(other._id).lean();
    expect(reloaded?.title).toBe("Other org");
  });

  it("REST PATCH allows update of the current org's row; admin-window sync stays disabled", async () => {
    const owned = await WindowOrgTodoModel.create({
      organizationId: firstOrgId,
      title: "Same org",
    });

    await agent
      .patch(`/admin/window-org-todos/${owned._id}`)
      .set("X-Organization-Id", firstOrgId)
      .send({title: "REST ok"})
      .expect(200);

    const afterRest = await WindowOrgTodoModel.findById(owned._id).lean();
    expect(afterRest?.title).toBe("REST ok");

    const syncRes = await agent
      .post("/sync/mutate")
      .set("X-Organization-Id", firstOrgId)
      .send(
        adminWindowMutate({
          baseVersion: afterRest?._syncSeq ?? 2,
          collection: "window-org-todos",
          data: {title: "Sync ok"},
          id: owned._id,
          mutationId: "admin-org-membership-allow",
          operation: "update",
        })
      )
      .expect(403);

    expect(JSON.stringify(syncRes.body)).toContain("adminBroadcast");
    const afterSyncAttempt = await WindowOrgTodoModel.findById(owned._id).lean();
    expect(afterSyncAttempt?.title).toBe("REST ok");
  });
});

describe("admin window sync mutation row scope", () => {
  let agent: TestAgent;
  let actorId: string;
  let otherOwnerId: string;

  beforeEach(async () => {
    await setupDb();
    otherOwnerId = new mongoose.Types.ObjectId().toHexString();
    const app = buildHarness({
      adminModelOverrides: {
        permissions: {delete: true, update: true},
        queryFilter: (user, query): Record<string, unknown> => ({
          ...(query ?? {}),
          ownerId: String(user?.id),
        }),
      },
      grants: {admin: ["access"], adminWindowTodo: ["read", "write"]},
    });
    agent = await authAsUser(app, "admin");
    const actor = await findOneOrNoneFor(UserModel, {email: "admin@example.com"});
    actorId = String(actor?._id);
  });

  afterEach(async () => {
    clearSyncRegistry();
    await WindowTodoModel.deleteMany({});
  });

  it("nacks update and delete of rows outside the AdminApp row scope", async () => {
    const theirs = await WindowTodoModel.create({ownerId: otherOwnerId, title: "Theirs"});
    const theirsToo = await WindowTodoModel.create({ownerId: otherOwnerId, title: "TheirsToo"});

    const updateRes = await agent
      .post("/sync/mutate")
      .send(
        adminWindowMutate({
          baseVersion: theirs._syncSeq ?? 1,
          collection: "window-todos",
          data: {title: "overwritten"},
          id: theirs._id,
          mutationId: "admin-row-scope-update",
          operation: "update",
        })
      )
      .expect(403);
    expect(updateRes.body.nack.code).toBe("unauthorized");

    await agent
      .post("/sync/mutate")
      .send(
        adminWindowMutate({
          collection: "window-todos",
          id: theirsToo._id,
          mutationId: "admin-row-scope-delete",
          operation: "delete",
        })
      )
      .expect(403);

    const batchRes = await agent
      .post("/sync/mutate/batch")
      .send({
        mutations: [
          adminWindowMutate({
            baseVersion: theirs._syncSeq ?? 1,
            collection: "window-todos",
            data: {title: "batch overwritten"},
            id: theirs._id,
            mutationId: "admin-row-scope-batch",
            operation: "update",
          }),
        ],
      })
      .expect(200);
    expect(batchRes.body.results[0].type).toBe("nack");

    const reloaded = await WindowTodoModel.findById(theirs._id).lean();
    expect(reloaded?.title).toBe("Theirs");
    const stillThere = await WindowTodoModel.findById(theirsToo._id).lean();
    expect(stillThere?.deleted).not.toBe(true);
  });

  it("acks in-scope writes and nacks an update that moves a row out of scope", async () => {
    const mine = await WindowTodoModel.create({ownerId: actorId, title: "Mine"});

    await agent
      .post("/sync/mutate")
      .send(
        adminWindowMutate({
          baseVersion: mine._syncSeq ?? 1,
          collection: "window-todos",
          data: {title: "Mine edited"},
          id: mine._id,
          mutationId: "admin-row-scope-own-update",
          operation: "update",
        })
      )
      .expect(200);

    const current = await WindowTodoModel.findById(mine._id).lean();
    await agent
      .post("/sync/mutate")
      .send(
        adminWindowMutate({
          baseVersion: current?._syncSeq ?? 2,
          collection: "window-todos",
          data: {ownerId: otherOwnerId},
          id: mine._id,
          mutationId: "admin-row-scope-move",
          operation: "update",
        })
      )
      .expect(403);

    const after = await WindowTodoModel.findById(mine._id).lean();
    expect(after?.ownerId).toBe(actorId);
    expect(after?.title).toBe("Mine edited");
  });
});
