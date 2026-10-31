import {afterEach, beforeEach, describe, expect, it} from "bun:test";
import {assert} from "chai";
import mongoose from "mongoose";

import {addAuthRoutes, setupAuth, type User, type UserModel as UserModelType} from "../auth";
import {Permissions} from "../permissions";
import {createdUpdatedPlugin, findOneOrNoneFor, isDeletedPlugin} from "../plugins";
import {authAsUser, getBaseServer, setupDb, UserModel} from "../tests";
import {
  auditActorIdFromRequest,
  buildAdminWindowExecutorOptions,
  clearAdminWindowMutationScopes,
  emitAdminWindowMutationAudit,
  getAdminWindowMutationScope,
  prepareAdminWindowMutation,
  registerAdminWindowMutationScope,
  withAdminWindowMutationRequestContext,
} from "./adminWindowMutation";
import {clearSyncRegistry, findSyncEntryByCollectionTag, registerSync} from "./registry";
import {syncPlugin} from "./syncSeqPlugin";

interface WindowTodo {
  _id: string;
  ownerId: string;
  title: string;
}

const windowTodoSchema = new mongoose.Schema<WindowTodo>({
  _id: {
    default: (): string => new mongoose.Types.ObjectId().toHexString(),
    type: String,
  },
  ownerId: {required: true, type: String},
  title: {required: true, type: String},
});
windowTodoSchema.plugin(isDeletedPlugin);
windowTodoSchema.plugin(createdUpdatedPlugin);
windowTodoSchema.plugin(syncPlugin);

const WindowTodoModel =
  mongoose.models.WindowTodo ?? mongoose.model<WindowTodo>("WindowTodo", windowTodoSchema);

const assertStatus = async (promise: Promise<unknown>, status: number): Promise<void> => {
  try {
    await promise;
    assert.fail(`Expected status ${status}`);
  } catch (error: unknown) {
    assert.equal((error as {status?: number}).status, status);
  }
};

describe("adminWindowMutation", () => {
  beforeEach(async () => {
    await setupDb();
    clearSyncRegistry();
    clearAdminWindowMutationScopes();
    registerSync({
      config: {adminBroadcast: true, scope: {type: "owner"}},
      model: WindowTodoModel,
      options: {
        permissions: {
          create: [Permissions.IsAuthenticated],
          delete: [Permissions.IsAuthenticated],
          list: [Permissions.IsAuthenticated],
          read: [Permissions.IsAuthenticated],
          update: [Permissions.IsOwner],
        },
        sync: {adminBroadcast: true, scope: {type: "owner"}},
      },
      routePath: "/window-todos",
    });
    registerAdminWindowMutationScope("WindowTodo", {
      createPermissions: [Permissions.IsAdmin],
      deletePermissions: [Permissions.IsAdmin],
      modelName: "WindowTodo",
      permissions: {create: true, delete: true, update: true},
      stripMutationData: (data) => {
        const next = {...data};
        delete next.ownerId;
        return next;
      },
      updatePermissions: [Permissions.IsAdmin],
    });
  });

  afterEach(async () => {
    clearSyncRegistry();
    await WindowTodoModel.deleteMany({});
  });

  const loadUser = async (type: "admin" | "notAdmin"): Promise<User> => {
    const app = getBaseServer();
    setupAuth(app, UserModel as unknown as UserModelType);
    addAuthRoutes(app, UserModel as unknown as UserModelType);
    await authAsUser(app, type);
    const email = type === "admin" ? "admin@example.com" : "notAdmin@example.com";
    const doc = await findOneOrNoneFor(UserModel, {email});
    expect(doc).toBeTruthy();
    return doc as unknown as User;
  };

  it("returns undefined for product mutations without a marker", async () => {
    const user = await loadUser("notAdmin");
    const entry = findSyncEntryByCollectionTag("window-todos");
    if (!entry) {
      throw new Error("expected window-todos sync entry");
    }
    const prepared = await prepareAdminWindowMutation({
      entry,
      mutation: {
        collection: "window-todos",
        data: {title: "x"},
        mutationId: "product",
        operation: "create",
      },
      req: {user} as never,
      user,
    });
    expect(prepared).toBeUndefined();
  });

  it("rejects admin-window marker from non-admin callers", async () => {
    const user = await loadUser("notAdmin");
    const entry = findSyncEntryByCollectionTag("window-todos");
    if (!entry) {
      throw new Error("expected window-todos sync entry");
    }
    await expect(
      prepareAdminWindowMutation({
        entry,
        mutation: {
          collection: "window-todos",
          data: {title: "x"},
          mutationId: "spoof",
          mutationMode: "adminWindow",
          operation: "create",
        },
        req: {user} as never,
        user,
      })
    ).rejects.toMatchObject({status: 403});
  });

  it("strips readonly fields for admin-window mutations", async () => {
    const user = await loadUser("admin");
    const entry = findSyncEntryByCollectionTag("window-todos");
    if (!entry) {
      throw new Error("expected window-todos sync entry");
    }
    const prepared = await prepareAdminWindowMutation({
      entry,
      mutation: {
        collection: "window-todos",
        data: {ownerId: "hijack", title: "ok"},
        mutationId: "strip",
        mutationMode: "adminWindow",
        operation: "create",
      },
      req: {user} as never,
      user,
    });
    expect(prepared?.mutation.data).toEqual({title: "ok"});
  });

  it("rejects admin-window mode when broadcast or AdminApp write scope is missing", async () => {
    const user = await loadUser("admin");
    const entry = findSyncEntryByCollectionTag("window-todos");
    assert.isDefined(entry);
    if (!entry) {
      return;
    }
    const mutation = {
      collection: "window-todos",
      data: {title: "x"},
      mutationId: "missing-scope",
      mutationMode: "adminWindow" as const,
      operation: "create" as const,
    };

    entry.config.adminBroadcast = false;
    await assertStatus(
      prepareAdminWindowMutation({entry, mutation, req: {user} as never, user}),
      403
    );
    entry.config.adminBroadcast = true;
    clearAdminWindowMutationScopes();
    assert.isUndefined(getAdminWindowMutationScope("WindowTodo"));
    await assertStatus(
      prepareAdminWindowMutation({entry, mutation, req: {user} as never, user}),
      403
    );
  });

  it("enforces enabled operations, required ids, instance existence, and permissions", async () => {
    const user = await loadUser("admin");
    const entry = findSyncEntryByCollectionTag("window-todos");
    const scope = getAdminWindowMutationScope("WindowTodo");
    assert.isDefined(entry);
    assert.isDefined(scope);
    if (!entry || !scope) {
      return;
    }

    for (const operation of ["create", "update", "delete"] as const) {
      registerAdminWindowMutationScope("WindowTodo", {
        ...scope,
        permissions: {...scope.permissions, [operation]: false},
      });
      await assertStatus(
        prepareAdminWindowMutation({
          entry,
          mutation: {
            collection: "window-todos",
            data: {title: "disabled"},
            ...(operation === "create" ? {} : {id: "todo-1"}),
            mutationId: `disabled-${operation}`,
            mutationMode: "adminWindow",
            operation,
          },
          req: {user} as never,
          user,
        }),
        403
      );
      registerAdminWindowMutationScope("WindowTodo", scope);
    }

    for (const operation of ["update", "delete"] as const) {
      await assertStatus(
        prepareAdminWindowMutation({
          entry,
          mutation: {
            collection: "window-todos",
            mutationId: `missing-${operation}`,
            mutationMode: "adminWindow",
            operation,
          },
          req: {user} as never,
          user,
        }),
        400
      );
    }

    await assertStatus(
      prepareAdminWindowMutation({
        entry,
        mutation: {
          collection: "window-todos",
          data: {title: "missing"},
          id: "missing",
          mutationId: "missing-update",
          mutationMode: "adminWindow",
          operation: "update",
        },
        req: {user} as never,
        user,
      }),
      404
    );

    registerAdminWindowMutationScope("WindowTodo", {
      ...scope,
      createPermissions: [async () => false],
    });
    await assertStatus(
      prepareAdminWindowMutation({
        entry,
        mutation: {
          collection: "window-todos",
          data: {title: "denied"},
          mutationId: "denied",
          mutationMode: "adminWindow",
          operation: "create",
        },
        req: {user} as never,
        user,
      }),
      403
    );
  });

  it("prepares update and delete against the loaded admin instance", async () => {
    const user = await loadUser("admin");
    const entry = findSyncEntryByCollectionTag("window-todos");
    assert.isDefined(entry);
    if (!entry) {
      return;
    }
    await WindowTodoModel.create({_id: "todo-1", ownerId: "owner", title: "before"});

    const update = await prepareAdminWindowMutation({
      entry,
      mutation: {
        collection: "window-todos",
        data: {ownerId: "hijack", title: "after"},
        id: "todo-1",
        mutationId: "update",
        mutationMode: "adminWindow",
        operation: "update",
      },
      req: {user} as never,
      user,
    });
    const remove = await prepareAdminWindowMutation({
      entry,
      mutation: {
        collection: "window-todos",
        id: "todo-1",
        mutationId: "delete",
        mutationMode: "adminWindow",
        operation: "delete",
      },
      req: {user} as never,
      user,
    });

    assert.deepEqual(update?.mutation.data, {title: "after"});
    assert.equal(remove?.mutation.operation, "delete");
  });

  it("emits create, update, and delete audit events with the request actor", async () => {
    const events: Array<{actorId?: string; recordId?: string; verb: string}> = [];
    const scope = getAdminWindowMutationScope("WindowTodo");
    assert.isDefined(scope);
    if (!scope) {
      return;
    }
    const auditScope = {
      ...scope,
      emitAudit: ({event}: {event: {actorId?: string; recordId?: string; verb: string}}): void => {
        events.push(event);
      },
    };
    const doc = await WindowTodoModel.create({
      _id: "audit-1",
      ownerId: "owner",
      title: "Audited",
    });
    const req = {user: {id: "admin-1"}} as never;

    for (const operation of ["create", "update", "delete"] as const) {
      await emitAdminWindowMutationAudit({
        doc,
        mutation: {
          collection: "window-todos",
          id: "audit-1",
          mutationId: `audit-${operation}`,
          mutationMode: "adminWindow",
          operation,
        },
        req,
        scope: auditScope,
      });
    }
    await emitAdminWindowMutationAudit({
      doc,
      mutation: {
        collection: "window-todos",
        mutationId: "no-audit",
        mutationMode: "adminWindow",
        operation: "create",
      },
      req,
      scope,
    });

    assert.deepEqual(
      events.map(({actorId, recordId, verb}) => ({actorId, recordId, verb})),
      [
        {actorId: "admin-1", recordId: "audit-1", verb: "created"},
        {actorId: "admin-1", recordId: "audit-1", verb: "updated"},
        {actorId: "admin-1", recordId: "audit-1", verb: "deleted"},
      ]
    );
  });

  it("auditActorIdFromRequest coalesces req.user._id when id is absent", () => {
    expect(auditActorIdFromRequest({user: {id: "from-id"}} as never)).toBe("from-id");
    expect(auditActorIdFromRequest({user: {_id: "from-underscore-id"}} as never)).toBe(
      "from-underscore-id"
    );
    expect(auditActorIdFromRequest({user: {_id: "fallback", id: "preferred"}} as never)).toBe(
      "preferred"
    );
  });

  it("builds AdminApp executor hooks without losing non-hook product options", () => {
    const productPreCreate = async (body: unknown): Promise<unknown> => body;
    const adminPreCreate = async (body: unknown): Promise<unknown> => body;
    const adminPostDelete = async (): Promise<void> => {};
    const scope = getAdminWindowMutationScope("WindowTodo");
    assert.isDefined(scope);
    if (!scope) {
      return;
    }
    const accessControl = {can: async () => ({allowed: true})} as never;
    const options = buildAdminWindowExecutorOptions({
      productOptions: {
        maxLimit: 123,
        permissions: {create: [], delete: [], list: [], read: [], update: []},
        preCreate: productPreCreate,
        preUpdate: productPreCreate,
      },
      scope: {
        ...scope,
        accessControl,
        postDelete: adminPostDelete,
        preCreate: adminPreCreate,
      },
    });

    assert.equal(options.maxLimit, 123);
    assert.strictEqual(options.accessControl, accessControl);
    assert.strictEqual(options.preCreate, adminPreCreate);
    assert.isUndefined(options.preUpdate);
    assert.strictEqual(options.postDelete, adminPostDelete);
  });

  it("adds the mutation id to request params only for instance operations", () => {
    const request = {params: {existing: "value"}} as never;
    const createRequest = withAdminWindowMutationRequestContext({
      mutation: {
        collection: "window-todos",
        mutationId: "create-context",
        operation: "create",
      },
      req: request,
    });
    assert.strictEqual(createRequest, request);

    const updateRequest = withAdminWindowMutationRequestContext({
      mutation: {
        collection: "window-todos",
        id: "todo-1",
        mutationId: "update-context",
        operation: "update",
      },
      req: request,
    });
    assert.strictEqual(updateRequest, request);
    assert.deepEqual(updateRequest.params, {existing: "value", id: "todo-1"});
  });

  it("resolves audit actors from id, _id, or an absent user", () => {
    assert.equal(auditActorIdFromRequest({user: {id: 42}} as never), "42");
    assert.equal(auditActorIdFromRequest({user: {_id: 43}} as never), "43");
    assert.isUndefined(auditActorIdFromRequest({} as never));
    assert.isUndefined(auditActorIdFromRequest({user: {}} as never));
  });
});
