import {beforeEach, describe, expect, it} from "bun:test";
import type express from "express";
import mongoose, {type Model, model, Schema} from "mongoose";
import type TestAgent from "supertest/lib/agent";

import {type UserModel as AuthUserModel, addAuthRoutes, setupAuth} from "../auth";
import {apiErrorMiddleware} from "../errors";
import {authAsUser, getBaseServer, setupDb, UserModel} from "../tests";
import {createAccess} from "./access";
import {rbacRouter} from "./routes";
import {type PermissionSet, terrenoStatements} from "./statements";
import type {AnyTerrenoAccess} from "./types";

interface RouteUser {
  admin: boolean;
  email: string;
  roles: string[];
}

const appStatements = {
  ...terrenoStatements,
  todo: ["create", "read", "update", "delete", "list"],
} as const;

const allPermissions: PermissionSet = Object.fromEntries(
  Object.entries(appStatements).map(([resource, actions]) => [resource, [...actions]])
);

const getRouteUserModel = (): Model<RouteUser> => {
  const modelName = "RbacRoutesTestUser";
  if (mongoose.models[modelName]) {
    return mongoose.models[modelName] as Model<RouteUser>;
  }

  const schema = new Schema<RouteUser>({
    admin: {default: false, description: "Whether the user is an administrator", type: Boolean},
    email: {description: "The user's email address", required: true, type: String},
    roles: {default: [], description: "The user's RBAC roles", type: [String]},
  });

  return model<RouteUser>(modelName, schema);
};

const authUserModel = UserModel as unknown as AuthUserModel;

const createRequestMutationAccess = (
  access: AnyTerrenoAccess,
  mutate: (request: express.Request) => void
): AnyTerrenoAccess => ({
  ...access,
  middleware: (permissions, options) => {
    const accessMiddleware = access.middleware(permissions, options);
    return (request, response, next) => {
      accessMiddleware(request, response, (error?: unknown) => {
        if (error) {
          next(error);
          return;
        }
        mutate(request);
        next();
      });
    };
  },
});

describe("rbacRouter", () => {
  let app: express.Application;
  let adminAgent: TestAgent;
  let routeUserModel: Model<RouteUser>;
  let targetUserId: string;

  beforeEach(async () => {
    await setupDb();
    routeUserModel = getRouteUserModel();
    await routeUserModel.deleteMany({});
    const targetUser = await routeUserModel.create({
      email: "target@example.com",
      roles: ["member"],
    });
    targetUserId = targetUser.id;

    const access = createAccess({
      connection: mongoose.connection,
      resolvePermissions: async ({user}) => (user.admin ? allPermissions : {}),
      statements: appStatements,
      userModel: routeUserModel as unknown as AuthUserModel,
    });
    await access.roles.seedDefaults();

    app = getBaseServer();
    setupAuth(app, authUserModel);
    addAuthRoutes(app, authUserModel);
    rbacRouter({
      access,
      basePath: "/rbac",
      userModel: routeUserModel as unknown as AuthUserModel,
    }).register(app);
    rbacRouter({
      access: createRequestMutationAccess(access, (request) => {
        request.user = undefined;
      }),
      basePath: "/rbac-unauthorized",
      userModel: routeUserModel as unknown as AuthUserModel,
    }).register(app);
    rbacRouter({
      access: createRequestMutationAccess(access, (request) => {
        Reflect.deleteProperty(request.params, "id");
        Reflect.deleteProperty(request.params, "name");
      }),
      basePath: "/rbac-invalid-params",
      userModel: routeUserModel as unknown as AuthUserModel,
    }).register(app);
    app.use(apiErrorMiddleware);

    adminAgent = await authAsUser(app, "admin");
  });

  it("serves statements and supports role and user operations", async () => {
    const statementsResponse = await adminAgent.get("/rbac/statements").expect(200);
    expect(statementsResponse.body.data.statements.rbac).toEqual([
      "read",
      "manageRoles",
      "assignRoles",
    ]);

    const rolesResponse = await adminAgent.get("/rbac/roles").expect(200);
    expect(rolesResponse.body.data.map((role: {name: string}) => role.name)).toEqual(
      expect.arrayContaining(["superadmin", "member"])
    );

    const createResponse = await adminAgent
      .post("/rbac/roles")
      .send({
        displayName: "Route Editor",
        name: "route-editor",
        permissions: {todo: ["read"]},
      })
      .expect(201);
    expect(createResponse.body.data.name).toBe("route-editor");

    const updateResponse = await adminAgent
      .patch("/rbac/roles/route-editor")
      .send({displayName: "Updated Route Editor"})
      .expect(200);
    expect(updateResponse.body.data.displayName).toBe("Updated Route Editor");

    const rolePreviewResponse = await adminAgent
      .post("/rbac/roles/route-editor/preview")
      .send({permissions: {todo: ["read", "update"]}})
      .expect(200);
    expect(rolePreviewResponse.body.data.gained.todo).toEqual(["update"]);

    const permissionsResponse = await adminAgent
      .get(`/rbac/users/${targetUserId}/permissions`)
      .expect(200);
    expect(permissionsResponse.body.data.roles).toEqual(["member"]);

    await adminAgent
      .put(`/rbac/users/${targetUserId}/roles`)
      .send({roleNames: ["auditor"]})
      .expect(200);
    const assignedUser = await routeUserModel.findById(targetUserId);
    expect(assignedUser?.roles).toEqual(["auditor"]);

    const assignmentPreviewResponse = await adminAgent
      .post(`/rbac/users/${targetUserId}/roles/preview`)
      .send({roleNames: ["member"]})
      .expect(200);
    expect(assignmentPreviewResponse.body.data).toHaveProperty("gained");

    await adminAgent.delete("/rbac/roles/route-editor").expect(204);
  });

  it("returns unauthorized when a handler has no actor", async () => {
    const actorlessRoutes = [
      {body: {}, method: "post", path: "/rbac-unauthorized/roles"},
      {body: {}, method: "patch", path: "/rbac-unauthorized/roles/member"},
      {method: "delete", path: "/rbac-unauthorized/roles/member"},
      {
        body: {roleNames: ["member"]},
        method: "put",
        path: `/rbac-unauthorized/users/${targetUserId}/roles`,
      },
    ] as const;

    for (const route of actorlessRoutes) {
      const response =
        route.method === "post"
          ? await adminAgent.post(route.path).send(route.body)
          : route.method === "patch"
            ? await adminAgent.patch(route.path).send(route.body)
            : route.method === "put"
              ? await adminAgent.put(route.path).send(route.body)
              : await adminAgent.delete(route.path);
      expect(response.status).toBe(401);
      expect(response.body.title).toBe("Unauthorized");
    }
  });

  it("validates missing route parameters", async () => {
    const roleResponse = await adminAgent
      .patch("/rbac-invalid-params/roles/member")
      .send({displayName: "Missing Name"});
    expect(roleResponse.status).toBe(400);
    expect(roleResponse.body.title).toBe("Role name is required");

    const userResponse = await adminAgent.get(
      `/rbac-invalid-params/users/${targetUserId}/permissions`
    );
    expect(userResponse.status).toBe(400);
    expect(userResponse.body.title).toBe("User id is required");
  });

  it("validates role assignment bodies and missing users", async () => {
    const missingRoleNamesResponse = await adminAgent
      .put(`/rbac/users/${targetUserId}/roles`)
      .send({});
    expect(missingRoleNamesResponse.status).toBe(400);
    expect(missingRoleNamesResponse.body.title).toBe("roleNames is required");

    const missingPreviewRoleNamesResponse = await adminAgent
      .post(`/rbac/users/${targetUserId}/roles/preview`)
      .send({});
    expect(missingPreviewRoleNamesResponse.status).toBe(400);
    expect(missingPreviewRoleNamesResponse.body.title).toBe("roleNames is required");

    const missingUserResponse = await adminAgent.get(
      `/rbac/users/${new mongoose.Types.ObjectId()}/permissions`
    );
    expect(missingUserResponse.status).toBe(404);
    expect(missingUserResponse.body.title).toBe("User not found");
  });
});

describe("rbacRouter role assignment against a partially resolved target", () => {
  it("refuses PUT /rbac/users/:id/roles with 503 when the target's source grants are unknown", async () => {
    await setupDb();
    const routeUserModel = getRouteUserModel();
    await routeUserModel.deleteMany({});
    const target = await routeUserModel.create({email: "source-target@example.com", roles: []});
    let isDown = false;
    const access = createAccess({
      connection: mongoose.connection,
      // The signed-in actor may assign roles but does not hold user:delete.
      resolvePermissions: async ({user}) =>
        String(user.id) === target.id ? {} : {rbac: ["read", "assignRoles"]},
      sources: [
        {
          // Additive only, so an outage drops its grants instead of failing every request.
          failClosedWhenDenyUnknown: false,
          getGrants: async ({user}) => {
            if (String(user.id) !== target.id) {
              return null;
            }
            if (isDown) {
              throw new Error("idp down");
            }
            return {permissions: {user: ["delete"]}};
          },
          name: "idp-grants",
          ttlMs: 0,
        },
      ],
      statements: appStatements,
      userModel: routeUserModel as unknown as AuthUserModel,
    });
    await access.roles.seedDefaults();
    const app = getBaseServer();
    setupAuth(app, authUserModel);
    addAuthRoutes(app, authUserModel);
    rbacRouter({
      access,
      basePath: "/rbac",
      userModel: routeUserModel as unknown as AuthUserModel,
    }).register(app);
    app.use(apiErrorMiddleware);
    const agent = await authAsUser(app, "notAdmin");

    const healthy = await agent.put(`/rbac/users/${target.id}/roles`).send({roleNames: ["member"]});
    expect(healthy.status).toBe(403);
    expect(healthy.body.title).toBe("Cannot modify a user with permissions you do not hold");

    isDown = true;
    access.invalidateCache({userId: target.id});

    const down = await agent.put(`/rbac/users/${target.id}/roles`).send({roleNames: ["member"]});
    expect(down.status).toBe(503);
    expect(down.body.title).toBe("Permission source unavailable");
    expect((await routeUserModel.findById(target.id))?.roles).toEqual([]);
  });
});
