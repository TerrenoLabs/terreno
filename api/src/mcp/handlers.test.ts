import {beforeEach, describe, it, spyOn} from "bun:test";
import {assert} from "chai";
import mongoose, {Schema} from "mongoose";

import type {User} from "../auth";
import {APIError} from "../errors";
import {Permissions} from "../permissions";
import * as executors from "../sync/executors";
import {handleCreate, handleDelete, handleList, handleRead, handleUpdate} from "./handlers";
import type {MCPRegistryEntry, MCPToolResult} from "./types";

interface NoteDocFields {
  _id: mongoose.Types.ObjectId;
  [key: string]: unknown;
}

const noteSchema = new Schema({
  body: {description: "Note body", type: String},
  ownerId: {description: "Owner of the note", type: Schema.Types.ObjectId},
  secret: {description: "Redacted field", type: String},
  title: {description: "Note title", required: true, type: String},
});

const getOrCreateModel = (): mongoose.Model<NoteDocFields> => {
  try {
    return mongoose.model<NoteDocFields>("MCPHandlerNote");
  } catch {
    return mongoose.model<NoteDocFields>("MCPHandlerNote", noteSchema);
  }
};

const NoteModel = getOrCreateModel();

interface TestUser {
  _id: mongoose.Types.ObjectId;
  admin: boolean;
  id: string;
}

const makeUser = (admin = false): TestUser => {
  const _id = new mongoose.Types.ObjectId();
  return {_id, admin, id: _id.toString()};
};

const asUser = (user: TestUser): User => user as unknown as User;

const owner = makeUser();
const stranger = makeUser();

const parseResult = (result: MCPToolResult): Record<string, unknown> => {
  return JSON.parse(result.content[0].text) as Record<string, unknown>;
};

const errorText = (result: MCPToolResult): string => {
  assert.isTrue(result.isError, "expected an error result");
  return String(parseResult(result).error);
};

const createEntry = (overrides: Partial<MCPRegistryEntry["options"]> = {}): MCPRegistryEntry => ({
  config: {
    maxLimit: 10,
    methods: ["create", "list", "read", "update", "delete"],
  },
  model: NoteModel,
  modelName: "MCPHandlerNote",
  options: {
    permissions: {
      create: [Permissions.IsAuthenticated],
      delete: [Permissions.IsOwner],
      list: [Permissions.IsAuthenticated],
      read: [Permissions.IsOwner],
      update: [Permissions.IsOwner],
    },
    preCreate: (body, req) => ({
      ...(body as Record<string, unknown>),
      ownerId: (req.user as unknown as TestUser | undefined)?._id,
    }),
    queryFields: ["title"],
    ...overrides,
  },
});

const throwingResponseHandler = async (): Promise<never> => {
  throw new APIError({status: 422, title: "Cannot serialize"});
};

describe("MCP handlers", () => {
  let entry: MCPRegistryEntry;

  beforeEach(async () => {
    await NoteModel.deleteMany({});
    entry = createEntry();
  });

  describe("authentication and permissions", () => {
    it("denies list to an authenticated user who fails the list permission", async () => {
      const adminOnly = createEntry({
        permissions: {...entry.options.permissions, list: [Permissions.IsAdmin]},
      });
      const result = await handleList(adminOnly, {}, asUser(owner));
      assert.equal(errorText(result), "Permission denied: cannot list");
    });

    it("denies read to an authenticated user who fails the read permission", async () => {
      const adminOnly = createEntry({
        permissions: {...entry.options.permissions, read: [Permissions.IsAdmin]},
      });
      const doc = await NoteModel.create({ownerId: owner._id, title: "Private"});
      const result = await handleRead(adminOnly, {id: doc._id.toString()}, asUser(owner));
      assert.equal(errorText(result), "Permission denied: cannot read");
    });

    it("denies read of a document owned by someone else", async () => {
      const doc = await NoteModel.create({ownerId: owner._id, title: "Mine"});
      const result = await handleRead(entry, {id: doc._id.toString()}, asUser(stranger));
      assert.equal(errorText(result), "Permission denied: cannot read this document");
    });

    it("denies update without a user", async () => {
      const doc = await NoteModel.create({ownerId: owner._id, title: "Mine"});
      const result = await handleUpdate(entry, {id: doc._id.toString(), title: "Nope"});
      assert.equal(errorText(result), "Permission denied: authentication required");
    });

    it("denies delete without a user", async () => {
      const doc = await NoteModel.create({ownerId: owner._id, title: "Mine"});
      const result = await handleDelete(entry, {id: doc._id.toString()});
      assert.equal(errorText(result), "Permission denied: authentication required");
    });
  });

  describe("missing ids", () => {
    it("returns not found when read is called without an id", async () => {
      const result = await handleRead(entry, {}, asUser(owner));
      assert.equal(errorText(result), "Document undefined not found");
    });

    it("returns not found when update gets a non-string id", async () => {
      const result = await handleUpdate(entry, {id: 42, title: "x"}, asUser(owner));
      assert.equal(errorText(result), "Document 42 not found");
    });

    it("returns not found when delete gets a non-string id", async () => {
      const result = await handleDelete(entry, {id: null}, asUser(owner));
      assert.equal(errorText(result), "Document null not found");
    });
  });

  describe("populate resolution", () => {
    it("treats a populate string of only separators as no populate request", async () => {
      await NoteModel.create({ownerId: owner._id, title: "One"});
      const result = await handleList(entry, {populate: " , ,"}, asUser(owner));
      assert.notEqual(result.isError, true);
      const parsed = parseResult(result) as {data: Array<{title: string}>};
      assert.equal(parsed.data.length, 1);
      assert.equal(parsed.data[0].title, "One");
    });
  });

  describe("list sort allowlist", () => {
    it("rejects sorting on excluded or undeclared fields", async () => {
      await NoteModel.create({ownerId: owner._id, secret: "b", title: "One"});
      await NoteModel.create({ownerId: owner._id, secret: "a", title: "Two"});
      const redacted: MCPRegistryEntry = {
        ...createEntry({queryFields: ["title", "secret"], sortFields: ["body"]}),
        config: {...entry.config, excludeFields: ["secret"]},
      };

      assert.include(
        errorText(await handleList(redacted, {sort: "secret"}, asUser(owner))),
        "secret is not an allowed sort field"
      );
      assert.include(
        errorText(await handleList(redacted, {sort: "title -ownerId"}, asUser(owner))),
        "ownerId is not an allowed sort field"
      );

      const byTitle = await handleList(redacted, {sort: "-title"}, asUser(owner));
      assert.notEqual(byTitle.isError, true);
      const titles = (parseResult(byTitle).data as Array<{title: string}>).map((d) => d.title);
      assert.deepEqual(titles, ["Two", "One"]);
      const byBody = await handleList(redacted, {sort: "body"}, asUser(owner));
      assert.notEqual(byBody.isError, true);
    });
  });

  describe("queryFilter", () => {
    it("returns an empty page when queryFilter resolves to null", async () => {
      await NoteModel.create({ownerId: owner._id, title: "Hidden"});
      const filtered = createEntry({queryFilter: async () => null});
      const result = await handleList(filtered, {}, asUser(owner));
      assert.notEqual(result.isError, true);
      assert.deepEqual(parseResult(result), {data: [], more: false, page: 1, total: 0});
    });

    it("surfaces an APIError thrown by queryFilter using its title", async () => {
      const filtered = createEntry({
        queryFilter: async () => {
          throw new APIError({status: 403, title: "Filter refused"});
        },
      });
      const result = await handleList(filtered, {}, asUser(owner));
      assert.equal(errorText(result), "Filter refused");
    });
  });

  describe("findById failures", () => {
    it("rethrows non-cast errors from the read query", async () => {
      const findSpy = spyOn(NoteModel, "findById").mockReturnValue({
        exec: async () => {
          throw new Error("connection dropped");
        },
        populate: function populate() {
          return this;
        },
      } as unknown as ReturnType<typeof NoteModel.findById>);
      try {
        let thrown: unknown;
        try {
          await handleRead(entry, {id: new mongoose.Types.ObjectId().toString()}, asUser(owner));
        } catch (error) {
          thrown = error;
        }
        assert.instanceOf(thrown, Error);
        assert.equal((thrown as Error).message, "connection dropped");
      } finally {
        findSpy.mockRestore();
      }
    });
  });

  describe("executor errors", () => {
    it("maps a plain Error from the executor onto the error envelope", async () => {
      const createSpy = spyOn(executors, "executeCreate").mockRejectedValue(
        new Error("executor exploded")
      );
      try {
        const result = await handleCreate(entry, {title: "Boom"}, asUser(owner));
        assert.equal(errorText(result), "executor exploded");
      } finally {
        createSpy.mockRestore();
      }
    });
  });

  describe("response serialization", () => {
    it("returns the APIError title when the responseHandler throws on list", async () => {
      await NoteModel.create({ownerId: owner._id, title: "One"});
      const failing = createEntry({responseHandler: throwingResponseHandler});
      const result = await handleList(failing, {}, asUser(owner));
      assert.equal(errorText(result), "Cannot serialize");
    });

    it("returns the APIError title when the responseHandler throws on create", async () => {
      const failing = createEntry({responseHandler: throwingResponseHandler});
      const result = await handleCreate(failing, {title: "One"}, asUser(owner));
      assert.equal(errorText(result), "Cannot serialize");
      assert.equal(await NoteModel.countDocuments({title: "One"}), 1);
    });

    it("returns the APIError title when the responseHandler throws on update", async () => {
      const doc = await NoteModel.create({ownerId: owner._id, title: "Before"});
      const failing = createEntry({responseHandler: throwingResponseHandler});
      const result = await handleUpdate(
        failing,
        {id: doc._id.toString(), title: "After"},
        asUser(owner)
      );
      assert.equal(errorText(result), "Cannot serialize");
      const updated = await NoteModel.findById(doc._id);
      assert.equal(updated?.title, "After");
    });

    it("wraps a non-APIError thrown by the responseHandler", async () => {
      const doc = await NoteModel.create({ownerId: owner._id, title: "Read"});
      const failing = createEntry({
        responseHandler: async () => {
          throw new Error("kaboom");
        },
      });
      const result = await handleRead(failing, {id: doc._id.toString()}, asUser(owner));
      assert.equal(errorText(result), "Response handler failed: kaboom");
    });

    it("converts Mongoose documents returned by mcpResponseHandler before redacting", async () => {
      const doc = await NoteModel.create({ownerId: owner._id, secret: "s3cret", title: "Doc"});
      const redacting: MCPRegistryEntry = {
        ...entry,
        config: {
          ...entry.config,
          excludeFields: ["secret"],
          mcpResponseHandler: async (value) => value as never,
        },
      };
      const result = await handleRead(redacting, {id: doc._id.toString()}, asUser(owner));
      assert.notEqual(result.isError, true);
      const parsed = parseResult(result) as {data: Record<string, unknown>};
      assert.equal(parsed.data.title, "Doc");
      assert.notProperty(parsed.data, "secret");
    });
  });
});
