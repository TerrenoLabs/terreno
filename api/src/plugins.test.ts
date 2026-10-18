import {beforeEach, describe, expect, it, setSystemTime} from "bun:test";
import {assert} from "chai";
import type express from "express";
import {
  type DateSchemaDefinition,
  type Document,
  type HydratedDocument,
  type Model,
  model,
  Schema,
} from "mongoose";
import supertest from "supertest";
import type TestAgent from "supertest/lib/agent";
import {modelRouter} from "./api";
import {type UserModel as AuthUserModel, addAuthRoutes, setupAuth} from "./auth";
import {type APIErrorConstructor, InternalServerError, isAPIError, NotFoundError} from "./errors";
import {Permissions} from "./permissions";
import {
  baseUserPlugin,
  createdUpdatedPlugin,
  DateOnly,
  emailVerificationPlugin,
  excludeArchivedPlugin,
  findExactlyOne,
  findOneOrNone,
  findOneOrNoneFor,
  firebaseJWTPlugin,
  type IsArchived,
  type IsDeleted,
  isDeletedPlugin,
  upsertPlugin,
} from "./plugins";
import {authAsUser, getBaseServer, setupDb, UserModel} from "./tests";

interface Stuff extends IsDeleted {
  _id: string;
  name: string;
  ownerId: string;
  date: Date;
  created: Date;
  updated?: Date;
}

interface StuffModelType extends Model<Stuff> {
  findOneOrNone(
    query: Record<string, unknown>,
    errorArgs?: Partial<APIErrorConstructor>
  ): Promise<(Document & Stuff) | null>;
  findExactlyOne(
    query: Record<string, unknown>,
    errorArgs?: Partial<APIErrorConstructor>
  ): Promise<Document & Stuff>;
  upsert(
    conditions: Record<string, unknown>,
    update: Record<string, unknown>
  ): Promise<Document & Stuff>;
}

const expectApiError = (error: unknown) => {
  if (!isAPIError(error)) {
    throw error;
  }
  return error;
};

const stuffSchema = new Schema<Stuff>({
  date: {
    description: "The date associated with this item",
    type: DateOnly as unknown as DateSchemaDefinition,
  },
  name: {description: "The name of the item", type: String},
  ownerId: {description: "The user who owns this item", type: String},
});

stuffSchema.plugin(isDeletedPlugin);
stuffSchema.plugin(findOneOrNone);
stuffSchema.plugin(findExactlyOne);
stuffSchema.plugin(upsertPlugin);
stuffSchema.plugin(createdUpdatedPlugin);

const StuffModel = model<Stuff>("Stuff", stuffSchema) as unknown as StuffModelType;

describe("baseUserPlugin", () => {
  it("adds admin and email fields to the schema", () => {
    const testSchema = new Schema({});
    baseUserPlugin(testSchema);

    const adminPath = testSchema.path("admin");
    expect(adminPath).toBeDefined();
    expect((adminPath as unknown as {options: {default: boolean}}).options.default).toBe(false);

    const emailPath = testSchema.path("email");
    expect(emailPath).toBeDefined();
    expect((emailPath as unknown as {options: {index: boolean}}).options.index).toBe(true);
  });
});

describe("emailVerificationPlugin", () => {
  it("adds emailVerified defaulting to false", () => {
    const testSchema = new Schema({});
    emailVerificationPlugin(testSchema);

    const emailVerifiedPath = testSchema.path("emailVerified");
    expect(emailVerifiedPath).toBeDefined();
    expect((emailVerifiedPath as unknown as {options: {default: boolean}}).options.default).toBe(
      false
    );
  });
});

describe("firebaseJWTPlugin", () => {
  it("adds firebaseId field to the schema", () => {
    const testSchema = new Schema({});
    firebaseJWTPlugin(testSchema);

    const firebaseIdPath = testSchema.path("firebaseId");
    expect(firebaseIdPath).toBeDefined();
    expect((firebaseIdPath as unknown as {options: {index: boolean}}).options.index).toBe(true);
  });
});

describe("createdUpdate", () => {
  it("sets created and updated on save", async () => {
    setSystemTime(new Date("2022-12-17T03:24:00.000Z"));

    const stuff = await StuffModel.create({name: "Things", ownerId: "123"});
    expect(stuff.created).not.toBeNull();
    expect(stuff.updated).not.toBeNull();
    expect(stuff.created.toISOString()).toBe("2022-12-17T03:24:00.000Z");
    expect(stuff.updated?.toISOString()).toBe("2022-12-17T03:24:00.000Z");

    stuff.name = "Thangs";
    // Advance time by 10 seconds
    setSystemTime(new Date("2022-12-17T03:24:10.000Z"));
    await stuff.save();
    expect(stuff.created.toISOString()).toBe("2022-12-17T03:24:00.000Z");
    expect(stuff.updated && stuff.updated > stuff.created).toBe(true);
    setSystemTime();
  });
});

describe("isDeleted", () => {
  beforeEach(async () => {
    await StuffModel.deleteMany({});
    await Promise.all([
      StuffModel.create({
        deleted: true,
        name: "Things",
        ownerId: "123",
      }),
      StuffModel.create({
        name: "StuffNThings",
        ownerId: "123",
      }),
    ]);
  });

  it('filters out deleted documents from "find"', async () => {
    let stuff = await StuffModel.find({});
    expect(stuff).toHaveLength(1);
    expect(stuff[0].name).toBe("StuffNThings");
    // Providing deleted in query should return deleted documents:
    stuff = await StuffModel.find({deleted: true});
    expect(stuff).toHaveLength(1);
    expect(stuff[0].name).toBe("Things");
  });

  it('filters out deleted documents from "findOne"', async () => {
    let stuff = await StuffModel.findOne({});
    expect(stuff?.name).toBe("StuffNThings");
    // Providing deleted in query should return deleted document:
    stuff = await StuffModel.findOne({deleted: true});
    expect(stuff?.name).toBe("Things");
  });

  it('filters out deleted documents from "countDocuments" unless deleted is explicit', async () => {
    expect(await StuffModel.countDocuments({})).toBe(1);
    expect(await StuffModel.countDocuments({deleted: true})).toBe(1);
  });
});

describe("findOneOrNone", () => {
  let things: HydratedDocument<Stuff>;

  beforeEach(async () => {
    await StuffModel.deleteMany({});
    await setupDb();

    [things] = await Promise.all([
      StuffModel.create({
        name: "Things",
        ownerId: "123",
      }),
      StuffModel.create({
        name: "StuffNThings",
        ownerId: "123",
      }),
    ]);
  });

  it("returns null with no matches.", async () => {
    const result = await StuffModel.findOneOrNone({name: "OtherStuff"});
    expect(result).toBeNull();
  });

  it("returns a single match", async () => {
    const result = await StuffModel.findOneOrNone({name: "Things"});
    expect(result).not.toBeNull();
    expect(result?._id.toString()).toBe(things._id.toString());
  });

  it("throws error with two matches.", async () => {
    const fn = () => StuffModel.findOneOrNone({ownerId: "123"});
    await expect(fn()).rejects.toThrow(/^findOne query returned multiple documents$/);
  });

  it("throws custom error with two matches.", async () => {
    const fn = () => StuffModel.findOneOrNone({ownerId: "123"}, {status: 400, title: "Oh no!"});

    try {
      await fn();
      // If the promise doesn't reject, the test should fail
      throw new Error("Expected promise to reject");
    } catch (caught: unknown) {
      const error = expectApiError(caught);
      expect(error.title).toBe("Oh no!");
      expect(error.status).toBe(400);
      expect(error.detail).toBe(
        'Stuff.findOne query returned multiple documents. query: {"ownerId":"123"}'
      );
      expect(error.code).toBe("find-one-multiple-documents");
    }
  });
});

interface BareThing {
  name: string;
  ownerId: string;
}

const bareThingSchema = new Schema<BareThing>({
  name: {description: "The name of the bare item", type: String},
  ownerId: {description: "The owner of the bare item", type: String},
});

const BareThingModel = model<BareThing>("BareThing", bareThingSchema);

describe("findOneOrNoneFor", () => {
  beforeEach(async () => {
    await StuffModel.deleteMany({});
    await BareThingModel.deleteMany({});
    await setupDb();
  });

  describe("when the schema has the findOneOrNone plugin", () => {
    let things: HydratedDocument<Stuff>;

    beforeEach(async () => {
      [things] = await Promise.all([
        StuffModel.create({name: "Things", ownerId: "123"}),
        StuffModel.create({name: "StuffNThings", ownerId: "123"}),
      ]);
    });

    it("returns null with no matches", async () => {
      const result = await findOneOrNoneFor(StuffModel, {name: "OtherStuff"});
      expect(result).toBeNull();
    });

    it("returns a single match", async () => {
      const result = await findOneOrNoneFor(StuffModel, {name: "Things"});
      expect(result).not.toBeNull();
      expect(result?._id.toString()).toBe(things._id.toString());
    });

    it("throws when multiple documents match", async () => {
      const fn = () => findOneOrNoneFor(StuffModel, {ownerId: "123"});
      await expect(fn()).rejects.toThrow(/^findOne query returned multiple documents$/);
    });

    it("forwards errorArgs to the thrown APIError", async () => {
      const fn = () =>
        findOneOrNoneFor(StuffModel, {ownerId: "123"}, {status: 400, title: "Oh no!"});

      try {
        await fn();
        throw new Error("Expected promise to reject");
      } catch (caught: unknown) {
        const error = expectApiError(caught);
        expect(error.title).toBe("Oh no!");
        expect(error.status).toBe(400);
      }
    });
  });

  describe("when the schema does NOT have the findOneOrNone plugin", () => {
    let bareThings: HydratedDocument<BareThing>;

    beforeEach(async () => {
      [bareThings] = await Promise.all([
        BareThingModel.create({name: "Things", ownerId: "123"}),
        BareThingModel.create({name: "StuffNThings", ownerId: "123"}),
      ]);
    });

    it("returns null with no matches", async () => {
      const result = await findOneOrNoneFor(BareThingModel, {name: "OtherStuff"});
      expect(result).toBeNull();
    });

    it("returns a single match", async () => {
      const result = await findOneOrNoneFor(BareThingModel, {name: "Things"});
      expect(result).not.toBeNull();
      expect(result?._id?.toString()).toBe(bareThings._id?.toString());
    });

    it("throws when multiple documents match", async () => {
      const fn = () => findOneOrNoneFor(BareThingModel, {ownerId: "123"});
      await expect(fn()).rejects.toThrow(/^findOne query returned multiple documents$/);
    });

    it("forwards errorArgs to the thrown APIError", async () => {
      const fn = () =>
        findOneOrNoneFor(BareThingModel, {ownerId: "123"}, {status: 400, title: "Oh no!"});

      try {
        await fn();
        throw new Error("Expected promise to reject");
      } catch (caught: unknown) {
        const error = expectApiError(caught);
        expect(error.title).toBe("Oh no!");
        expect(error.status).toBe(400);
      }
    });
  });
});

describe("findExactlyOne", () => {
  let things: HydratedDocument<Stuff>;

  beforeEach(async () => {
    await StuffModel.deleteMany({});
    await setupDb();

    [things] = await Promise.all([
      StuffModel.create({
        name: "Things",
        ownerId: "123",
      }),
      StuffModel.create({
        name: "StuffNThings",
        ownerId: "123",
      }),
    ]);
  });

  it("throws error with no matches.", async () => {
    const fn = () => StuffModel.findExactlyOne({name: "OtherStuff"});
    await expect(fn()).rejects.toThrow(/^findExactlyOne query returned no documents$/);
  });

  it("throws a NotFoundError carrying the model name in detail and meta", async () => {
    try {
      await StuffModel.findExactlyOne({name: "OtherStuff"});
      throw new Error("Expected promise to reject");
    } catch (error: unknown) {
      expect(error).toBeInstanceOf(NotFoundError);
      if (!isAPIError(error)) {
        throw error;
      }
      expect(error.status).toBe(404);
      expect(error.code).toBe("find-exactly-one-no-documents");
      expect(error.detail).toBe(
        'Stuff.findExactlyOne query returned no documents. query: {"name":"OtherStuff"}'
      );
      expect(error.meta).toEqual({model: "Stuff"});
    }
  });

  it("returns a single match", async () => {
    const result = await StuffModel.findExactlyOne({name: "Things"});
    expect(result._id.toString()).toBe(things._id.toString());
  });

  it("throws error with two matches.", async () => {
    const fn = () => StuffModel.findExactlyOne({ownerId: "123"});
    await expect(fn()).rejects.toThrow(/^findExactlyOne query returned multiple documents$/);
  });

  it("throws custom error with two matches.", async () => {
    const fn = () => StuffModel.findExactlyOne({ownerId: "123"}, {status: 400, title: "Oh no!"});

    try {
      await fn();
      // If the promise doesn't reject, the test should fail
      throw new Error("Expected promise to reject");
    } catch (caught: unknown) {
      const error = expectApiError(caught);
      expect(error.title).toBe("Oh no!");
      expect(error.status).toBe(400);
      expect(error.detail).toBe(
        'Stuff.findExactlyOne query returned multiple documents. query: {"ownerId":"123"}'
      );
      expect(error.code).toBe("find-exactly-one-multiple-documents");
    }
  });
});

describe("upsertPlugin", () => {
  beforeEach(async () => {
    await StuffModel.deleteMany({});
    await setupDb();
  });

  it("creates a new document when none exists", async () => {
    const result = await StuffModel.upsert({name: "NewThing"}, {ownerId: "456"});
    expect(result.name).toBe("NewThing");
    expect(result.ownerId).toBe("456");

    const found = await StuffModel.findOne({name: "NewThing"});
    expect(found).not.toBeNull();
    expect(found?.ownerId).toBe("456");
  });

  it("updates existing document when one exists", async () => {
    const initial = await StuffModel.create({
      name: "ExistingThing",
      ownerId: "123",
    });

    const result = await StuffModel.upsert({name: "ExistingThing"}, {ownerId: "789"});

    expect(result._id.toString()).toBe(initial._id.toString());
    expect(result.ownerId).toBe("789");

    const allDocs = await StuffModel.find({name: "ExistingThing"});
    expect(allDocs).toHaveLength(1);
    expect(allDocs[0].ownerId).toBe("789");
  });

  it("throws error when multiple documents match conditions", async () => {
    await Promise.all([
      StuffModel.create({name: "Thing1", ownerId: "123"}),
      StuffModel.create({name: "Thing2", ownerId: "123"}),
    ]);

    const fn = () => StuffModel.upsert({ownerId: "123"}, {name: "Updated"});
    await expect(fn()).rejects.toThrow(/^upsert find query returned multiple documents$/);
    try {
      await fn();
    } catch (error: unknown) {
      expect(error).toBeInstanceOf(InternalServerError);
      if (!isAPIError(error)) {
        throw error;
      }
      expect(error.code).toBe("upsert-multiple-documents");
      expect(error.detail).toBe(
        'Stuff.upsert find query returned multiple documents. query: {"ownerId":"123"}'
      );
    }
  });

  it("combines conditions and update data for new documents", async () => {
    const result = await StuffModel.upsert({name: "TestCondition"}, {ownerId: "999"});

    expect(result.name).toBe("TestCondition");
    expect(result.ownerId).toBe("999");
  });
});

interface ArchivableStuff extends IsArchived {
  _id: string;
  name: string;
}

const archivableSchema = new Schema<ArchivableStuff>({
  name: {description: "The name of the item", type: String},
});
archivableSchema.plugin(excludeArchivedPlugin);
const ArchivableModel = model<ArchivableStuff>("ArchivableStuff", archivableSchema);

describe("excludeArchivedPlugin", () => {
  beforeEach(async () => {
    await ArchivableModel.deleteMany({});
    await setupDb();
  });

  it("adds an archived field defaulting to false", () => {
    const archivedPath = archivableSchema.path("archived");
    expect(archivedPath).toBeDefined();
    expect((archivedPath as unknown as {options: {default: boolean}}).options.default).toBe(false);
    expect((archivedPath as unknown as {options: {index: boolean}}).options.index).toBe(true);
  });

  it("excludes archived documents from find() by default", async () => {
    await ArchivableModel.create({archived: false, name: "Active"});
    await ArchivableModel.create({archived: true, name: "Archived"});

    const results = await ArchivableModel.find({});
    expect(results).toHaveLength(1);
    expect(results[0].name).toBe("Active");
  });

  it("excludes archived documents from findOne() by default", async () => {
    await ArchivableModel.create({archived: false, name: "Active"});
    await ArchivableModel.create({archived: true, name: "Archived"});

    const active = await ArchivableModel.findOne({name: "Active"});
    expect(active?.name).toBe("Active");
    const archived = await ArchivableModel.findOne({name: "Archived"});
    expect(archived).toBeNull();
  });

  it("includes archived documents when explicitly requested", async () => {
    await ArchivableModel.create({archived: false, name: "Active"});
    await ArchivableModel.create({archived: true, name: "Archived"});

    const results = await ArchivableModel.find({archived: true});
    expect(results).toHaveLength(1);
    expect(results[0].name).toBe("Archived");
  });

  it("does not override an explicit archived filter of false", async () => {
    await ArchivableModel.create({archived: false, name: "Active"});
    await ArchivableModel.create({archived: true, name: "Archived"});

    const results = await ArchivableModel.find({archived: false});
    expect(results).toHaveLength(1);
    expect(results[0].name).toBe("Active");
  });
});

describe("TypeScript return types", () => {
  let _things: HydratedDocument<Stuff>;

  beforeEach(async () => {
    await StuffModel.deleteMany({});
    await setupDb();

    [_things] = await Promise.all([
      StuffModel.create({
        date: new Date("2023-01-01"),
        name: "Things",
        ownerId: "123",
      }),
      StuffModel.create({
        date: new Date("2023-01-02"),
        name: "StuffNThings",
        ownerId: "123",
      }),
    ]);
  });

  it("findOneOrNone returns properly typed document or null", async () => {
    const result = await StuffModel.findOneOrNone({name: "Things"});

    if (result) {
      expect(typeof result._id.toString()).toBe("string");
      expect(typeof result.name).toBe("string");
      expect(typeof result.ownerId).toBe("string");
      expect(result.date).toBeInstanceOf(Date);
    } else {
      expect(result).toBeNull();
    }
  });

  it("findExactlyOne returns properly typed document", async () => {
    const result = await StuffModel.findExactlyOne({name: "Things"});

    expect(typeof result._id.toString()).toBe("string");
    expect(typeof result.name).toBe("string");
    expect(typeof result.ownerId).toBe("string");
    expect(result.date).toBeInstanceOf(Date);
  });
});
describe("DateOnly", () => {
  it("strips the time portion when getting a Date value", () => {
    const dateOnly = new DateOnly("date", {});
    const value = dateOnly.get(new Date("2005-10-10T17:17:17.017Z")) as unknown as Date;
    assert.instanceOf(value, Date);
    assert.equal(value.toISOString(), "2005-10-10T00:00:00.000Z");
  });

  it("returns non-Date values unchanged when getting a value", () => {
    const dateOnly = new DateOnly("date", {});
    assert.isNull(dateOnly.get(null));
    assert.equal(dateOnly.get("2005-10-10") as unknown as string, "2005-10-10");
  });

  it("throws error with invalid date", async () => {
    try {
      await StuffModel.create({
        date: "foo" as unknown as Date,
        name: "Things",
        ownerId: "123",
      });
    } catch (error: unknown) {
      expect((error as Error).message).toMatch(/Cast to DateOnly failed/);
      return;
    }
    throw new Error("Expected error was not thrown");
  });

  it("adjusts date to date only", async () => {
    const res = await StuffModel.create({
      date: "2005-10-10T17:17:17.017Z",
      name: "Things",
      ownerId: "123",
    });
    expect(res.date.toISOString()).toBe("2005-10-10T00:00:00.000Z");
  });

  it("filter on date only", async () => {
    await StuffModel.create({
      date: "2000-10-10T17:17:17.017Z",
      name: "Things",
      ownerId: "123",
    });
    let found = await StuffModel.findOne({
      date: {
        $gte: "2000-01-01T00:00:00.000Z",
        $lt: "2001-01-01T00:00:00.000Z",
      },
    });
    expect(found?.date.toISOString()).toBe("2000-10-10T00:00:00.000Z");
    found = await StuffModel.findOne({
      date: {
        $gte: "2000-01-01T12:12:12.000Z",
        $lt: "2001-01-01T12:12:12.000Z",
      },
    });
    expect(found?.date.toISOString()).toBe("2000-10-10T00:00:00.000Z");
  });

  describe("handle 404", () => {
    let agent: TestAgent;
    let app: express.Application;

    beforeEach(async () => {
      await setupDb();
      app = getBaseServer();
      setupAuth(app, UserModel as unknown as AuthUserModel);
      addAuthRoutes(app, UserModel as unknown as AuthUserModel);
      app.use(
        "/stuff",
        modelRouter(StuffModel, {
          allowAnonymous: true,
          permissions: {
            create: [Permissions.IsAny],
            delete: [Permissions.IsAny],
            list: [Permissions.IsAny],
            read: [Permissions.IsAny],
            update: [Permissions.IsAny],
          },
        })
      );
      supertest(app);
      agent = await authAsUser(app, "notAdmin");
    });

    it("returns 404 with context for hidden document", async () => {
      const doc = await StuffModel.create({deleted: true, name: "test"});
      const res = await agent.get(`/stuff/${doc._id}`).expect(404);
      expect(res.body.title).toBe("Document not found");
      expect(res.body.detail).toContain(String(doc._id));
      expect(res.body.meta).toEqual({deleted: "true"});
    });

    it("returns 404 without meta for missing document", async () => {
      const nonExistentId = "507f1f77bcf86cd799439011";
      const res = await agent.get(`/stuff/${nonExistentId}`).expect(404);
      expect(res.body.title).toBe("Document not found");
      expect(res.body.detail).toContain(nonExistentId);
      expect(res.body.meta).toBeUndefined();
    });
  });
});
