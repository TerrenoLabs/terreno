import {beforeEach, describe, expect, it} from "bun:test";
import * as Sentry from "@sentry/bun";
import type express from "express";
import qs from "qs";
import supertest from "supertest";
import type TestAgent from "supertest/lib/agent";

import {modelRouter} from "./api";
import {type UserModel as AuthUserModel, addAuthRoutes, setupAuth} from "./auth";
import {logRequests} from "./expressServer";
import {Permissions} from "./permissions";
import {authAsUser, type Food, FoodModel, getBaseServer, setupDb, UserModel} from "./tests";

type TestUser = Awaited<ReturnType<typeof setupDb>>[number];

describe("query and list methods", () => {
  let server: TestAgent;
  let app: express.Application;
  let notAdmin: TestUser;
  let admin: TestUser;
  let adminOther: TestUser;
  let agent: TestAgent;

  let spinach: Food;
  let apple: Food;
  let carrots: Food;
  let pizza: Food;

  beforeEach(async () => {
    [admin, notAdmin, adminOther] = await setupDb();

    const results = (await Promise.all([
      FoodModel.create({
        calories: 1,
        created: new Date("2021-12-03T00:00:20.000Z"),
        eatenBy: [admin._id],
        hidden: false,
        lastEatenWith: {
          dressing: new Date("2021-12-03T19:00:30.000Z"),
        },
        name: "Spinach",
        ownerId: notAdmin._id,
        source: {
          dateAdded: "2023-12-13T12:30:00.000Z",
          href: "https://www.google.com",
          name: "Brand",
        },
      }),
      FoodModel.create({
        calories: 100,
        created: new Date("2021-12-03T00:00:30.000Z"),
        hidden: true,
        name: "Apple",
        ownerId: admin._id,
        tags: ["healthy"],
      }),
      FoodModel.create({
        calories: 100,
        created: new Date("2021-12-03T00:00:00.000Z"),
        eatenBy: [admin._id, notAdmin._id],
        hidden: false,
        name: "Carrots",
        ownerId: admin._id,
        source: {
          name: "USDA",
        },
        tags: ["healthy", "cheap"],
      }),
      FoodModel.create({
        calories: 400,
        created: new Date("2021-12-03T00:00:10.000Z"),
        eatenBy: [adminOther._id],
        hidden: false,
        name: "Pizza",
        ownerId: admin._id,
        tags: ["cheap"],
      }),
    ])) as [Food, Food, Food, Food];
    [spinach, apple, carrots, pizza] = results;
    app = getBaseServer();
    setupAuth(app, UserModel as unknown as AuthUserModel);
    addAuthRoutes(app, UserModel as unknown as AuthUserModel);
    app.use(logRequests);
    app.use(
      "/food",
      modelRouter(FoodModel, {
        allowAnonymous: true,
        defaultLimit: 2,
        defaultQueryParams: {hidden: false},
        maxLimit: 3,
        permissions: {
          create: [Permissions.IsAuthenticated],
          delete: [Permissions.IsAdmin],
          list: [Permissions.IsAny],
          read: [Permissions.IsAny],
          update: [Permissions.IsOwner],
        },
        populatePaths: [{path: "ownerId"}],
        queryFields: [
          "hidden",
          "name",
          "calories",
          "created",
          "created_gte",
          "created_lte",
          "source.name",
          "tags",
          "eatenBy",
        ],
        sort: {created: "descending"},
      })
    );
    server = supertest(app);
    agent = await authAsUser(app, "notAdmin");
  });

  it("read default", async () => {
    const res = await agent.get(`/food/${spinach._id}`).expect(200);
    expect(res.body.data._id).toBe(spinach._id.toString());
    expect(res.body.data.ownerId._id).toBe(notAdmin.id);
    expect(res.body.data.lastEatenWith).toEqual({
      dressing: "2021-12-03T19:00:30.000Z",
    });
  });

  it("list default", async () => {
    const res = await agent.get("/food").expect(200);
    expect(res.body.data).toHaveLength(2);
    expect(res.body.data[0].id).toBe(String(spinach._id));
    expect(res.body.data[0].ownerId._id).toBe(notAdmin.id);
    expect(res.body.data[1].id).toBe(String(pizza._id));
    expect(res.body.data[1].ownerId._id).toBe(admin.id);
    expect(res.body.data[0].lastEatenWith).toEqual({
      dressing: "2021-12-03T19:00:30.000Z",
    });
    expect(res.body.data[1].lastEatenWith).toEqual(undefined);
    expect(res.body.more).toBe(true);
    expect(res.body.total).toBe(3);
  });

  it("list limit", async () => {
    const res = await agent.get("/food?limit=1").expect(200);
    expect(res.body.data).toHaveLength(1);
    expect(res.body.data[0].id).toBe(String(spinach._id));
    expect(res.body.data[0].ownerId._id).toBe(notAdmin.id);
    expect(res.body.more).toBe(true);
    expect(res.body.total).toBe(3);
  });

  it("list limit over", async () => {
    await FoodModel.create({
      calories: 400,
      created: new Date("2021-12-02T00:00:10.000Z"),
      hidden: false,
      name: "Pizza",
      ownerId: admin._id,
    });
    const res = await agent.get("/food?limit=4").expect(200);
    expect(res.body.data).toHaveLength(3);
    expect(res.body.more).toBe(true);
    expect(res.body.total).toBe(4);
    expect(res.body.data[0].id).toBe(String(spinach._id));
    expect(res.body.data[1].id).toBe(String(pizza._id));
    expect(res.body.data[2].id).toBe(String(carrots._id));

    expect(Sentry.captureMessage).toHaveBeenCalledWith(
      'More than 3 results returned for foods without pagination, data may be silently truncated. req.query: {"limit":"4"}'
    );
  });

  it("list page", async () => {
    const res = await agent.get("/food?limit=1&page=2").expect(200);
    expect(res.body.data).toHaveLength(1);
    expect(res.body.more).toBe(true);
    expect(res.body.total).toBe(3);
    expect(res.body.data[0].id).toBe(String(pizza._id));
  });

  it("list page 0 ", async () => {
    const res = await agent.get("/food?limit=1&page=0").expect(400);
    expect(res.body.title).toBe("Invalid page");
    expect(res.body.detail).toBe("Invalid page: 0");
    expect(res.body.source).toEqual({parameter: "page"});
  });

  it("list page with garbage ", async () => {
    const res = await agent.get("/food?limit=1&page=abc").expect(400);
    expect(res.body.title).toBe("Invalid page");
    expect(res.body.detail).toBe("Invalid page: abc");
    expect(res.body.source).toEqual({parameter: "page"});
  });

  it("list page over", async () => {
    const res = await agent.get("/food?limit=1&page=5").expect(200);
    expect(res.body.data).toHaveLength(0);
    expect(res.body.more).toBe(false);
    expect(res.body.total).toBe(3);
  });

  it("list query params", async () => {
    const res = await agent.get("/food?hidden=true").expect(200);
    expect(res.body.data).toHaveLength(1);
    expect(res.body.more).toBe(false);
    expect(res.body.total).toBe(1);
    expect(res.body.data[0].id).toBe(String(apple._id));
  });

  it("list applies created_gte and created_lte as a Date range", async () => {
    const res = await agent
      .get("/food")
      .query({
        created_gte: "2021-12-03T00:00:05.000Z",
        created_lte: "2021-12-03T00:00:25.000Z",
        limit: 10,
      })
      .expect(200);
    const names = (res.body.data as {name: string}[]).map((d) => d.name).sort();
    expect(names).toEqual(["Pizza", "Spinach"]);
  });

  it("list returns 400 when created_gte is not a valid date", async () => {
    const res = await agent.get("/food").query({created_gte: "not-a-date", limit: 10}).expect(400);
    expect(res.body.title).toBe("Invalid date query parameter");
    expect(res.body.detail).toBe("Invalid date for query parameter created_gte");
    expect(res.body.source).toEqual({parameter: "created_gte"});
  });

  it("list returns 400 when created_lte is not a valid date", async () => {
    const res = await agent
      .get("/food")
      .query({created_lte: "also-not-a-date", limit: 10})
      .expect(400);
    expect(res.body.title).toBe("Invalid date query parameter");
    expect(res.body.detail).toBe("Invalid date for query parameter created_lte");
    expect(res.body.source).toEqual({parameter: "created_lte"});
  });

  it("applies created_gte alone as a lower Date bound", async () => {
    const res = await agent
      .get("/food")
      .query({created_gte: "2021-12-03T00:00:15.000Z", limit: 10})
      .expect(200);
    const names = (res.body.data as {name: string}[]).map((d) => d.name).sort();
    expect(names).toEqual(["Spinach"]);
  });

  it("applies created_lte alone as an upper Date bound", async () => {
    const res = await agent
      .get("/food")
      .query({created_lte: "2021-12-03T00:00:05.000Z", limit: 10})
      .expect(200);
    const names = (res.body.data as {name: string}[]).map((d) => d.name).sort();
    expect(names).toEqual(["Carrots"]);
  });

  it("drops a scalar direct field value when a date range is also provided", async () => {
    const res = await agent
      .get("/food")
      .query({
        created: "2021-12-03T00:00:20.000Z",
        created_gte: "2021-12-03T00:00:05.000Z",
        created_lte: "2021-12-03T00:00:25.000Z",
        limit: 10,
      })
      .expect(200);
    const names = (res.body.data as {name: string}[]).map((d) => d.name).sort();
    expect(names).toEqual(["Pizza", "Spinach"]);
  });

  it("merges date-range bounds into an existing object query for the field", async () => {
    const res = await agent
      .get(
        `/food?${qs.stringify({
          created: {$lte: "2021-12-03T00:00:25.000Z"},
          created_gte: "2021-12-03T00:00:05.000Z",
          limit: 10,
        })}`
      )
      .expect(200);
    const names = (res.body.data as {name: string}[]).map((d) => d.name).sort();
    expect(names).toEqual(["Pizza", "Spinach"]);
  });

  it("list query params not in list", async () => {
    const res = await agent.get(`/food?ownerId=${admin._id}`).expect(400);
    expect(res.body.title).toBe("Query parameter not allowed");
    expect(res.body.detail).toContain("ownerId is not allowed as a query param.");
  });

  it("names the model and allowed queryFields when a filter field is missing", async () => {
    const res = await agent.get(`/food?ownerId=${admin._id}`).expect(400);
    expect(res.body.code).toBe("query-param-not-allowed");
    expect(res.body.source).toEqual({parameter: "ownerId"});
    expect(res.body.detail).toContain('Add "ownerId" to queryFields on the Food modelRouter');
    expect(res.body.meta.queryParam).toBe("ownerId");
    expect(res.body.meta.model).toBe("Food");
    expect(Array.isArray(res.body.meta.allowedQueryFields)).toBe(true);
    expect(res.body.meta.allowedQueryFields).not.toContain("ownerId");
  });

  it("list query by nested param", async () => {
    const res = await agent.get("/food?source.name=USDA").expect(200);
    expect(res.body.data).toHaveLength(1);
    expect(res.body.total).toBe(1);
    expect(res.body.data[0].id).toBe(String(carrots._id));
  });

  it("query by date", async () => {
    const authRes = await server
      .post("/auth/login")
      .send({email: "admin@example.com", password: "securePassword"})
      .expect(200);
    const token = authRes.body.data.token;

    let res = await server
      .get(
        `/food?limit=3&${qs.stringify({
          created: {
            $gte: "2021-12-03T00:00:00.000Z",
            $lte: "2021-12-03T00:00:20.000Z",
          },
        })}`
      )
      .set("authorization", `Bearer ${token}`)
      .expect(200);
    expect(res.body.data.map((d: Food) => d.created)).toEqual(
      expect.arrayContaining([
        "2021-12-03T00:00:20.000Z",
        "2021-12-03T00:00:10.000Z",
        "2021-12-03T00:00:00.000Z",
      ])
    );
    expect(res.body.data.map((d: Food) => d.created)).toHaveLength(3);

    res = await server
      .get(
        `/food?limit=3&${qs.stringify({
          created: {
            $gte: "2021-12-03T00:00:00.000Z",
            $lt: "2021-12-03T00:00:20.000Z",
          },
        })}`
      )
      .set("authorization", `Bearer ${token}`)
      .expect(200);
    expect(res.body.data.map((d: Food) => d.created)).toEqual(
      expect.arrayContaining(["2021-12-03T00:00:10.000Z", "2021-12-03T00:00:00.000Z"])
    );
    expect(res.body.data.map((d: Food) => d.created)).toHaveLength(2);

    res = await server
      .get(
        `/food?limit=3&${qs.stringify({
          created: {
            $gt: "2021-12-03T00:00:00.000Z",
            $lt: "2021-12-03T00:00:20.000Z",
          },
        })}`
      )
      .set("authorization", `Bearer ${token}`)
      .expect(200);
    const createdDates = res.body.data.map((d: Food) => d.created);
    expect(createdDates).toEqual(expect.arrayContaining(["2021-12-03T00:00:10.000Z"]));
    expect(createdDates).toHaveLength(1);
  });

  it("query with a space", async () => {
    const greenBeans = await FoodModel.create({
      calories: 102,
      created: Date.now() - 10,
      name: "Green Beans",
      ownerId: admin?._id,
    });
    const res = await agent.get(`/food?${qs.stringify({name: "Green Beans"})}`).expect(200);
    expect(res.body.data).toHaveLength(1);
    expect(res.body.data[0].id).toBe(greenBeans?.id);
    expect(res.body.data[0].name).toBe("Green Beans");
  });

  it("query with a regex", async () => {
    const greenBeans = await FoodModel.create({
      calories: 102,
      created: Date.now() - 10,
      name: "Green Beans",
      ownerId: admin?._id,
    });

    let res = await agent.get(`/food?${qs.stringify({name: {$regex: "Green"}})}`).expect(200);
    expect(res.body.data).toHaveLength(1);
    expect(res.body.data[0].id).toBe(greenBeans?.id);
    expect(res.body.data[0].name).toBe("Green Beans");

    res = await agent.get(`/food?${qs.stringify({name: {$regex: "green"}})}`).expect(200);
    expect(res.body.data).toHaveLength(0);

    res = await agent
      .get(`/food?${qs.stringify({name: {$options: "i", $regex: "green"}})}`)
      .expect(200);
    expect(res.body.data).toHaveLength(1);
    expect(res.body.data[0].id).toBe(greenBeans?.id);
  });

  it("query with an $in operator", async () => {
    let res = await server
      .get(
        `/food?${qs.stringify({
          name: {
            $in: ["Apple", "Spinach"],
          },
        })}`
      )
      .expect(200);
    const names1 = res.body.data.map((d: Food) => d.name);
    expect(names1).toEqual(expect.arrayContaining(["Spinach"]));
    expect(names1).toHaveLength(1);

    res = await server
      .get(
        `/food?${qs.stringify({
          name: {
            $in: ["Carrots", "Spinach"],
          },
        })}`
      )
      .expect(200);
    const names2 = res.body.data.map((d: Food) => d.name);
    expect(names2).toEqual(expect.arrayContaining(["Spinach", "Carrots"]));
    expect(names2).toHaveLength(2);
  });

  it("query with an $in for _ids in nested object", async () => {
    const res = await server
      .get(
        `/food?${qs.stringify({
          eatenBy: {
            $in: [notAdmin._id.toString(), adminOther._id.toString()],
          },
        })}`
      )
      .expect(200);
    expect(res.body.more).toBe(false);
    expect(res.body.total).toBe(2);
    expect(res.body.data).toHaveLength(2);
    const names3 = res.body.data.map((d: Food) => d.name);
    expect(names3).toEqual(expect.arrayContaining(["Carrots", "Pizza"]));
    expect(names3).toHaveLength(2);
  });

  it("query $and operator on same field", async () => {
    const res = await agent
      .get(`/food?${qs.stringify({$and: [{tags: "healthy"}, {tags: "cheap"}]})}`)
      .expect(200);
    expect(res.body.data).toHaveLength(1);
    expect(res.body.data[0].id).toBe(carrots?._id.toString());
  });

  it("query $and operator on same field, nested objects", async () => {
    const res = await agent
      .get(
        `/food?${qs.stringify({
          $and: [{eatenBy: admin.id}, {eatenBy: notAdmin.id}],
        })}`
      )
      .expect(200);
    expect(res.body.data).toHaveLength(1);
    expect(res.body.data[0].id).toBe(carrots?._id.toString());
  });

  it("query $or operator on same field", async () => {
    const res = await agent
      .get(`/food?${qs.stringify({$or: [{name: "Carrots"}, {name: "Pizza"}]})}`)
      .expect(200);
    expect(res.body.data).toHaveLength(2);
    const ids1 = res.body.data.map((d: Food) => d.id);
    expect(ids1).toEqual(expect.arrayContaining([carrots?._id.toString(), pizza?._id.toString()]));
    expect(ids1).toHaveLength(2);
  });

  it("query $and operator on same field, nested objects for $or", async () => {
    const res = await agent
      .get(
        `/food?${qs.stringify({
          $or: [{eatenBy: admin.id}, {eatenBy: notAdmin.id}],
          limit: 3,
        })}`
      )
      .expect(200);
    expect(res.body.data).toHaveLength(2);
    const ids2 = res.body.data.map((d: Food) => d.id);
    expect(ids2).toEqual(
      expect.arrayContaining([carrots?._id.toString(), spinach?._id.toString()])
    );
    expect(ids2).toHaveLength(2);
  });

  it("query $and and $or are rejected if field is not in queryFields", async () => {
    let res = await agent
      .get(`/food?${qs.stringify({$and: [{ownerId: "healthy"}, {tags: "cheap"}]})}`)
      .expect(400);
    expect(res.body.title).toBe("Query parameter not allowed");
    expect(res.body.detail).toContain("ownerId is not allowed as a query param.");
    res = await agent
      .get(`/food?${qs.stringify({$and: [{tags: "cheap"}, {ownerId: "healthy"}]})}`)
      .expect(400);
    expect(res.body.title).toBe("Query parameter not allowed");
    expect(res.body.detail).toContain("ownerId is not allowed as a query param.");

    res = await agent
      .get(`/food?${qs.stringify({$or: [{tags: "cheap"}, {ownerId: "healthy"}]})}`)
      .expect(400);
    expect(res.body.title).toBe("Query parameter not allowed");
    expect(res.body.detail).toContain("ownerId is not allowed as a query param.");
  });

  it("query with a number", async () => {
    const res = await agent.get("/food?calories=100").expect(200);
    expect(res.body.data).toHaveLength(1);
    expect(res.body.data[0].id).toBe(carrots?._id.toString());
  });

  it("update", async () => {
    let res = await agent.patch(`/food/${spinach._id}`).send({name: "Kale"}).expect(200);
    expect(res.body.data.name).toBe("Kale");
    expect(res.body.data.calories).toBe(1);
    expect(res.body.data.hidden).toBe(false);

    res = await agent
      .patch(`/food/${spinach._id}`)
      .send({lastEatenWith: {dressing: "2023-12-03T00:00:20.000Z"}})
      .expect(200);
    expect(res.body.data.name).toBe("Kale");
    expect(res.body.data.calories).toBe(1);
    expect(res.body.data.hidden).toBe(false);
    expect(res.body.data.lastEatenWith).toEqual({
      dressing: "2023-12-03T00:00:20.000Z",
    });

    res = await agent
      .patch(`/food/${spinach._id}`)
      .send({
        lastEatenWith: {
          cucumber: "2023-12-04T12:00:20.000Z",
          dressing: "2023-12-03T00:00:20.000Z",
        },
      })
      .expect(200);
    expect(res.body.data.lastEatenWith).toEqual({
      cucumber: "2023-12-04T12:00:20.000Z",
      dressing: "2023-12-03T00:00:20.000Z",
    });
  });

  it("update using dot notation", async () => {
    const res = await agent
      .patch(`/food/${spinach._id}`)
      .send({"source.href": "https://food.com"})
      .expect(200);
    expect(res.body.data.source.href).toBe("https://food.com");
    expect(res.body.data.source.name).toBe("Brand");
    expect(res.body.data.source.dateAdded).toBe("2023-12-13T12:30:00.000Z");

    const dbSpinach = await FoodModel.findById(spinach._id);
    expect(dbSpinach?.source.href).toBe("https://food.com");
    expect(dbSpinach?.source.name).toBe("Brand");
    expect(dbSpinach?.source.dateAdded).toBe("2023-12-13T12:30:00.000Z");
  });
});

describe("special query params", () => {
  let server: TestAgent;
  let app: express.Application;
  let admin: TestUser;

  beforeEach(async () => {
    [admin] = await setupDb();

    await FoodModel.create({
      calories: 1,
      created: new Date("2021-12-03T00:00:20.000Z"),
      hidden: false,
      name: "Spinach",
      ownerId: admin._id,
    });

    app = getBaseServer();
    setupAuth(app, UserModel as unknown as AuthUserModel);
    addAuthRoutes(app, UserModel as unknown as AuthUserModel);
  });

  it("period query param is stripped from query", async () => {
    app.use(
      "/food",
      modelRouter(FoodModel, {
        allowAnonymous: true,
        permissions: {
          create: [Permissions.IsAny],
          delete: [Permissions.IsAny],
          list: [Permissions.IsAny],
          read: [Permissions.IsAny],
          update: [Permissions.IsAny],
        },
        queryFields: ["name", "period"],
        queryFilter: (_user, query) => {
          if (query?.period) {
            return query;
          }
          return query ?? {};
        },
      })
    );
    server = supertest(app);

    const res = await server.get("/food?period=weekly").expect(200);
    expect(res.body.data).toBeDefined();
  });

  it("query with false value", async () => {
    await FoodModel.create({
      calories: 50,
      created: new Date("2021-12-04T00:00:20.000Z"),
      hidden: true,
      name: "HiddenFood",
      ownerId: admin._id,
    });

    app.use(
      "/food",
      modelRouter(FoodModel, {
        allowAnonymous: true,
        permissions: {
          create: [Permissions.IsAny],
          delete: [Permissions.IsAny],
          list: [Permissions.IsAny],
          read: [Permissions.IsAny],
          update: [Permissions.IsAny],
        },
        queryFields: ["name", "hidden"],
      })
    );
    server = supertest(app);

    const res = await server.get("/food?hidden=false").expect(200);
    expect(res.body.data.every((f: Food) => f.hidden === false)).toBe(true);
  });
});
