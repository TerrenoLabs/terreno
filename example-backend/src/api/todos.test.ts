import {afterAll, beforeAll, beforeEach, describe, it} from "bun:test";
import {
  configureNotificationService,
  configureOpenApiValidator,
  generateTokens,
  Notification,
  resetOpenApiValidatorConfig,
  TerrenoApp,
} from "@terreno/api";
import {assert} from "chai";
import supertest from "supertest";
import {Todo} from "../models/todo";
import {User as UserModel} from "../models/user";
import type {UserDocument} from "../types/models/userTypes";
import {todoRouter} from "./todos";

describe("todo notifications", () => {
  let app: ReturnType<TerrenoApp["build"]>;

  const createUser = async (email: string): Promise<UserDocument> => {
    return UserModel.register(
      {admin: false, email, name: email} as never,
      "password12345"
    ) as unknown as Promise<UserDocument>;
  };

  beforeAll(() => {
    process.env.TOKEN_SECRET = process.env.TOKEN_SECRET || "test-secret";
    process.env.TOKEN_ISSUER = process.env.TOKEN_ISSUER || "example-backend-test";
    configureOpenApiValidator();
    configureNotificationService({userModel: UserModel});
    app = new TerrenoApp({
      skipListen: true,
      userModel: UserModel as never,
    })
      .register(todoRouter)
      .build();
  });

  afterAll(() => {
    configureNotificationService({});
    resetOpenApiValidatorConfig();
  });

  beforeEach(async () => {
    await Notification.collection.deleteMany({});
    await Todo.collection.deleteMany({});
  });

  it("notifies the owner when a todo is added, checked, and deleted", async () => {
    const user = await createUser(`todo-notifications-${crypto.randomUUID()}@example.com`);
    const {token} = await generateTokens(user);

    const created = await supertest(app)
      .post("/todos")
      .set("Authorization", `Bearer ${token}`)
      .send({title: "Ship notifications"});
    assert.equal(created.status, 201);
    assert.equal(await Notification.countDocuments({ownerId: user._id, title: "Todo added"}), 1);

    const todoId = created.body.data._id as string;
    const completed = await supertest(app)
      .patch(`/todos/${todoId}`)
      .set("Authorization", `Bearer ${token}`)
      .send({completed: true});
    assert.equal(completed.status, 200);
    assert.equal(
      await Notification.countDocuments({ownerId: user._id, title: "Todo completed"}),
      1
    );

    const renamed = await supertest(app)
      .patch(`/todos/${todoId}`)
      .set("Authorization", `Bearer ${token}`)
      .send({title: "Ship drawer"});
    assert.equal(renamed.status, 200);
    assert.equal(
      await Notification.countDocuments({ownerId: user._id, title: "Todo completed"}),
      1
    );

    const deleted = await supertest(app)
      .delete(`/todos/${todoId}`)
      .set("Authorization", `Bearer ${token}`);
    assert.equal(deleted.status, 204);
    assert.equal(await Notification.countDocuments({ownerId: user._id, title: "Todo deleted"}), 1);
  });

  it("filters the list by created for syncdb query windows and names missing queryFields", async () => {
    const user = await createUser(`todo-windows-${crypto.randomUUID()}@example.com`);
    const {token} = await generateTokens(user);
    for (const title of ["older", "newer"]) {
      const res = await supertest(app)
        .post("/todos")
        .set("Authorization", `Bearer ${token}`)
        .send({title});
      assert.equal(res.status, 201);
    }
    await Todo.collection.updateOne(
      {title: "older"},
      {$set: {created: new Date("2020-01-01T00:00:00Z")}}
    );

    const recent = await supertest(app)
      .get("/todos?created[$gte]=2021-01-01T00:00:00.000Z&page=1&limit=10")
      .set("Authorization", `Bearer ${token}`);
    assert.equal(recent.status, 200);
    assert.deepEqual(
      recent.body.data.map((todo: {title: string}) => todo.title),
      ["newer"]
    );

    const rejected = await supertest(app)
      .get("/todos?title=newer")
      .set("Authorization", `Bearer ${token}`);
    assert.equal(rejected.status, 400);
    assert.equal(rejected.body.code, "query-param-not-allowed");
    assert.include(rejected.body.detail, 'Add "title" to queryFields on the Todo modelRouter');
    assert.deepEqual(rejected.body.meta.allowedQueryFields, ["completed", "created", "ownerId"]);
  });

  it("runs bulkComplete over MCP with the same implementation as REST", async () => {
    const user = await createUser(`todo-mcp-${crypto.randomUUID()}@example.com`);
    const {token} = await generateTokens(user);
    const todo = await Todo.create({ownerId: user._id, title: "Finish via MCP"});

    const res = await supertest(app)
      .post("/mcp")
      .set("Authorization", `Bearer ${token}`)
      .set("accept", "application/json, text/event-stream")
      .send({
        id: 1,
        jsonrpc: "2.0",
        method: "tools/call",
        params: {arguments: {ids: [String(todo._id)]}, name: "todos_bulk_complete"},
      });

    assert.include(res.text, '\\"modified\\":1');
    assert.isTrue((await Todo.findById(todo._id))?.completed);
  });
});

// Test fix (Pick): operation methods are create/update/delete per the bulk envelope, not HTTP verbs.
describe("POST /todos/bulk", () => {
  let app: ReturnType<TerrenoApp["build"]>;

  const createUser = async (email: string): Promise<UserDocument> => {
    return UserModel.register(
      {admin: false, email, name: email} as never,
      "password12345"
    ) as unknown as Promise<UserDocument>;
  };

  beforeAll(() => {
    process.env.TOKEN_SECRET = process.env.TOKEN_SECRET || "test-secret";
    process.env.TOKEN_ISSUER = process.env.TOKEN_ISSUER || "example-backend-test";
    configureOpenApiValidator();
    configureNotificationService({userModel: UserModel});
    app = new TerrenoApp({
      skipListen: true,
      userModel: UserModel as never,
    })
      .register(todoRouter)
      .build();
  });

  afterAll(() => {
    configureNotificationService({});
    resetOpenApiValidatorConfig();
  });

  beforeEach(async () => {
    await Notification.collection.deleteMany({});
    await Todo.collection.deleteMany({});
  });

  // Always partial mode: the example test lane may run on a standalone Mongo with no transactions.
  it("applies create, update own, and delete own in one request with per-item statuses", async () => {
    const user = await createUser(`todo-bulk-${crypto.randomUUID()}@example.com`);
    const {token} = await generateTokens(user);
    const toUpdate = await Todo.create({ownerId: user._id, title: "Before"});
    const toDelete = await Todo.create({ownerId: user._id, title: "Doomed"});

    const res = await supertest(app)
      .post("/todos/bulk")
      .set("Authorization", `Bearer ${token}`)
      .send({
        atomic: false,
        operations: [
          {body: {title: "Created in bulk"}, method: "create"},
          {body: {completed: true}, id: String(toUpdate._id), method: "update"},
          {id: String(toDelete._id), method: "delete"},
        ],
      });

    assert.equal(res.status, 200);
    assert.deepEqual(
      res.body.data.map((item: {index: number; method: string; status: number}) => [
        item.index,
        item.method,
        item.status,
      ]),
      [
        [0, "create", 201],
        [1, "update", 200],
        [2, "delete", 204],
      ]
    );

    const created = await Todo.collection.findOne({title: "Created in bulk"});
    assert.isOk(created);
    assert.equal(String(created?.ownerId), String(user._id));
    assert.isTrue((await Todo.findById(toUpdate._id))?.completed);
    assert.isNull(await Todo.findById(toDelete._id));
  });

  it("returns 403 for an item that updates another user's todo and still applies the others", async () => {
    const user = await createUser(`todo-bulk-me-${crypto.randomUUID()}@example.com`);
    const other = await createUser(`todo-bulk-other-${crypto.randomUUID()}@example.com`);
    const {token} = await generateTokens(user);
    const theirs = await Todo.create({ownerId: other._id, title: "Not yours"});
    const mine = await Todo.create({ownerId: user._id, title: "Mine"});

    const res = await supertest(app)
      .post("/todos/bulk")
      .set("Authorization", `Bearer ${token}`)
      .send({
        atomic: false,
        operations: [
          {body: {completed: true}, id: String(theirs._id), method: "update"},
          {body: {completed: true}, id: String(mine._id), method: "update"},
        ],
      });

    assert.equal(res.status, 200);
    assert.deepEqual(
      res.body.data.map((item: {status: number}) => item.status),
      [403, 200]
    );
    assert.isFalse((await Todo.findById(theirs._id))?.completed);
    assert.isTrue((await Todo.findById(mine._id))?.completed);
  });

  it("rejects an unauthenticated bulk request with 401 and writes nothing", async () => {
    const res = await supertest(app)
      .post("/todos/bulk")
      .send({atomic: false, operations: [{body: {title: "Nope"}, method: "create"}]});

    assert.equal(res.status, 401);
    assert.equal(await Todo.countDocuments({title: "Nope"}), 0);
  });
});
