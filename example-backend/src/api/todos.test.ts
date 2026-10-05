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
});
