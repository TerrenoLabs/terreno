import {beforeEach, describe, expect, it} from "bun:test";
import type express from "express";
import mongoose from "mongoose";

import {modelRouter} from "../api";
import {addAuthRoutes, setupAuth, type UserModel as UserMongooseModel} from "../auth";
import {apiErrorMiddleware, apiUnauthorizedMiddleware} from "../errors";
import {Permissions} from "../permissions";
import {executeCreate, executeDelete, executeUpdate} from "../sync/executors";
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
    defaultRoles: [
      {
        displayName: "User editor",
        name: "userEditor",
        permissions: {user: ["create", "list", "read", "update"]},
      },
    ],
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

  it("refuses with 503 when the target's grants from a failed source are unknown", async () => {
    let isDown = false;
    const grantingAccess = createAccess({
      connection: mongoose.connection,
      sources: [
        {
          // Additive only, so an outage drops its grants instead of failing every request.
          failClosedWhenDenyUnknown: false,
          getGrants: async ({user}) => {
            if (String(user.id) !== member.id) {
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
      statements: terrenoStatements,
      userModel: UserModel as unknown as UserMongooseModel,
    }) as unknown as AnyTerrenoAccess;
    const grantingOptions = {
      accessControl: grantingAccess,
      permissions: userPermissions,
    } as unknown as Parameters<typeof executeUpdate>[0]["options"];
    const update = (): Promise<unknown> =>
      executeUpdate({
        body: {name: "Renamed"},
        id: member.id,
        model: UserModel,
        options: grantingOptions,
        user: delegate,
      });
    await expect(update()).rejects.toMatchObject({status: 403});

    isDown = true;
    grantingAccess.invalidateCache({userId: member.id});

    await expect(update()).rejects.toMatchObject({
      status: 503,
      title: "Permission source unavailable",
    });
    expect((await UserModel.findById(member.id).lean())?.name).toBe("Member");
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

describe("user:updateIdentity on RBAC user model writes", () => {
  let editor: User;
  let identityAdmin: User;
  let member: User;
  let access: AnyTerrenoAccess;

  beforeEach(async () => {
    const [, notAdmin] = await setupDb();
    access = await buildAccess();
    await setRoles(notAdmin._id, ["userEditor"]);
    const [identityAdminDoc, memberDoc] = await UserModel.create([
      {email: "identity-admin@example.com", name: "Identity admin", roles: ["admin"]},
      {email: "identity-member@example.com", name: "Member", roles: ["member"]},
    ]);
    editor = (await UserModel.findById(notAdmin._id).orFail()) as unknown as User;
    identityAdmin = identityAdminDoc as unknown as User;
    member = memberDoc as unknown as User;
  });

  const options = (): Parameters<typeof executeUpdate>[0]["options"] =>
    ({
      accessControl: access,
      permissions: userPermissions,
    }) as unknown as Parameters<typeof executeUpdate>[0]["options"];

  it("rejects identity-field changes to another user without user:updateIdentity", async () => {
    for (const body of [
      {email: "identity-redirect@example.com"},
      {disabled: true},
      {emailVerified: true},
      {"email.value": "identity-redirect@example.com"},
    ]) {
      await expect(
        executeUpdate({body, id: member.id, model: UserModel, options: options(), user: editor})
      ).rejects.toMatchObject({status: 403, title: "Missing user:updateIdentity permission"});
    }
    const stored = await UserModel.findById(member.id).lean();
    expect(stored?.email).toBe("identity-member@example.com");
    expect(stored?.disabled).toBe(false);
  });

  it("rejects identity-field changes over sync admin windows that skip permission checks", async () => {
    await expect(
      executeUpdate({
        body: {disabled: true},
        id: member.id,
        model: UserModel,
        options: options(),
        skipPermissionChecks: true,
        user: editor,
      })
    ).rejects.toMatchObject({status: 403, title: "Missing user:updateIdentity permission"});
    expect((await UserModel.findById(member.id).lean())?.disabled).toBe(false);
  });

  it("allows bodies that echo unchanged identity values", async () => {
    await executeUpdate({
      body: {disabled: false, email: "identity-member@example.com", name: "Renamed"},
      id: member.id,
      model: UserModel,
      options: options(),
      user: editor,
    });
    expect((await UserModel.findById(member.id).lean())?.name).toBe("Renamed");
  });

  it("allows identity changes by holders, self-writes, legacy admins, and creates", async () => {
    await executeUpdate({
      body: {disabled: true},
      id: member.id,
      model: UserModel,
      options: options(),
      user: identityAdmin,
    });
    expect((await UserModel.findById(member.id).lean())?.disabled).toBe(true);

    await executeUpdate({
      body: {email: "editor-self@example.com"},
      id: editor.id,
      model: UserModel,
      options: options(),
      user: editor,
    });
    expect((await UserModel.findById(editor.id).lean())?.email).toBe("editor-self@example.com");

    const legacyAdmin = (await UserModel.findOne({email: "admin@example.com"})
      .orFail()
      .exec()) as unknown as User;
    await executeUpdate({
      body: {disabled: false},
      id: member.id,
      model: UserModel,
      options: options(),
      user: legacyAdmin,
    });
    expect((await UserModel.findById(member.id).lean())?.disabled).toBe(false);

    const {doc} = await executeCreate({
      body: {email: "identity-new@example.com", name: "New"},
      model: UserModel,
      options: options(),
      user: editor,
    });
    expect((doc as unknown as {email: string}).email).toBe("identity-new@example.com");
  });
});

describe("user:updateIdentity over modelRouter HTTP", () => {
  let app: express.Application;
  let memberId: string;

  beforeEach(async () => {
    const [, notAdmin] = await setupDb();
    const access = await buildAccess();
    await setRoles(notAdmin._id, ["userEditor"]);
    const target = await UserModel.create({
      email: "http-identity-member@example.com",
      name: "Member",
      roles: ["member"],
    });
    memberId = String(target._id);
    app = getBaseServer();
    setupAuth(app, UserModel as unknown as UserMongooseModel);
    addAuthRoutes(app, UserModel as unknown as UserMongooseModel);
    app.use(
      "/users",
      modelRouter(UserModel, {
        access: {resource: "user"},
        accessControl: access,
        instanceActions: {
          changeEmail: {
            handler: async ({body, doc}) => {
              await UserModel.updateOne(
                {_id: (doc as {_id: unknown})._id},
                {email: (body as {email: string}).email}
              );
              return {ok: true};
            },
            method: "POST",
            permissions: [Permissions.IsAuthenticated],
          },
        },
        permissions: userPermissions,
      })
    );
    app.use(apiUnauthorizedMiddleware);
    app.use(apiErrorMiddleware);
  });

  it("rejects PATCH and write actions that change another user's identity fields", async () => {
    const agent = await authAsUser(app, "notAdmin");
    const patch = await agent.patch(`/users/${memberId}`).send({disabled: true}).expect(403);
    expect(patch.body.title).toBe("Missing user:updateIdentity permission");
    await agent
      .post(`/users/${memberId}/changeEmail`)
      .send({email: "http-identity-redirect@example.com"})
      .expect(403);
    await agent.patch(`/users/${memberId}`).send({name: "Renamed"}).expect(200);

    const stored = await UserModel.findById(memberId).lean();
    expect(stored?.email).toBe("http-identity-member@example.com");
    expect(stored?.disabled).toBe(false);
    expect(stored?.name).toBe("Renamed");
  });
});
