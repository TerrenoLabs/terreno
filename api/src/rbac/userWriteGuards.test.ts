import {beforeEach, describe, expect, it} from "bun:test";
import type express from "express";
import mongoose from "mongoose";

import {modelRouter} from "../api";
import {addAuthRoutes, setupAuth, type UserModel as UserMongooseModel} from "../auth";
import {apiErrorMiddleware, apiUnauthorizedMiddleware} from "../errors";
import {Permissions} from "../permissions";
import {executeDelete, executeUpdate} from "../sync/executors";
import {authAsUser, getBaseServer, setupDb, type User, UserModel} from "../tests";
import {createAccess} from "./access";
import {terrenoStatements} from "./statements";
import type {AnyTerrenoAccess} from "./types";

const userPermissions = {
  create: [Permissions.IsAuthenticated],
  delete: [Permissions.IsAuthenticated],
  list: [Permissions.IsAuthenticated],
  read: [Permissions.IsAuthenticated],
  update: [Permissions.IsAuthenticated],
};

const buildAccess = async (): Promise<AnyTerrenoAccess> => {
  const access = createAccess({
    connection: mongoose.connection,
    statements: terrenoStatements,
    userModel: UserModel as unknown as UserMongooseModel,
  });
  await access.roles.seedDefaults();
  return access as unknown as AnyTerrenoAccess;
};

const setRoles = async (userId: unknown, roles: string[]): Promise<void> => {
  await UserModel.updateOne({_id: userId}, {$set: {roles}});
};

describe("RBAC target-privilege check on user model writes", () => {
  let delegate: User;
  let superadmin: User;
  let member: User;
  let access: AnyTerrenoAccess;

  beforeEach(async () => {
    const [, notAdmin] = await setupDb();
    access = await buildAccess();
    await setRoles(notAdmin._id, ["admin"]);
    const [superadminDoc, memberDoc] = await UserModel.create([
      {email: "target-superadmin@example.com", name: "Super", roles: ["superadmin"]},
      {email: "target-member@example.com", name: "Member", roles: ["member"]},
    ]);
    delegate = (await UserModel.findById(notAdmin._id).orFail()) as unknown as User;
    superadmin = superadminDoc as unknown as User;
    member = memberDoc as unknown as User;
  });

  const options = (): Parameters<typeof executeUpdate>[0]["options"] =>
    ({
      accessControl: access,
      permissions: userPermissions,
    }) as unknown as Parameters<typeof executeUpdate>[0]["options"];

  it("rejects an update to a user whose permissions the actor does not hold", async () => {
    await expect(
      executeUpdate({
        body: {email: "hijack@example.com"},
        id: superadmin.id,
        model: UserModel,
        options: options(),
        user: delegate,
      })
    ).rejects.toMatchObject({
      status: 403,
      title: "Cannot modify a user with permissions you do not hold",
    });
    const stored = await UserModel.findById(superadmin.id).lean();
    expect(stored?.email).toBe("target-superadmin@example.com");
  });

  it("rejects an update over sync admin windows that skip modelRouter permission checks", async () => {
    await expect(
      executeUpdate({
        body: {disabled: true},
        id: superadmin.id,
        model: UserModel,
        options: options(),
        skipPermissionChecks: true,
        user: delegate,
      })
    ).rejects.toMatchObject({status: 403});
  });

  it("rejects a delete of a more privileged user", async () => {
    await expect(
      executeDelete({
        id: superadmin.id,
        model: UserModel,
        options: options(),
        user: delegate,
      })
    ).rejects.toMatchObject({status: 403});
    expect(await UserModel.findById(superadmin.id)).toBeTruthy();
  });

  it("allows updates to users the actor covers, to the actor itself, and by legacy admins", async () => {
    await executeUpdate({
      body: {name: "Member renamed"},
      id: member.id,
      model: UserModel,
      options: options(),
      user: delegate,
    });
    await executeUpdate({
      body: {name: "Delegate renamed"},
      id: delegate.id,
      model: UserModel,
      options: options(),
      user: delegate,
    });
    const legacyAdmin = (await UserModel.findOne({email: "admin@example.com"})
      .orFail()
      .exec()) as unknown as User;
    await executeUpdate({
      body: {name: "Super renamed"},
      id: superadmin.id,
      model: UserModel,
      options: options(),
      user: legacyAdmin,
    });
    expect((await UserModel.findById(member.id).lean())?.name).toBe("Member renamed");
    expect((await UserModel.findById(delegate.id).lean())?.name).toBe("Delegate renamed");
    expect((await UserModel.findById(superadmin.id).lean())?.name).toBe("Super renamed");
  });

  it("does not check other models", async () => {
    await executeUpdate({
      body: {name: "Renamed elsewhere"},
      id: superadmin.id,
      model: UserModel,
      options: options(),
      user: delegate,
      writeModelName: "NotTheUserModel",
    });
    expect((await UserModel.findById(superadmin.id).lean())?.name).toBe("Renamed elsewhere");
  });

  it("drops passport credential fields from RBAC user writes", async () => {
    const before = await UserModel.findById(delegate.id).select("+hash +salt").lean();
    await executeUpdate({
      body: {attempts: 0, hash: "attacker-hash", name: "Kept", salt: "attacker-salt"},
      id: delegate.id,
      model: UserModel,
      options: options(),
      user: delegate,
    });
    const after = await UserModel.findById(delegate.id).select("+hash +salt").lean();
    const read = (doc: unknown, key: string): unknown => (doc as Record<string, unknown>)?.[key];
    expect(read(after, "name")).toBe("Kept");
    expect(read(after, "hash")).toBe(read(before, "hash"));
    expect(read(after, "salt")).toBe(read(before, "salt"));
  });
});

describe("RBAC target-privilege check over modelRouter HTTP", () => {
  let app: express.Application;
  let superadminId: string;

  beforeEach(async () => {
    const [, notAdmin] = await setupDb();
    const access = await buildAccess();
    await setRoles(notAdmin._id, ["admin"]);
    const target = await UserModel.create({
      email: "http-superadmin@example.com",
      name: "Super",
      roles: ["superadmin"],
    });
    superadminId = String(target._id);
    app = getBaseServer();
    setupAuth(app, UserModel as unknown as UserMongooseModel);
    addAuthRoutes(app, UserModel as unknown as UserMongooseModel);
    app.use(
      "/users",
      modelRouter(UserModel, {
        access: {resource: "user"},
        accessControl: access,
        instanceActions: {
          rename: {
            handler: async ({doc}) => {
              await UserModel.updateOne({_id: (doc as {_id: unknown})._id}, {name: "Action"});
              return {ok: true};
            },
            method: "POST",
            permissions: [Permissions.IsAuthenticated],
          },
          summary: {
            handler: async () => ({ok: true}),
            method: "GET",
            permissions: [Permissions.IsAuthenticated],
          },
        },
        permissions: userPermissions,
      })
    );
    app.use(apiUnauthorizedMiddleware);
    app.use(apiErrorMiddleware);
  });

  it("rejects PATCH, array writes, and write actions on a more privileged user", async () => {
    const agent = await authAsUser(app, "notAdmin");
    await agent
      .patch(`/users/${superadminId}`)
      .send({email: "http-hijack@example.com"})
      .expect(403);
    await agent
      .post(`/users/${superadminId}/organizationIds`)
      .send({organizationIds: "x"})
      .expect(403);
    await agent.post(`/users/${superadminId}/rename`).send({}).expect(403);
    await agent.get(`/users/${superadminId}/summary`).expect(200);

    const stored = await UserModel.findById(superadminId).lean();
    expect(stored?.email).toBe("http-superadmin@example.com");
    expect(stored?.name).toBe("Super");
  });

  it("still lets the delegate edit itself", async () => {
    const agent = await authAsUser(app, "notAdmin");
    const self = await UserModel.findOne({email: "notAdmin@example.com"}).orFail();
    await agent
      .patch(`/users/${String(self._id)}`)
      .send({name: "Self edit"})
      .expect(200);
    expect((await UserModel.findById(self._id).lean())?.name).toBe("Self edit");
  });
});
