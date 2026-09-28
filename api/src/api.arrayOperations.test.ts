import {beforeEach, describe, expect, it} from "bun:test";
import {assert} from "chai";
import type express from "express";
import supertest from "supertest";
import type TestAgent from "supertest/lib/agent";

import {modelRouter} from "./api";
import {type UserModel as AuthUserModel, addAuthRoutes, setupAuth} from "./auth";
import {Permissions} from "./permissions";
import {
  authAsUser,
  type Food,
  type FoodCategory,
  FoodModel,
  getBaseServer,
  setupDb,
  UserModel,
} from "./tests";
import {AdminOwnerTransformer} from "./transformers";

type TestUser = Awaited<ReturnType<typeof setupDb>>[number];

describe("model array operations", () => {
  let _server: TestAgent;
  let app: express.Application;
  let admin: TestUser;
  let spinach: Food;
  let apple: Food;
  let agent: TestAgent;

  beforeEach(async () => {
    process.env.REFRESH_TOKEN_SECRET = "testsecret1234";

    [admin] = await setupDb();

    [spinach, apple] = await Promise.all([
      FoodModel.create({
        calories: 1,
        created: new Date("2021-12-03T00:00:20.000Z"),
        hidden: false,
        name: "Spinach",
        ownerId: admin._id,
        source: {
          name: "Brand",
        },
      }),
      FoodModel.create({
        calories: 100,
        categories: [
          {
            name: "Fruit",
            show: true,
          },
          {
            name: "Popular",
            show: false,
          },
        ],
        created: new Date("2021-12-03T00:00:30.000Z"),
        hidden: false,
        name: "Apple",
        ownerId: admin._id,
        tags: ["healthy", "cheap"],
      }),
    ]);

    app = getBaseServer();
    setupAuth(app, UserModel as unknown as AuthUserModel);
    addAuthRoutes(app, UserModel as unknown as AuthUserModel);
    app.use(
      "/food",
      modelRouter(FoodModel, {
        allowAnonymous: true,
        permissions: {
          create: [Permissions.IsAdmin],
          delete: [Permissions.IsAdmin],
          list: [Permissions.IsAdmin],
          read: [Permissions.IsAdmin],
          update: [Permissions.IsAdmin],
        },
        queryFields: ["hidden", "calories", "created", "source.name"],
        sort: {created: "descending"},
      })
    );
    _server = supertest(app);
    agent = await authAsUser(app, "admin");
  });

  it("add array sub-schema item", async () => {
    // Incorrect way, should have "categories" as a top level key.
    let res = await agent
      .post(`/food/${apple._id}/categories`)
      .send({name: "Good Seller", show: false})
      .expect(400);
    expect(res.body.title).toBe("Malformed array operation body");
    expect(res.body.detail).toBe(
      "Malformed body, array operations should have a single, top level key, got: name,show"
    );

    res = await agent
      .post(`/food/${apple._id}/categories`)
      .send({categories: {name: "Good Seller", show: false}})
      .expect(200);
    expect(res.body.data.categories).toHaveLength(3);
    expect(res.body.data.categories[2].name).toBe("Good Seller");

    res = await agent
      .post(`/food/${spinach._id}/categories`)
      .send({categories: {name: "Good Seller", show: false}})
      .expect(200);
    expect(res.body.data.categories).toHaveLength(1);
  });

  it("update array sub-schema item", async () => {
    let res = await agent
      .patch(`/food/${apple._id}/categories/xyz`)
      .send({categories: {name: "Good Seller", show: false}})
      .expect(404);
    expect(res.body.title).toBe("Array item not found");
    expect(res.body.detail).toBe("Could not find categories/xyz");
    res = await agent
      .patch(`/food/${apple._id}/categories/${apple.categories[1]._id}`)
      .send({categories: {name: "Good Seller", show: false}})
      .expect(200);
    expect(res.body.data.categories).toHaveLength(2);
    expect(res.body.data.categories[1].name).toBe("Good Seller");
  });

  it("delete array sub-schema item", async () => {
    let res = await agent.delete(`/food/${apple._id}/categories/xyz`).expect(404);
    expect(res.body.title).toBe("Array item not found");
    expect(res.body.detail).toBe("Could not find categories/xyz");
    res = await agent
      .delete(`/food/${apple._id}/categories/${apple.categories[0]._id}`)
      .expect(200);
    expect(res.body.data.categories).toHaveLength(1);
    expect(res.body.data.categories[0].name).toBe("Popular");
  });

  it("add array item", async () => {
    let res = await agent.post(`/food/${apple._id}/tags`).send({tags: "popular"}).expect(200);
    expect(res.body.data.tags).toHaveLength(3);
    expect(res.body.data.tags).toEqual(["healthy", "cheap", "popular"]);

    res = await agent.post(`/food/${spinach._id}/tags`).send({tags: "popular"}).expect(200);
    expect(res.body.data.tags).toEqual(["popular"]);
  });

  it("update array item", async () => {
    let res = await agent
      .patch(`/food/${apple._id}/tags/xyz`)
      .send({tags: "unhealthy"})
      .expect(404);
    expect(res.body.title).toBe("Array item not found");
    expect(res.body.detail).toBe("Could not find tags/xyz");
    res = await agent
      .patch(`/food/${apple._id}/tags/healthy`)
      .send({tags: "unhealthy"})
      .expect(200);
    expect(res.body.data.tags).toEqual(["unhealthy", "cheap"]);
  });

  it("delete array item", async () => {
    let res = await agent.delete(`/food/${apple._id}/tags/xyz`).expect(404);
    expect(res.body.title).toBe("Array item not found");
    expect(res.body.detail).toBe("Could not find tags/xyz");
    res = await agent.delete(`/food/${apple._id}/tags/healthy`).expect(200);
    expect(res.body.data.tags).toEqual(["cheap"]);
  });

  it("updates timestamps on array subdocuments", async () => {
    // Create a food with categories that have timestamps
    const foodWithTimestamps = await FoodModel.create({
      calories: 100,
      categories: [
        {
          name: "Category 1",
          show: true,
          updated: new Date("2024-01-01T00:00:00.000Z"),
        },
        {
          name: "Category 2",
          show: true,
          updated: new Date("2024-01-01T00:00:00.000Z"),
        },
      ],
      created: new Date(),
      name: "Food with Timestamps",
      ownerId: admin._id,
    });

    const firstCategoryId = foodWithTimestamps.categories?.[0]?._id?.toString();
    const secondCategoryId = foodWithTimestamps.categories?.[1]?._id?.toString();

    if (!firstCategoryId || !secondCategoryId) {
      throw new Error("Failed to create food with categories");
    }

    // Wait a moment to ensure timestamp difference
    await new Promise((resolve) => setTimeout(resolve, 100));

    // Update one of the categories
    const res = await agent
      .patch(`/food/${foodWithTimestamps._id}/categories/${firstCategoryId}`)
      .send({categories: {name: "Updated Category"}})
      .expect(200);

    // Verify the updated category has a newer timestamp
    const updatedCategory = res.body.data.categories.find(
      (c: FoodCategory) => c._id === firstCategoryId
    );
    const unchangedCategory = res.body.data.categories.find(
      (c: FoodCategory) => c._id === secondCategoryId
    );

    if (!updatedCategory || !unchangedCategory) {
      throw new Error("Failed to find categories in response");
    }

    expect(updatedCategory.updated).not.toBe(updatedCategory.created);
    expect(unchangedCategory.updated).toBe(unchangedCategory.created);
    expect(updatedCategory.name).toBe("Updated Category");
    // Unchanged.
    expect(updatedCategory.show).toBe(true);
    expect(unchangedCategory.show).toBe(true);
  });

  it("array operations call postUpdate with different copy of document", async () => {
    let postUpdateDoc: Food | undefined;
    let postUpdatePrevDoc: Food | undefined;
    let postUpdateCalled = false;

    app = getBaseServer();
    setupAuth(app, UserModel as unknown as AuthUserModel);
    addAuthRoutes(app, UserModel as unknown as AuthUserModel);
    app.use(
      "/food",
      modelRouter(FoodModel, {
        allowAnonymous: true,
        permissions: {
          create: [Permissions.IsAdmin],
          delete: [Permissions.IsAdmin],
          list: [Permissions.IsAdmin],
          read: [Permissions.IsAdmin],
          update: [Permissions.IsAdmin],
        },
        postUpdate: async (doc, _cleanedBody, _request, prevValue) => {
          postUpdateDoc = doc;
          postUpdatePrevDoc = prevValue;
          postUpdateCalled = true;
        },
      })
    );
    _server = supertest(app);
    agent = await authAsUser(app, "admin");

    // Test POST operation (add to array)
    await agent
      .post(`/food/${apple._id}/categories`)
      .send({categories: {name: "New Category", show: true}})
      .expect(200);

    expect(postUpdateCalled).toBe(true);
    expect(postUpdateDoc).toBeDefined();
    expect(postUpdatePrevDoc).toBeDefined();

    // Verify they are different object references
    expect(postUpdateDoc).not.toBe(postUpdatePrevDoc);

    // Verify the content is different (new category added)
    expect(postUpdateDoc.categories).toHaveLength(3);
    expect(postUpdatePrevDoc.categories).toHaveLength(2);

    // Reset for next test
    postUpdateCalled = false;
    postUpdateDoc = undefined;
    postUpdatePrevDoc = undefined;

    // Test PATCH operation (update array item)
    const categoryId = apple.categories[0]._id;
    if (!categoryId) {
      throw new Error("Category ID is undefined");
    }
    await agent
      .patch(`/food/${apple._id}/categories/${categoryId}`)
      .send({categories: {name: "Updated Category", show: false}})
      .expect(200);

    expect(postUpdateCalled).toBe(true);
    expect(postUpdateDoc).toBeDefined();
    expect(postUpdatePrevDoc).toBeDefined();

    // Verify they are different object references
    expect(postUpdateDoc).not.toBe(postUpdatePrevDoc);

    // Verify the content is different (category updated)
    const updatedCategory = postUpdateDoc.categories.find(
      (c: FoodCategory) => c._id.toString() === categoryId.toString()
    );
    const prevCategory = postUpdatePrevDoc.categories.find(
      (c: FoodCategory) => c._id.toString() === categoryId.toString()
    );

    expect(updatedCategory.name).toBe("Updated Category");
    expect(prevCategory.name).toBe("Fruit");

    // Reset for next test
    postUpdateCalled = false;
    postUpdateDoc = undefined;
    postUpdatePrevDoc = undefined;

    // Test DELETE operation (remove from array)
    await agent.delete(`/food/${apple._id}/categories/${categoryId}`).expect(200);

    expect(postUpdateCalled).toBe(true);
    expect(postUpdateDoc).toBeDefined();
    expect(postUpdatePrevDoc).toBeDefined();

    // Verify they are different object references
    expect(postUpdateDoc).not.toBe(postUpdatePrevDoc);

    // Verify the content is different (category removed)
    const remainingCategories = postUpdateDoc.categories.filter(
      (c: FoodCategory) => c._id.toString() === categoryId.toString()
    );
    const prevCategories = postUpdatePrevDoc.categories.filter(
      (c: FoodCategory) => c._id.toString() === categoryId.toString()
    );

    expect(remainingCategories).toHaveLength(0);
    expect(prevCategories).toHaveLength(1);
  });

  it("array operations with string arrays call postUpdate with different copy", async () => {
    let postUpdateDoc: Food | undefined;
    let postUpdatePrevDoc: Food | undefined;
    let postUpdateCalled = false;

    app = getBaseServer();
    setupAuth(app, UserModel as unknown as AuthUserModel);
    addAuthRoutes(app, UserModel as unknown as AuthUserModel);
    app.use(
      "/food",
      modelRouter(FoodModel, {
        allowAnonymous: true,
        permissions: {
          create: [Permissions.IsAdmin],
          delete: [Permissions.IsAdmin],
          list: [Permissions.IsAdmin],
          read: [Permissions.IsAdmin],
          update: [Permissions.IsAdmin],
        },
        postUpdate: async (doc, _cleanedBody, _request, prevValue) => {
          postUpdateDoc = doc;
          postUpdatePrevDoc = prevValue;
          postUpdateCalled = true;
        },
      })
    );
    _server = supertest(app);
    agent = await authAsUser(app, "admin");

    // Test POST operation with string array (add tag)
    await agent.post(`/food/${apple._id}/tags`).send({tags: "organic"}).expect(200);

    expect(postUpdateCalled).toBe(true);
    expect(postUpdateDoc).toBeDefined();
    expect(postUpdatePrevDoc).toBeDefined();

    // Verify they are different object references
    expect(postUpdateDoc).not.toBe(postUpdatePrevDoc);

    // Verify the content is different (new tag added)
    expect(postUpdateDoc.tags).toHaveLength(3);
    expect(postUpdatePrevDoc.tags).toHaveLength(2);
    expect(postUpdateDoc.tags).toContain("organic");
    expect(postUpdatePrevDoc.tags).not.toContain("organic");

    // Reset for next test
    postUpdateCalled = false;
    postUpdateDoc = undefined;
    postUpdatePrevDoc = undefined;

    // Test PATCH operation with string array (update tag)
    await agent.patch(`/food/${apple._id}/tags/healthy`).send({tags: "super-healthy"}).expect(200);

    expect(postUpdateCalled).toBe(true);
    expect(postUpdateDoc).not.toBe(postUpdatePrevDoc);

    // Verify the content is different (tag updated)
    expect(postUpdateDoc.tags).toContain("super-healthy");
    expect(postUpdatePrevDoc.tags).toContain("healthy");
    expect(postUpdateDoc.tags).not.toContain("healthy");
    expect(postUpdatePrevDoc.tags).not.toContain("super-healthy");
  });
});

describe("array operation errors", () => {
  let _server: TestAgent;
  let app: express.Application;
  let admin: TestUser;
  let apple: Food;
  let agent: TestAgent;

  beforeEach(async () => {
    [admin] = await setupDb();

    apple = await FoodModel.create({
      calories: 100,
      categories: [
        {name: "Fruit", show: true},
        {name: "Popular", show: false},
      ],
      created: new Date("2021-12-03T00:00:30.000Z"),
      hidden: false,
      name: "Apple",
      ownerId: admin._id,
      tags: ["healthy", "cheap"],
    });

    app = getBaseServer();
    setupAuth(app, UserModel as unknown as AuthUserModel);
    addAuthRoutes(app, UserModel as unknown as AuthUserModel);
  });

  it("rejects array operations on non-array fields with a structured error", async () => {
    app.use(
      "/food",
      modelRouter(FoodModel, {
        allowAnonymous: true,
        permissions: {
          create: [Permissions.IsAdmin],
          delete: [Permissions.IsAdmin],
          list: [Permissions.IsAdmin],
          read: [Permissions.IsAdmin],
          update: [Permissions.IsAdmin],
        },
      })
    );
    agent = await authAsUser(app, "admin");

    const res = await agent.post(`/food/${apple._id}/name`).send({name: "Pear"}).expect(400);
    assert.equal(res.body.code, "array-operation-field-not-array");
    assert.equal(res.body.title, "Array operation field is not an array");
  });

  it("runs preUpdate before rejecting a non-array field", async () => {
    app.use(
      "/food",
      modelRouter(FoodModel, {
        allowAnonymous: true,
        permissions: {
          create: [Permissions.IsAdmin],
          delete: [Permissions.IsAdmin],
          list: [Permissions.IsAdmin],
          read: [Permissions.IsAdmin],
          update: [Permissions.IsAdmin],
        },
        preUpdate: () => null,
      })
    );
    agent = await authAsUser(app, "admin");

    const res = await agent.post(`/food/${apple._id}/name`).send({name: "Pear"}).expect(403);
    assert.equal(res.body.code, "update-not-allowed");
    assert.equal(res.body.title, "Update not allowed");
  });

  it("array operation preUpdate returning undefined throws error", async () => {
    app.use(
      "/food",
      modelRouter(FoodModel, {
        allowAnonymous: true,
        permissions: {
          create: [Permissions.IsAdmin],
          delete: [Permissions.IsAdmin],
          list: [Permissions.IsAdmin],
          read: [Permissions.IsAdmin],
          update: [Permissions.IsAdmin],
        },
        preUpdate: () => undefined as unknown as Food,
      })
    );
    _server = supertest(app);
    agent = await authAsUser(app, "admin");

    const res = await agent.post(`/food/${apple._id}/tags`).send({tags: "organic"}).expect(403);
    expect(res.body.title).toBe("Update not allowed");
    expect(res.body.detail).toBe("A body must be returned from preUpdate");
  });

  it("array operation preUpdate returning null throws error", async () => {
    app.use(
      "/food",
      modelRouter(FoodModel, {
        allowAnonymous: true,
        permissions: {
          create: [Permissions.IsAdmin],
          delete: [Permissions.IsAdmin],
          list: [Permissions.IsAdmin],
          read: [Permissions.IsAdmin],
          update: [Permissions.IsAdmin],
        },
        preUpdate: () => null,
      })
    );
    _server = supertest(app);
    agent = await authAsUser(app, "admin");

    const res = await agent.post(`/food/${apple._id}/tags`).send({tags: "organic"}).expect(403);
    expect(res.body.title).toBe("Update not allowed");
  });

  it("array operation preUpdate error is handled", async () => {
    app.use(
      "/food",
      modelRouter(FoodModel, {
        allowAnonymous: true,
        permissions: {
          create: [Permissions.IsAdmin],
          delete: [Permissions.IsAdmin],
          list: [Permissions.IsAdmin],
          read: [Permissions.IsAdmin],
          update: [Permissions.IsAdmin],
        },
        preUpdate: () => {
          throw new Error("preUpdate array failed");
        },
      })
    );
    _server = supertest(app);
    agent = await authAsUser(app, "admin");

    const res = await agent.post(`/food/${apple._id}/tags`).send({tags: "organic"}).expect(400);
    expect(res.body.title).toContain("preUpdate hook error");
  });

  it("array operation postUpdate error is handled", async () => {
    app.use(
      "/food",
      modelRouter(FoodModel, {
        allowAnonymous: true,
        permissions: {
          create: [Permissions.IsAdmin],
          delete: [Permissions.IsAdmin],
          list: [Permissions.IsAdmin],
          read: [Permissions.IsAdmin],
          update: [Permissions.IsAdmin],
        },
        postUpdate: () => {
          throw new Error("postUpdate array failed");
        },
      })
    );
    _server = supertest(app);
    agent = await authAsUser(app, "admin");

    const res = await agent.post(`/food/${apple._id}/tags`).send({tags: "organic"}).expect(400);
    expect(res.body.title).toContain("PATCH Post Update error");
  });

  it("array operation denied without update permission", async () => {
    app.use(
      "/food",
      modelRouter(FoodModel, {
        allowAnonymous: true,
        permissions: {
          create: [Permissions.IsAdmin],
          delete: [Permissions.IsAdmin],
          list: [Permissions.IsAny],
          read: [Permissions.IsAny],
          update: [Permissions.IsAdmin],
        },
      })
    );
    _server = supertest(app);
    agent = await authAsUser(app, "notAdmin");

    const res = await agent.post(`/food/${apple._id}/tags`).send({tags: "organic"}).expect(405);
    expect(res.body.title).toBe("Access denied");
    expect(res.body.detail).toContain("Access to PATCH");
  });

  it("lets a later route handle non-ObjectId paths under the same prefix", async () => {
    app.use(
      "/ai",
      modelRouter(FoodModel, {
        allowAnonymous: true,
        permissions: {
          create: [],
          delete: [],
          list: [],
          read: [],
          update: [],
        },
      })
    );
    app.post("/ai/observability/evaluators", (_req, res) => {
      res.status(201).json({data: {created: true}});
    });
    _server = supertest(app);

    const created = await _server
      .post("/ai/observability/evaluators")
      .send({name: "toxicity", target: "full trace"})
      .expect(201);
    expect(created.body.data.created).toBe(true);

    const denied = await _server.post(`/ai/${apple._id}/tags`).send({tags: "organic"}).expect(405);
    expect(denied.body.code).toBe("array-update-not-allowed");
  });

  it("array operation on non-existent document returns 404", async () => {
    app.use(
      "/food",
      modelRouter(FoodModel, {
        allowAnonymous: true,
        permissions: {
          create: [Permissions.IsAdmin],
          delete: [Permissions.IsAdmin],
          list: [Permissions.IsAdmin],
          read: [Permissions.IsAdmin],
          update: [Permissions.IsAdmin],
        },
      })
    );
    _server = supertest(app);
    agent = await authAsUser(app, "admin");

    const fakeId = "000000000000000000000000";
    const res = await agent.post(`/food/${fakeId}/tags`).send({tags: "organic"}).expect(404);
    expect(res.body.title).toBe("Document not found");
    expect(res.body.detail).toContain("Could not find document to PATCH");
  });

  it("array operation denied when user cannot update specific doc", async () => {
    // Create food owned by admin, then try to update as notAdmin
    app.use(
      "/food",
      modelRouter(FoodModel, {
        allowAnonymous: true,
        permissions: {
          create: [Permissions.IsAuthenticated],
          delete: [Permissions.IsAuthenticated],
          list: [Permissions.IsAuthenticated],
          read: [Permissions.IsAuthenticated],
          update: [Permissions.IsOwner],
        },
      })
    );
    _server = supertest(app);
    // Login as notAdmin and try to update admin's food (apple)
    agent = await authAsUser(app, "notAdmin");

    const res = await agent.post(`/food/${apple._id}/tags`).send({tags: "organic"}).expect(403);
    expect(res.body.title).toBe("Update not allowed");
    expect(res.body.detail).toContain("Patch not allowed");
  });

  it("array operation transform error is handled", async () => {
    app.use(
      "/food",
      modelRouter(FoodModel, {
        allowAnonymous: true,
        permissions: {
          create: [Permissions.IsAdmin],
          delete: [Permissions.IsAdmin],
          list: [Permissions.IsAdmin],
          read: [Permissions.IsAdmin],
          update: [Permissions.IsAdmin],
        },
        transformer: AdminOwnerTransformer({
          adminWriteFields: ["name"],
        }),
      })
    );
    _server = supertest(app);
    agent = await authAsUser(app, "admin");

    // Try to update tags field, which is not in the allowed write fields
    const res = await agent.post(`/food/${apple._id}/tags`).send({tags: "organic"}).expect(403);
    expect(res.body.title).toContain("cannot write fields");
  });
});

describe("array operation with undefined preUpdate return", () => {
  let _server: TestAgent;
  let app: express.Application;
  let admin: TestUser;
  let apple: Food;
  let agent: TestAgent;

  beforeEach(async () => {
    [admin] = await setupDb();

    apple = await FoodModel.create({
      calories: 100,
      categories: [
        {name: "Fruit", show: true},
        {name: "Popular", show: false},
      ],
      created: new Date("2021-12-03T00:00:30.000Z"),
      hidden: false,
      name: "Apple",
      ownerId: admin._id,
      tags: ["healthy", "cheap"],
    });

    app = getBaseServer();
    setupAuth(app, UserModel as unknown as AuthUserModel);
    addAuthRoutes(app, UserModel as unknown as AuthUserModel);
  });

  it("array operation preUpdate returning undefined for array POST throws error", async () => {
    app.use(
      "/food",
      modelRouter(FoodModel, {
        allowAnonymous: true,
        permissions: {
          create: [Permissions.IsAdmin],
          delete: [Permissions.IsAdmin],
          list: [Permissions.IsAdmin],
          read: [Permissions.IsAdmin],
          update: [Permissions.IsAdmin],
        },
        preUpdate: () => undefined as unknown as Food,
      })
    );
    _server = supertest(app);
    agent = await authAsUser(app, "admin");

    const res = await agent.post(`/food/${apple._id}/tags`).send({tags: "organic"}).expect(403);
    expect(res.body.title).toBe("Update not allowed");
    expect(res.body.detail).toBe("A body must be returned from preUpdate");
  });

  it("array operation preUpdate returning null for array PATCH throws error", async () => {
    app.use(
      "/food",
      modelRouter(FoodModel, {
        allowAnonymous: true,
        permissions: {
          create: [Permissions.IsAdmin],
          delete: [Permissions.IsAdmin],
          list: [Permissions.IsAdmin],
          read: [Permissions.IsAdmin],
          update: [Permissions.IsAdmin],
        },
        preUpdate: () => null,
      })
    );
    _server = supertest(app);
    agent = await authAsUser(app, "admin");

    const res = await agent
      .patch(`/food/${apple._id}/tags/healthy`)
      .send({tags: "unhealthy"})
      .expect(403);
    expect(res.body.title).toBe("Update not allowed");
  });

  it("array operation preUpdate error for array DELETE is handled", async () => {
    app.use(
      "/food",
      modelRouter(FoodModel, {
        allowAnonymous: true,
        permissions: {
          create: [Permissions.IsAdmin],
          delete: [Permissions.IsAdmin],
          list: [Permissions.IsAdmin],
          read: [Permissions.IsAdmin],
          update: [Permissions.IsAdmin],
        },
        preUpdate: () => {
          throw new Error("preUpdate error during delete");
        },
      })
    );
    _server = supertest(app);
    agent = await authAsUser(app, "admin");

    const res = await agent.delete(`/food/${apple._id}/tags/healthy`).expect(400);
    expect(res.body.title).toContain("preUpdate hook error");
  });
});
