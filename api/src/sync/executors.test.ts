import {beforeAll, beforeEach, describe, expect, it, mock} from "bun:test";
import {assert} from "chai";
import type express from "express";
import mongoose, {type Model, model, Schema} from "mongoose";

import type {ModelRouterOptions} from "../api";
import type {UserModel as AuthUserModel, User} from "../auth";
import {APIError} from "../errors";
import {Permissions} from "../permissions";
import {createdUpdatedPlugin, type IsDeleted, isDeletedPlugin} from "../plugins";
import {createAccess} from "../rbac/access";
import {terrenoStatements} from "../rbac/statements";
import {setupDb, UserModel} from "../tests";
import {ExecutorConflictError, executeCreate, executeDelete, executeUpdate} from "./executors";

interface ExecStuff extends IsDeleted {
  _id: string;
  name: string;
  ownerId: string;
  created: Date;
  updated?: Date;
  _syncSeq?: number;
}

const execStuffSchema = new Schema<ExecStuff>({
  _syncSeq: {description: "Per-stream sync sequence used by concurrency tests", type: Number},
  name: {description: "The name of the item", required: true, type: String},
  ownerId: {description: "The user who owns this item", type: String},
});
execStuffSchema.plugin(isDeletedPlugin);
execStuffSchema.plugin(createdUpdatedPlugin);
const ExecStuffModel = model<ExecStuff>("ExecStuff", execStuffSchema);

interface ExecStringIdStuff extends IsDeleted {
  _id: string;
  name: string;
  ownerId: string;
}

const execStringIdStuffSchema = new Schema<ExecStringIdStuff>({
  _id: {description: "Offline-generated string identifier", required: true, type: String},
  name: {description: "The name of the item", required: true, type: String},
  ownerId: {description: "The user who owns this item", type: String},
});
execStringIdStuffSchema.plugin(isDeletedPlugin);
const ExecStringIdStuffModel = model<ExecStringIdStuff>(
  "ExecStringIdStuff",
  execStringIdStuffSchema
);

// No isDeletedPlugin — exercises the hard-delete branch of executeDelete.
interface ExecHardStuff {
  _id: string;
  name: string;
  ownerId?: string;
}

const execHardSchema = new Schema<ExecHardStuff>({
  name: {description: "The name of the item", required: true, type: String},
  ownerId: {description: "The user who owns this item", type: String},
});
const ExecHardModel = model<ExecHardStuff>("ExecHardStuff", execHardSchema);

interface ExecUserish {
  email: string;
  roles?: string[];
}

const execUserishSchema = new Schema<ExecUserish>({
  email: {description: "Login email", required: true, type: String},
  roles: {description: "Authority-bearing roles stripped after hooks", type: [String]},
});
const ExecUserishModel = model<ExecUserish>("ExecUserish", execUserishSchema);

interface UserishAccount {
  admin?: boolean;
  email: string;
  name?: string;
  roles?: string[];
  tokenEpoch?: number;
}

const owner = {_id: "u-owner", admin: false, id: "u-owner"} as unknown as User;
const stranger = {_id: "u-stranger", admin: false, id: "u-stranger"} as unknown as User;

const baseOptions = (
  overrides: Partial<ModelRouterOptions<ExecStuff>> = {}
): ModelRouterOptions<ExecStuff> =>
  ({
    permissions: {
      create: [Permissions.IsAuthenticated],
      delete: [Permissions.IsOwner],
      list: [Permissions.IsAny],
      read: [Permissions.IsAny],
      update: [Permissions.IsOwner],
    },
    ...overrides,
  }) as ModelRouterOptions<ExecStuff>;

const hardOptions = (
  overrides: Partial<ModelRouterOptions<ExecHardStuff>> = {}
): ModelRouterOptions<ExecHardStuff> =>
  ({
    permissions: {
      create: [Permissions.IsAny],
      delete: [Permissions.IsAny],
      list: [Permissions.IsAny],
      read: [Permissions.IsAny],
      update: [Permissions.IsAny],
    },
    ...overrides,
  }) as ModelRouterOptions<ExecHardStuff>;

const caught = async (promise: Promise<unknown>): Promise<APIError> => {
  const result = await promise.then(
    () => undefined,
    (error) => error
  );
  expect(result).toBeInstanceOf(APIError);
  return result as APIError;
};

describe("executeCreate", () => {
  beforeAll(async () => {
    await setupDb();
  });

  beforeEach(async () => {
    await ExecStuffModel.deleteMany({});
  });

  it("creates a document without an HTTP request", async () => {
    const {doc} = await executeCreate<ExecStuff>({
      body: {name: "direct", ownerId: owner.id},
      model: ExecStuffModel,
      options: baseOptions(),
      user: owner,
    });
    expect(doc.name).toBe("direct");
    const saved = await ExecStuffModel.findById(doc._id);
    expect(saved?.name).toBe("direct");
  });

  it("denies unauthenticated users at the method level", async () => {
    const error = await caught(
      executeCreate<ExecStuff>({
        body: {name: "nope"},
        model: ExecStuffModel,
        options: baseOptions(),
        user: undefined,
      })
    );
    expect(error.status).toBe(405);
    expect(error.title).toContain("Access to CREATE on ExecStuff");
  });

  it("strips User roles after preCreate when writeModelName is User", async () => {
    await ExecUserishModel.deleteMany({});
    let seenRoles: unknown;
    const {doc} = await executeCreate<ExecUserish>({
      body: {email: "exec-roles@example.com", roles: ["superadmin"]},
      model: ExecUserishModel,
      options: {
        accessControl: {} as never,
        permissions: {
          create: [Permissions.IsAuthenticated],
          delete: [],
          list: [],
          read: [],
          update: [],
        },
        preCreate: (body) => {
          seenRoles = (body as ExecUserish).roles;
          return body;
        },
      } as ModelRouterOptions<ExecUserish>,
      user: owner,
      writeModelName: "User",
    });
    assert.deepEqual(seenRoles, ["superadmin"]);
    assert.deepEqual(doc.roles ?? [], []);
    const stored = await ExecUserishModel.findById(doc._id).lean();
    assert.deepEqual(stored?.roles ?? [], []);
  });

  it("strips dotted-path User roles on create when writeModelName is User", async () => {
    await ExecUserishModel.deleteMany({});
    const {doc} = await executeCreate<ExecUserish>({
      body: {email: "exec-dotted-roles@example.com", "roles.0": "superadmin"},
      model: ExecUserishModel,
      options: {
        accessControl: {} as never,
        permissions: {
          create: [Permissions.IsAuthenticated],
          delete: [],
          list: [],
          read: [],
          update: [],
        },
      } as ModelRouterOptions<ExecUserish>,
      user: owner,
      writeModelName: "User",
    });
    const stored = await ExecUserishModel.findById(doc._id).lean();
    assert.deepEqual(stored?.roles ?? [], []);
  });

  it("passes a {user} stub request to preCreate when no req is provided", async () => {
    const options = baseOptions({
      preCreate: (body, request) => ({
        ...(body as Partial<ExecStuff>),
        ownerId: (request.user as User).id,
      }),
    } as Partial<ModelRouterOptions<ExecStuff>>);
    const {doc} = await executeCreate<ExecStuff>({
      body: {name: "stubbed"},
      model: ExecStuffModel,
      options,
      user: owner,
    });
    expect(doc.ownerId).toBe(owner.id);
  });

  it("passes the real request through to hooks when provided", async () => {
    const fakeReq = {params: {marker: "real"}, user: owner} as unknown as express.Request;
    let seenReq: express.Request | undefined;
    const options = baseOptions({
      preCreate: (body, request) => {
        seenReq = request;
        return body as ExecStuff;
      },
    } as Partial<ModelRouterOptions<ExecStuff>>);
    await executeCreate<ExecStuff>({
      body: {name: "with req", ownerId: owner.id},
      model: ExecStuffModel,
      options,
      req: fakeReq,
      user: owner,
    });
    expect(seenReq).toBe(fakeReq);
  });

  it("returns 403 when preCreate returns null", async () => {
    const options = baseOptions({preCreate: () => null});
    const error = await caught(
      executeCreate<ExecStuff>({
        body: {name: "denied"},
        model: ExecStuffModel,
        options,
        user: owner,
      })
    );
    expect(error.status).toBe(403);
    expect(error.title).toBe("Create not allowed");
    expect(error.detail).toBe("preCreate hook returned null");
  });

  it("returns 403 when preCreate returns undefined", async () => {
    const options = baseOptions({
      preCreate: () => undefined,
    } as unknown as Partial<ModelRouterOptions<ExecStuff>>);
    const error = await caught(
      executeCreate<ExecStuff>({
        body: {name: "denied"},
        model: ExecStuffModel,
        options,
        user: owner,
      })
    );
    expect(error.status).toBe(403);
    expect(error.detail).toBe("A body must be returned from preCreate");
  });

  it("rethrows APIErrors from preCreate unchanged", async () => {
    const options = baseOptions({
      preCreate: () => {
        throw new APIError({status: 418, title: "teapot"});
      },
    });
    const error = await caught(
      executeCreate<ExecStuff>({
        body: {name: "tea"},
        model: ExecStuffModel,
        options,
        user: owner,
      })
    );
    expect(error.status).toBe(418);
    expect(error.title).toBe("teapot");
  });

  it("wraps plain preCreate errors as 400s", async () => {
    const options = baseOptions({
      preCreate: () => {
        throw new Error("boom");
      },
    });
    const error = await caught(
      executeCreate<ExecStuff>({
        body: {name: "boom"},
        model: ExecStuffModel,
        options,
        user: owner,
      })
    );
    expect(error.status).toBe(400);
    expect(error.title).toBe("preCreate hook error");
    expect(error.detail).toBe("boom");
  });

  it("returns 400 when the body is undefined", async () => {
    const error = await caught(
      executeCreate<ExecStuff>({
        body: undefined,
        model: ExecStuffModel,
        options: baseOptions(),
        user: owner,
      })
    );
    expect(error.status).toBe(400);
    expect(error.title).toBe("Invalid request body");
  });

  it("returns 400 on Mongoose validation failure", async () => {
    const error = await caught(
      executeCreate<ExecStuff>({
        body: {ownerId: owner.id},
        model: ExecStuffModel,
        options: baseOptions(),
        user: owner,
      })
    );
    expect(error.status).toBe(400);
    expect(error.title).toBe("Validation failed");
    expect(error.meta?.fields).toMatchObject({name: expect.any(String)});
  });

  it("wraps transformer.transform errors as 400s", async () => {
    const options = baseOptions({
      transformer: {
        transform: () => {
          throw new Error("transform rejected");
        },
      },
    } as Partial<ModelRouterOptions<ExecStuff>>);
    const error = await caught(
      executeCreate<ExecStuff>({
        body: {name: "x", ownerId: owner.id},
        model: ExecStuffModel,
        options,
        user: owner,
      })
    );
    expect(error.status).toBe(400);
    expect(error.title).toBe("Transform error");
    expect(error.detail).toBe("transform rejected");
  });

  it("invokes postCreate with the created document", async () => {
    const postCreate = mock((value: ExecStuff) => {
      expect(value.name).toBe("hooked");
    });
    const options = baseOptions({postCreate} as Partial<ModelRouterOptions<ExecStuff>>);
    const {doc} = await executeCreate<ExecStuff>({
      body: {name: "hooked", ownerId: owner.id},
      model: ExecStuffModel,
      options,
      user: owner,
    });
    expect(postCreate).toHaveBeenCalledTimes(1);
    expect(postCreate.mock.calls[0][0]._id.toString()).toBe(doc._id.toString());
  });

  it("wraps postCreate errors as 400s", async () => {
    const options = baseOptions({
      postCreate: () => {
        throw new Error("side effect failed");
      },
    });
    const error = await caught(
      executeCreate<ExecStuff>({
        body: {name: "hooked", ownerId: owner.id},
        model: ExecStuffModel,
        options,
        user: owner,
      })
    );
    expect(error.status).toBe(400);
    expect(error.title).toBe("postCreate hook error");
    expect(error.detail).toBe("side effect failed");
  });
});

describe("executeUpdate", () => {
  beforeAll(async () => {
    await setupDb();
  });

  beforeEach(async () => {
    await ExecStuffModel.deleteMany({});
  });

  const createDoc = async (fields: Partial<ExecStuff> = {}) =>
    ExecStuffModel.create({name: "original", ownerId: owner.id, ...fields});

  it("updates a document without an HTTP request", async () => {
    const doc = await createDoc();
    const {doc: updated} = await executeUpdate<ExecStuff>({
      body: {name: "changed"},
      id: doc._id.toString(),
      model: ExecStuffModel,
      options: baseOptions(),
      user: owner,
    });
    expect(updated.name).toBe("changed");
    const saved = await ExecStuffModel.findById(doc._id);
    expect(saved?.name).toBe("changed");
  });

  it("denies at the method level when update permissions are empty", async () => {
    const doc = await createDoc();
    const options = baseOptions();
    options.permissions = {...options.permissions, update: []};
    const error = await caught(
      executeUpdate<ExecStuff>({
        body: {name: "x"},
        id: doc._id.toString(),
        model: ExecStuffModel,
        options,
        user: owner,
      })
    );
    expect(error.status).toBe(405);
    expect(error.title).toContain("Access to UPDATE on ExecStuff");
  });

  it("denies at the object level for non-owners", async () => {
    const doc = await createDoc();
    const error = await caught(
      executeUpdate<ExecStuff>({
        body: {name: "x"},
        id: doc._id.toString(),
        model: ExecStuffModel,
        options: baseOptions(),
        user: stranger,
      })
    );
    expect(error.status).toBe(403);
    expect(error.title).toContain(`Access to GET on ExecStuff:${doc._id.toString()}`);
  });

  it("returns 404 for a missing document", async () => {
    const error = await caught(
      executeUpdate<ExecStuff>({
        body: {name: "x"},
        id: "000000000000000000000000",
        model: ExecStuffModel,
        options: baseOptions(),
        user: owner,
      })
    );
    expect(error.status).toBe(404);
  });

  it("returns 403 when preUpdate returns null", async () => {
    const doc = await createDoc();
    const options = baseOptions({preUpdate: () => null});
    const error = await caught(
      executeUpdate<ExecStuff>({
        body: {name: "x"},
        id: doc._id.toString(),
        model: ExecStuffModel,
        options,
        user: owner,
      })
    );
    expect(error.status).toBe(403);
    expect(error.title).toBe("Update not allowed");
    expect(error.detail).toBe(`preUpdate hook on ${doc._id.toString()} returned null`);
  });

  it("returns 403 when preUpdate returns undefined", async () => {
    const doc = await createDoc();
    const options = baseOptions({
      preUpdate: () => undefined,
    } as unknown as Partial<ModelRouterOptions<ExecStuff>>);
    const error = await caught(
      executeUpdate<ExecStuff>({
        body: {name: "x"},
        id: doc._id.toString(),
        model: ExecStuffModel,
        options,
        user: owner,
      })
    );
    expect(error.status).toBe(403);
    expect(error.detail).toBe("A body must be returned from preUpdate");
  });

  it("wraps plain preUpdate errors as 400s", async () => {
    const doc = await createDoc();
    const options = baseOptions({
      preUpdate: () => {
        throw new Error("nope");
      },
    });
    const error = await caught(
      executeUpdate<ExecStuff>({
        body: {name: "x"},
        id: doc._id.toString(),
        model: ExecStuffModel,
        options,
        user: owner,
      })
    );
    expect(error.status).toBe(400);
    expect(error.title).toBe("preUpdate hook error");
    expect(error.detail).toBe(`preUpdate hook error on ${doc._id.toString()}: nope`);
  });

  it("strips dotted-path User roles on update when writeModelName is User", async () => {
    await ExecUserishModel.deleteMany({});
    const target = await ExecUserishModel.create({
      email: "exec-dotted-update@example.com",
      roles: ["support"],
    });
    await executeUpdate<ExecUserish>({
      body: {"roles.0": "superadmin", "roles.1": "superadmin"},
      id: String(target._id),
      model: ExecUserishModel,
      options: {
        accessControl: {} as never,
        permissions: {
          create: [],
          delete: [],
          list: [],
          read: [],
          update: [Permissions.IsAuthenticated],
        },
      } as ModelRouterOptions<ExecUserish>,
      user: owner,
      writeModelName: "User",
    });
    const stored = await ExecUserishModel.findById(target._id).lean();
    assert.deepEqual(stored?.roles ?? [], ["support"]);
  });

  it("strips _updatedAt from the body before preUpdate", async () => {
    const doc = await createDoc();
    let seenBody: Partial<ExecStuff> | undefined;
    const options = baseOptions({
      preUpdate: (body) => {
        seenBody = body;
        return body as ExecStuff;
      },
    } as Partial<ModelRouterOptions<ExecStuff>>);
    const rawBody: Record<string, unknown> = {
      _updatedAt: "2025-01-01T00:00:00.000Z",
      name: "stripped",
    };
    await executeUpdate<ExecStuff>({
      body: rawBody,
      id: doc._id.toString(),
      model: ExecStuffModel,
      options,
      user: owner,
    });
    expect(seenBody).toBeDefined();
    expect((seenBody as Record<string, unknown>)._updatedAt).toBeUndefined();
    expect(rawBody._updatedAt).toBeUndefined();
  });

  it("throws an ExecutorConflictError on a stale timestamp", async () => {
    const doc = await createDoc();
    const error = await caught(
      executeUpdate<ExecStuff>({
        body: {name: "stale"},
        concurrencyCheck: {
          ifUnmodifiedSince: new Date("2000-01-01T00:00:00.000Z"),
          type: "timestamp",
        },
        id: doc._id.toString(),
        model: ExecStuffModel,
        options: baseOptions(),
        user: owner,
      })
    );
    expect(error).toBeInstanceOf(ExecutorConflictError);
    const conflict = error as ExecutorConflictError;
    expect(conflict.status).toBe(409);
    expect(conflict.conflictType).toBe("timestamp");
    expect((conflict.doc as ExecStuff).name).toBe("original");
    const saved = await ExecStuffModel.findById(doc._id);
    expect(saved?.name).toBe("original");
  });

  it("applies the update when the timestamp is fresh", async () => {
    const doc = await createDoc();
    const {doc: updated} = await executeUpdate<ExecStuff>({
      body: {name: "fresh"},
      concurrencyCheck: {
        ifUnmodifiedSince: new Date(Date.now() + 60_000),
        type: "timestamp",
      },
      id: doc._id.toString(),
      model: ExecStuffModel,
      options: baseOptions(),
      user: owner,
    });
    expect(updated.name).toBe("fresh");
  });

  it("returns 400 for an invalid timestamp, using the provided detail", async () => {
    const doc = await createDoc();
    const error = await caught(
      executeUpdate<ExecStuff>({
        body: {name: "x"},
        concurrencyCheck: {
          ifUnmodifiedSince: new Date(Number.NaN),
          invalidTimestampDetail: "custom parse detail",
          type: "timestamp",
        },
        id: doc._id.toString(),
        model: ExecStuffModel,
        options: baseOptions(),
        user: owner,
      })
    );
    expect(error.status).toBe(400);
    expect(error.title).toBe("Invalid conflict-detection timestamp");
    expect(error.detail).toBe("custom parse detail");
  });

  it("returns 400 for an invalid timestamp with a default detail", async () => {
    const doc = await createDoc();
    const error = await caught(
      executeUpdate<ExecStuff>({
        body: {name: "x"},
        concurrencyCheck: {ifUnmodifiedSince: new Date(Number.NaN), type: "timestamp"},
        id: doc._id.toString(),
        model: ExecStuffModel,
        options: baseOptions(),
        user: owner,
      })
    );
    expect(error.status).toBe(400);
    expect(error.detail).toBe("Conflict-detection timestamp could not be parsed as a date");
  });

  it("throws an ExecutorConflictError on a seq mismatch", async () => {
    const doc = await createDoc({_syncSeq: 5});
    const error = await caught(
      executeUpdate<ExecStuff>({
        body: {name: "stale seq"},
        concurrencyCheck: {baseSeq: 3, type: "seq"},
        id: doc._id.toString(),
        model: ExecStuffModel,
        options: baseOptions(),
        user: owner,
      })
    );
    expect(error).toBeInstanceOf(ExecutorConflictError);
    const conflict = error as ExecutorConflictError;
    expect(conflict.status).toBe(409);
    expect(conflict.conflictType).toBe("seq");
    expect(conflict.serverSeq).toBe(5);
    expect(conflict.title).toContain("Sync conflict");
    expect((conflict.doc as ExecStuff).name).toBe("original");
  });

  it("applies the update when baseSeq matches the doc's _syncSeq", async () => {
    const doc = await createDoc({_syncSeq: 5});
    const {doc: updated} = await executeUpdate<ExecStuff>({
      body: {name: "seq ok"},
      concurrencyCheck: {baseSeq: 5, type: "seq"},
      id: doc._id.toString(),
      model: ExecStuffModel,
      options: baseOptions(),
      user: owner,
    });
    expect(updated.name).toBe("seq ok");
  });

  it("treats a missing _syncSeq as 0 for seq checks", async () => {
    const doc = await createDoc();
    const {doc: updated} = await executeUpdate<ExecStuff>({
      body: {name: "zero seq"},
      concurrencyCheck: {baseSeq: 0, type: "seq"},
      id: doc._id.toString(),
      model: ExecStuffModel,
      options: baseOptions(),
      user: owner,
    });
    expect(updated.name).toBe("zero seq");
  });

  it("returns 400 when the save fails Mongoose validation", async () => {
    const doc = await createDoc();
    const error = await caught(
      executeUpdate<ExecStuff>({
        body: {name: ""},
        id: doc._id.toString(),
        model: ExecStuffModel,
        options: baseOptions(),
        user: owner,
      })
    );
    expect(error.status).toBe(400);
    expect(error.title).toBe("Validation failed");
    expect(error.meta?.fields).toMatchObject({name: expect.any(String)});
  });

  it("invokes postUpdate with the updated doc, cleaned body, and previous doc", async () => {
    const doc = await createDoc();
    let seen: {updatedName: string; cleanedBody: Partial<ExecStuff>; prevName: string} | undefined;
    const options = baseOptions({
      postUpdate: (value, cleanedBody, _request, prevValue) => {
        seen = {
          cleanedBody,
          prevName: (prevValue as ExecStuff).name,
          updatedName: (value as ExecStuff).name,
        };
      },
    } as Partial<ModelRouterOptions<ExecStuff>>);
    await executeUpdate<ExecStuff>({
      body: {name: "after"},
      id: doc._id.toString(),
      model: ExecStuffModel,
      options,
      user: owner,
    });
    expect(seen?.updatedName).toBe("after");
    expect(seen?.prevName).toBe("original");
    expect(seen?.cleanedBody).toEqual({name: "after"} as Partial<ExecStuff>);
  });

  it("wraps postUpdate errors as 400s", async () => {
    const doc = await createDoc();
    const options = baseOptions({
      postUpdate: () => {
        throw new Error("notify failed");
      },
    });
    const error = await caught(
      executeUpdate<ExecStuff>({
        body: {name: "after"},
        id: doc._id.toString(),
        model: ExecStuffModel,
        options,
        user: owner,
      })
    );
    expect(error.status).toBe(400);
    expect(error.title).toBe("postUpdate hook error");
    expect(error.detail).toBe(`postUpdate hook error on ${doc._id.toString()}: notify failed`);
  });
});

describe("executeDelete", () => {
  beforeAll(async () => {
    await setupDb();
  });

  beforeEach(async () => {
    await Promise.all([
      ExecStuffModel.deleteMany({}),
      ExecStringIdStuffModel.deleteMany({}),
      ExecHardModel.deleteMany({}),
    ]);
  });

  const createDoc = async (fields: Partial<ExecStuff> = {}) =>
    ExecStuffModel.create({name: "victim", ownerId: owner.id, ...fields});

  it("soft deletes when the schema has a Boolean deleted path", async () => {
    const doc = await createDoc();
    const {doc: deleted} = await executeDelete<ExecStuff>({
      id: doc._id.toString(),
      model: ExecStuffModel,
      options: baseOptions(),
      user: owner,
    });
    expect((deleted as ExecStuff).deleted).toBe(true);
    const tombstones = await ExecStuffModel.find({_id: doc._id, deleted: true});
    expect(tombstones).toHaveLength(1);
  });

  it("returns an authorized string-id tombstone for an idempotent delete", async () => {
    const id = "offline-generated-id";
    await ExecStringIdStuffModel.create({
      _id: id,
      deleted: true,
      name: "already gone",
      ownerId: owner.id,
    });
    const options = baseOptions() as unknown as ModelRouterOptions<ExecStringIdStuff>;

    const {doc} = await executeDelete<ExecStringIdStuff>({
      id,
      model: ExecStringIdStuffModel,
      options,
      user: owner,
    });

    assert.equal(doc._id, id);
    assert.isTrue(doc.deleted);
  });

  it("checks object permissions before returning an idempotent tombstone", async () => {
    const id = "foreign-offline-id";
    await ExecStringIdStuffModel.create({
      _id: id,
      deleted: true,
      name: "not yours",
      ownerId: owner.id,
    });
    const options = baseOptions() as unknown as ModelRouterOptions<ExecStringIdStuff>;

    const error = await caught(
      executeDelete<ExecStringIdStuff>({
        id,
        model: ExecStringIdStuffModel,
        options,
        user: stranger,
      })
    );

    assert.equal(error.status, 403);
  });

  it("hard deletes when the schema has no deleted path", async () => {
    const doc = await ExecHardModel.create({name: "gone"});
    await executeDelete<ExecHardStuff>({
      id: doc._id.toString(),
      model: ExecHardModel,
      options: hardOptions(),
      user: owner,
    });
    const remaining = await ExecHardModel.findById(doc._id);
    expect(remaining).toBeNull();
  });

  it("denies at the method level when delete permissions are empty", async () => {
    const doc = await createDoc();
    const options = baseOptions();
    options.permissions = {...options.permissions, delete: []};
    const error = await caught(
      executeDelete<ExecStuff>({
        id: doc._id.toString(),
        model: ExecStuffModel,
        options,
        user: owner,
      })
    );
    expect(error.status).toBe(405);
    expect(error.title).toContain("Access to DELETE on ExecStuff");
  });

  it("denies at the object level for non-owners", async () => {
    const doc = await createDoc();
    const error = await caught(
      executeDelete<ExecStuff>({
        id: doc._id.toString(),
        model: ExecStuffModel,
        options: baseOptions(),
        user: stranger,
      })
    );
    expect(error.status).toBe(403);
    expect(error.title).toContain(`Access to GET on ExecStuff:${doc._id.toString()}`);
  });

  it("returns 403 when preDelete returns null", async () => {
    const doc = await createDoc();
    const options = baseOptions({preDelete: () => null});
    const error = await caught(
      executeDelete<ExecStuff>({
        id: doc._id.toString(),
        model: ExecStuffModel,
        options,
        user: owner,
      })
    );
    expect(error.status).toBe(403);
    expect(error.title).toBe("Delete not allowed");
    expect(error.detail).toBe(`preDelete hook for ${doc._id.toString()} returned null`);
  });

  it("returns 403 when preDelete returns undefined", async () => {
    const doc = await createDoc();
    const options = baseOptions({
      preDelete: () => undefined,
    } as unknown as Partial<ModelRouterOptions<ExecStuff>>);
    const error = await caught(
      executeDelete<ExecStuff>({
        id: doc._id.toString(),
        model: ExecStuffModel,
        options,
        user: owner,
      })
    );
    expect(error.status).toBe(403);
    expect(error.detail).toBe("A body must be returned from preDelete");
  });

  it("wraps plain preDelete errors as 403s", async () => {
    const doc = await createDoc();
    const options = baseOptions({
      preDelete: () => {
        throw new Error("no delete");
      },
    });
    const error = await caught(
      executeDelete<ExecStuff>({
        id: doc._id.toString(),
        model: ExecStuffModel,
        options,
        user: owner,
      })
    );
    expect(error.status).toBe(403);
    expect(error.title).toBe("preDelete hook error");
    expect(error.detail).toBe(`preDelete hook error on ${doc._id.toString()}: no delete`);
  });

  it("rethrows APIErrors from preDelete unchanged", async () => {
    const doc = await createDoc();
    const options = baseOptions({
      preDelete: () => {
        throw new APIError({status: 422, title: "cannot delete yet"});
      },
    });
    const error = await caught(
      executeDelete<ExecStuff>({
        id: doc._id.toString(),
        model: ExecStuffModel,
        options,
        user: owner,
      })
    );
    expect(error.status).toBe(422);
    expect(error.title).toBe("cannot delete yet");
  });

  it("invokes postDelete with the tombstoned doc", async () => {
    const doc = await createDoc();
    let seenDeleted: boolean | undefined;
    const options = baseOptions({
      postDelete: (_request, value) => {
        seenDeleted = (value as ExecStuff).deleted;
      },
    } as Partial<ModelRouterOptions<ExecStuff>>);
    await executeDelete<ExecStuff>({
      id: doc._id.toString(),
      model: ExecStuffModel,
      options,
      user: owner,
    });
    expect(seenDeleted).toBe(true);
  });

  it("wraps postDelete errors as 400s", async () => {
    const doc = await createDoc();
    const options = baseOptions({
      postDelete: () => {
        throw new Error("cascade failed");
      },
    });
    const error = await caught(
      executeDelete<ExecStuff>({
        id: doc._id.toString(),
        model: ExecStuffModel,
        options,
        user: owner,
      })
    );
    expect(error.status).toBe(400);
    expect(error.title).toBe("postDelete hook error");
    expect(error.detail).toBe("cascade failed");
  });
});

describe("RBAC user-model strip on a user model not compiled as User", () => {
  // The configured RBAC user model, compiled under a name other than "User".
  const AccountModel =
    (mongoose.models.ExecRbacAccount as Model<UserishAccount> | undefined) ??
    model<UserishAccount>("ExecRbacAccount", UserModel.schema.clone());

  beforeAll(async () => {
    await setupDb();
  });

  beforeEach(async () => {
    await AccountModel.deleteMany({});
  });

  it("strips authority fields on update for the configured user model", async () => {
    const access = createAccess({
      connection: mongoose.connection,
      statements: terrenoStatements,
      userModel: AccountModel as unknown as AuthUserModel,
    });
    const account = await AccountModel.create({email: "renamed-self@example.com", name: "Self"});
    const actor = account as unknown as User;

    await executeUpdate<UserishAccount>({
      body: {admin: true, name: "renamed", roles: ["superadmin"], tokenEpoch: 99},
      id: String(account._id),
      model: AccountModel,
      options: {
        accessControl: access,
        permissions: {
          create: [],
          delete: [],
          list: [],
          read: [],
          update: [Permissions.IsAuthenticated],
        },
      } as unknown as ModelRouterOptions<UserishAccount>,
      user: actor,
    });

    const stored = await AccountModel.findById(account._id).lean();
    expect(stored?.name).toBe("renamed");
    expect(stored?.admin).toBe(false);
    expect(stored?.roles ?? []).toEqual([]);
    expect(stored?.tokenEpoch ?? 0).toBe(0);
  });

  it("strips authority fields on create for the configured user model", async () => {
    const access = createAccess({
      connection: mongoose.connection,
      statements: terrenoStatements,
      userModel: AccountModel as unknown as AuthUserModel,
    });
    const {doc} = await executeCreate<UserishAccount>({
      body: {admin: true, email: "renamed-create@example.com", roles: ["superadmin"]},
      model: AccountModel,
      options: {
        accessControl: access,
        permissions: {
          create: [Permissions.IsAuthenticated],
          delete: [],
          list: [],
          read: [],
          update: [],
        },
      } as unknown as ModelRouterOptions<UserishAccount>,
      user: owner,
    });
    const stored = await AccountModel.findById(doc._id).lean();
    expect(stored?.admin).toBe(false);
    expect(stored?.roles ?? []).toEqual([]);
  });
});
