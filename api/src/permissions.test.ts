import {beforeEach, describe, expect, it} from "bun:test";
import type express from "express";
import mongoose from "mongoose";
import supertest from "supertest";
import type TestAgent from "supertest/lib/agent";

import {modelRouter} from "./api";
import {
  type User as AuthUser,
  type UserModel as AuthUserModel,
  addAuthRoutes,
  setupAuth,
} from "./auth";
import {Membership, Organization} from "./orgs/organizationModel";
import {runWithOrgContext} from "./orgs/orgContext";
import {
  getUserOrganizationIds,
  OrganizationQueryFilter,
  OwnerQueryFilter,
  Permissions,
} from "./permissions";
import {
  authAsUser,
  type Food,
  FoodModel,
  getBaseServer,
  RequiredModel,
  setupTestData,
  UserModel,
} from "./tests";

describe("permissions", () => {
  let server: TestAgent;
  let app: express.Application;

  beforeEach(async () => {
    process.env.REFRESH_TOKEN_SECRET = "testsecret1234";

    await setupTestData();
    app = getBaseServer();
    setupAuth(app, UserModel as unknown as AuthUserModel);
    addAuthRoutes(app, UserModel as unknown as AuthUserModel);
    app.use(
      "/food",
      modelRouter(FoodModel, {
        allowAnonymous: true,
        permissions: {
          create: [Permissions.IsAuthenticated],
          delete: [Permissions.IsAdmin],
          list: [Permissions.IsAny],
          read: [Permissions.IsAny],
          update: [Permissions.IsOwner],
        },
      })
    );
    app.use(
      "/required",
      modelRouter(RequiredModel, {
        permissions: {
          create: [Permissions.IsAuthenticated],
          delete: [Permissions.IsAdmin],
          list: [Permissions.IsAny],
          read: [Permissions.IsAny],
          update: [Permissions.IsOwner],
        },
      })
    );
    server = supertest(app);
  });

  describe("anonymous food", () => {
    it("list", async () => {
      const res = await server.get("/food").expect(200);
      expect(res.body.data).toHaveLength(4);
    });

    it("get", async () => {
      const res = await server.get("/food").expect(200);
      expect(res.body.data).toHaveLength(4);
      const res2 = await server.get(`/food/${res.body.data[0]._id}`).expect(200);
      expect(res.body.data[0]._id).toBe(res2.body.data._id);
    });

    it("post", async () => {
      const res = await server.post("/food").send({
        calories: 15,
        name: "Broccoli",
      });
      expect(res.status).toBe(405);
    });

    it("patch", async () => {
      const res = await server.get("/food");
      const res2 = await server.patch(`/food/${res.body.data[0]._id}`).send({
        name: "Broccoli",
      });
      expect(res2.status).toBe(403);
    });

    it("delete", async () => {
      const res = await server.get("/food");
      const res2 = await server.delete(`/food/${res.body.data[0]._id}`);
      expect(res2.status).toBe(405);
    });
  });

  describe("non admin food", () => {
    let agent: TestAgent;

    beforeEach(async () => {
      agent = await authAsUser(app, "notAdmin");
    });

    it("list", async () => {
      const res = await agent.get("/food").expect(200);
      expect(res.body.data).toHaveLength(4);
    });

    it("get", async () => {
      const res = await agent.get("/food").expect(200);
      expect(res.body.data).toHaveLength(4);
      const res2 = await server.get(`/food/${res.body.data[0]._id}`).expect(200);
      expect(res.body.data[0]._id).toBe(res2.body.data._id);
    });

    it("post", async () => {
      await agent
        .post("/food")
        .send({
          calories: 15,
          name: "Broccoli",
        })
        .expect(201);
    });

    it("patch own item", async () => {
      const res = await agent.get("/food");
      const spinach = res.body.data.find((food: Food) => food.name === "Spinach");
      const res2 = await agent
        .patch(`/food/${spinach._id}`)
        .send({
          name: "Broccoli",
        })
        .expect(200);
      expect(res2.body.data.name).toBe("Broccoli");
    });

    it("patch other item", async () => {
      const res = await agent.get("/food");
      const spinach = res.body.data.find((food: Food) => food.name === "Apple");
      await agent
        .patch(`/food/${spinach._id}`)
        .send({
          name: "Broccoli",
        })
        .expect(403);
    });

    it("delete", async () => {
      const res = await agent.get("/food");
      const res2 = await agent.delete(`/food/${res.body.data[0]._id}`);
      expect(res2.status).toBe(405);
    });
  });

  describe("admin food", () => {
    let agent: TestAgent;

    beforeEach(async () => {
      agent = await authAsUser(app, "admin");
    });

    it("list", async () => {
      const res = await agent.get("/food");
      expect(res.body.data).toHaveLength(4);
    });

    it("get", async () => {
      const res = await agent.get("/food");
      expect(res.body.data).toHaveLength(4);
      const res2 = await agent.get(`/food/${res.body.data[0]._id}`);
      expect(res.body.data[0]._id).toBe(res2.body.data._id);
    });

    it("post", async () => {
      const res = await agent.post("/food").send({
        calories: 15,
        name: "Broccoli",
      });
      expect(res.status).toBe(201);
    });

    it("patch", async () => {
      const res = await agent.get("/food");
      await agent
        .patch(`/food/${res.body.data[0]._id}`)
        .send({
          name: "Broccoli",
        })
        .expect(200);
    });

    it("delete", async () => {
      const res = await agent.get("/food");
      await agent.delete(`/food/${res.body.data[0]._id}`).expect(204);
    });

    it("handles validation errors", async () => {
      await agent
        .post("/required")
        .send({
          about: "Whoops forgot required",
        })
        .expect(400);
    });
  });
});

const testUser = (
  overrides: Partial<AuthUser & {organizationIds?: string[]; isAnonymous?: boolean}> = {}
): AuthUser & {organizationIds?: string[]; isAnonymous?: boolean} => ({
  _id: "user-123",
  admin: false,
  id: "user-123",
  ...overrides,
});

describe("permissions module", () => {
  describe("OwnerQueryFilter", () => {
    it("returns ownerId filter when user is provided", () => {
      const user = testUser();
      const filter = OwnerQueryFilter(user);
      expect(filter).toEqual({ownerId: "user-123"});
    });

    it("returns null when user is undefined", () => {
      const filter = OwnerQueryFilter(undefined);
      expect(filter).toBeNull();
    });
  });

  describe("getUserOrganizationIds", () => {
    it("returns the user's organizationIds", () => {
      const user = testUser({id: "u1", organizationIds: ["org-1", "org-2"]});
      expect(getUserOrganizationIds(user)).toEqual(["org-1", "org-2"]);
    });

    it("returns an empty array when missing or undefined", () => {
      expect(getUserOrganizationIds(testUser({id: "u1"}))).toEqual([]);
      expect(getUserOrganizationIds(undefined)).toEqual([]);
    });
  });

  describe("OrganizationQueryFilter", () => {
    it("scopes to the request organization context", () => {
      const orgId = new mongoose.Types.ObjectId();
      const filter = runWithOrgContext({organization: {_id: orgId} as never}, () =>
        OrganizationQueryFilter(testUser({id: "u1"}))
      );
      expect(filter).toEqual({organizationId: orgId});
    });

    it("throws when organization context is missing", () => {
      expect(() => OrganizationQueryFilter(testUser({id: "u1"}))).toThrow(
        "Organization context required"
      );
      expect(() => OrganizationQueryFilter(undefined)).toThrow("Organization context required");
    });
  });

  describe("Permissions.IsOrganizationMember", () => {
    beforeEach(async () => {
      await Membership.deleteMany({});
      await Organization.deleteMany({});
    });
    it("returns true when no object is provided", async () => {
      expect(await Permissions.IsOrganizationMember("list", testUser({id: "u1"}), undefined)).toBe(
        true
      );
    });

    it("returns false when there is no user", async () => {
      expect(
        await Permissions.IsOrganizationMember("read", undefined, {organizationId: "org-1"})
      ).toBe(false);
    });

    it("returns false for user.admin without platform org roles", async () => {
      const user = testUser({
        _id: new mongoose.Types.ObjectId() as unknown as AuthUser["_id"],
        admin: true,
        id: new mongoose.Types.ObjectId().toString(),
      });
      expect(
        await Permissions.IsOrganizationMember("update", user, {
          organizationId: new mongoose.Types.ObjectId(),
        })
      ).toBe(false);
    });

    it("returns true when the caller has an active membership in the active org context", async () => {
      const org = await Organization.create({
        name: "Perm Org",
        ownerId: new mongoose.Types.ObjectId(),
      });
      const userId = new mongoose.Types.ObjectId();
      await Membership.create({
        organizationId: org._id,
        roleName: "member",
        userId,
      });
      const user = testUser({_id: userId as unknown as AuthUser["_id"], id: userId.toString()});
      const allowed = await runWithOrgContext({organization: org}, () =>
        Permissions.IsOrganizationMember("update", user, {organizationId: org._id})
      );
      expect(await allowed).toBe(true);
    });

    it("returns false when the user does not belong to the document's organization", async () => {
      const user = testUser({id: new mongoose.Types.ObjectId().toString()});
      expect(
        await Permissions.IsOrganizationMember("update", user, {
          organizationId: new mongoose.Types.ObjectId(),
        })
      ).toBe(false);
    });

    it("returns false when the document has no organizationId", async () => {
      const user = testUser({id: "u1"});
      expect(await Permissions.IsOrganizationMember("read", user, {})).toBe(false);
    });
  });

  describe("Permissions.IsAuthenticatedOrReadOnly", () => {
    it("returns true for authenticated non-anonymous users", () => {
      const user = testUser({isAnonymous: false});
      expect(Permissions.IsAuthenticatedOrReadOnly("create", user)).toBe(true);
    });

    it("returns true for read methods when user is anonymous", () => {
      const user = testUser({isAnonymous: true});
      expect(Permissions.IsAuthenticatedOrReadOnly("list", user)).toBe(true);
      expect(Permissions.IsAuthenticatedOrReadOnly("read", user)).toBe(true);
    });

    it("returns false for write methods when user is anonymous", () => {
      const user = testUser({isAnonymous: true});
      expect(Permissions.IsAuthenticatedOrReadOnly("create", user)).toBe(false);
      expect(Permissions.IsAuthenticatedOrReadOnly("update", user)).toBe(false);
      expect(Permissions.IsAuthenticatedOrReadOnly("delete", user)).toBe(false);
    });
  });

  describe("Permissions.IsOwnerOrReadOnly", () => {
    it("returns true when no object is provided", () => {
      expect(Permissions.IsOwnerOrReadOnly("update", testUser(), undefined)).toBe(true);
    });

    it("returns true for admin users", () => {
      const user = testUser({admin: true, id: "admin-123"});
      const obj = {ownerId: "other-user"};
      expect(Permissions.IsOwnerOrReadOnly("update", user, obj)).toBe(true);
    });

    it("returns true when user is owner", () => {
      const user = testUser();
      const obj = {ownerId: "user-123"};
      expect(Permissions.IsOwnerOrReadOnly("update", user, obj)).toBe(true);
    });

    it("returns true for read methods when not owner", () => {
      const user = testUser();
      const obj = {ownerId: "other-user"};
      expect(Permissions.IsOwnerOrReadOnly("list", user, obj)).toBe(true);
      expect(Permissions.IsOwnerOrReadOnly("read", user, obj)).toBe(true);
    });

    it("returns false for write methods when not owner", () => {
      const user = testUser();
      const obj = {ownerId: "other-user"};
      expect(Permissions.IsOwnerOrReadOnly("update", user, obj)).toBe(false);
      expect(Permissions.IsOwnerOrReadOnly("delete", user, obj)).toBe(false);
    });
  });
});
