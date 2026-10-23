import {describe, expect, it} from "bun:test";
import mongoose, {type Model, model, Schema} from "mongoose";

import type {User, UserModel} from "../auth";
import {setupDb} from "../tests";
import {createAccess} from "./access";
import {createRbacAuditModel} from "./auditModel";
import {createRoleManager} from "./roleManager";
import {createRbacRoleModel} from "./roleModel";
import {terrenoStatements} from "./statements";
import type {PermissionSource} from "./types";

const appStatements = {
  ...terrenoStatements,
  todo: ["create", "read", "update", "delete", "list"],
} as const;

interface RbacTestUser extends User {
  email: string;
  roles: string[];
}

const getRbacTestUserModel = (): Model<RbacTestUser> => {
  const modelName = "RbacRoleManagerTestUser";
  if (mongoose.models[modelName]) {
    return mongoose.models[modelName] as Model<RbacTestUser>;
  }

  const schema = new Schema<RbacTestUser>({
    admin: {default: false, description: "Admin flag", type: Boolean},
    email: {description: "Email", required: true, type: String},
    roles: {default: [], description: "Role names", type: [String]},
  });

  return model<RbacTestUser>(modelName, schema);
};

const createTestUser = (overrides: Partial<RbacTestUser> = {}): RbacTestUser => {
  const id = new mongoose.Types.ObjectId();
  return {
    _id: id as unknown as User["_id"],
    admin: false,
    email: "actor@example.com",
    id: id.toString(),
    roles: [],
    ...overrides,
  };
};

describe("roleManager", () => {
  it("seeds custom default roles beyond terreno defaults", async () => {
    await setupDb();
    const access = createAccess({
      connection: mongoose.connection,
      defaultRoles: [
        {
          displayName: "Custom Editor",
          name: "custom-editor",
          permissions: {todo: ["read", "update"]},
        },
      ],
      statements: appStatements,
    });

    await access.roles.seedDefaults();

    const RbacRole = createRbacRoleModel(mongoose.connection);
    const customRole = await RbacRole.findExactlyOne({name: "custom-editor"});
    expect(customRole.permissions.todo).toEqual(expect.arrayContaining(["read", "update"]));
  });

  it("does not overwrite customized custom default roles on re-seed", async () => {
    await setupDb();
    const access = createAccess({
      connection: mongoose.connection,
      defaultRoles: [
        {
          displayName: "Custom Editor",
          name: "custom-editor",
          permissions: {todo: ["read", "update"]},
        },
      ],
      statements: appStatements,
    });

    await access.roles.seedDefaults();
    const RbacRole = createRbacRoleModel(mongoose.connection);
    await RbacRole.updateOne({name: "custom-editor"}, {$set: {permissions: {todo: ["read"]}}});
    await access.roles.seedDefaults();

    const customRole = await RbacRole.findExactlyOne({name: "custom-editor"});
    expect(customRole.permissions.todo).toEqual(["read"]);
  });

  it("creates, lists, updates, and removes roles", async () => {
    await setupDb();
    const access = createAccess({
      connection: mongoose.connection,
      statements: appStatements,
    });
    await access.roles.seedDefaults();

    const actor = createTestUser({roles: ["superadmin"]});
    const created = await access.roles.create({
      actor,
      role: {
        displayName: "Todo Reader",
        name: "todo-reader",
        permissions: {todo: ["read"]},
      },
    });
    expect(created.name).toBe("todo-reader");

    const roles = await access.roles.list();
    expect(roles.map((role) => role.name)).toContain("todo-reader");

    const updated = await access.roles.update({
      actor,
      changes: {displayName: "Todo Reader Updated"},
      roleName: "todo-reader",
    });
    expect(updated.displayName).toBe("Todo Reader Updated");

    const cleared = await access.roles.update({
      actor,
      changes: {description: null},
      roleName: "todo-reader",
    });
    expect(cleared.description == null).toBe(true);

    await access.roles.remove({actor, roleName: "todo-reader"});
    const remaining = await access.roles.list();
    expect(remaining.map((role) => role.name)).not.toContain("todo-reader");

    const RbacAudit = createRbacAuditModel(mongoose.connection);
    const createAudit = await RbacAudit.findExactlyOne({
      action: "role.create",
      denied: false,
      targetRoleName: "todo-reader",
    });
    expect(createAudit.permissionDelta?.gained.todo).toEqual(["read"]);
    const updateAudits = await RbacAudit.find({
      action: "role.update",
      denied: false,
      targetRoleName: "todo-reader",
    });
    expect(updateAudits).toHaveLength(2);
    expect(updateAudits.every((entry) => entry.actorId === actor.id)).toBe(true);
    const removeAudit = await RbacAudit.findExactlyOne({
      action: "role.remove",
      denied: false,
      targetRoleName: "todo-reader",
    });
    expect(removeAudit.permissionDelta?.lost.todo).toEqual(["read"]);
  });

  it("fans successful role writes out to a pluggable audit sink", async () => {
    await setupDb();
    const sinkRecords: Array<{action: string; targetRoleName?: string}> = [];
    const access = createAccess({
      auditSink: async (record) => {
        sinkRecords.push({action: record.action, targetRoleName: record.targetRoleName});
      },
      connection: mongoose.connection,
      statements: appStatements,
    });
    await access.roles.seedDefaults();

    const actor = createTestUser({roles: ["superadmin"]});
    await access.roles.create({
      actor,
      role: {
        displayName: "Sinked",
        name: "sinked",
        permissions: {todo: ["read"]},
      },
    });

    const RbacAudit = createRbacAuditModel(mongoose.connection);
    const persisted = await RbacAudit.findExactlyOne({
      action: "role.create",
      targetRoleName: "sinked",
    });
    expect(persisted.denied).toBe(false);
    expect(sinkRecords).toEqual([{action: "role.create", targetRoleName: "sinked"}]);
  });

  it("can skip the built-in collection when persistAudit is false and a sink is set", async () => {
    await setupDb();
    const sinkRecords: string[] = [];
    const access = createAccess({
      auditSink: async (record) => {
        sinkRecords.push(record.action);
      },
      connection: mongoose.connection,
      persistAudit: false,
      statements: appStatements,
    });
    await access.roles.seedDefaults();

    const actor = createTestUser({roles: ["superadmin"]});
    await access.roles.create({
      actor,
      role: {
        displayName: "Sink Only",
        name: "sink-only",
        permissions: {todo: ["list"]},
      },
    });

    expect(sinkRecords).toEqual(["role.create"]);
    const RbacAudit = createRbacAuditModel(mongoose.connection);
    expect(await RbacAudit.countDocuments({targetRoleName: "sink-only"})).toBe(0);
  });

  it("rejects createAccess when persistAudit is false and no auditSink is provided", () => {
    expect(() =>
      createAccess({
        connection: mongoose.connection,
        persistAudit: false,
        statements: appStatements,
      })
    ).toThrow("RBAC audit requires persistAudit or at least one auditSink");
  });

  it("assigns and unassigns roles on users", async () => {
    await setupDb();
    const UserModel = getRbacTestUserModel();
    const access = createAccess({
      connection: mongoose.connection,
      defaultRoles: [
        {
          displayName: "Editor",
          name: "editor",
          permissions: {todo: ["read", "update"]},
        },
      ],
      statements: appStatements,
      userModel: UserModel as unknown as UserModel,
    });
    await access.roles.seedDefaults();

    const actor = createTestUser({roles: ["superadmin"]});
    const target = await UserModel.create({email: "target@example.com", roles: []});

    await access.roles.assign({
      actor,
      roleNames: ["editor"],
      userId: target.id,
    });

    const assigned = await UserModel.findById(target.id);
    expect(assigned?.roles).toEqual(["editor"]);

    await access.roles.unassign({
      actor,
      roleNames: ["editor"],
      userId: target.id,
    });

    const unassigned = await UserModel.findById(target.id);
    expect(unassigned?.roles).toEqual([]);

    const RbacAudit = createRbacAuditModel(mongoose.connection);
    const assignAudit = await RbacAudit.findExactlyOne({
      action: "role.assign",
      denied: false,
      targetUserId: target.id,
    });
    expect(assignAudit.permissionDelta?.gained.todo).toEqual(
      expect.arrayContaining(["read", "update"])
    );
    const unassignAudit = await RbacAudit.findExactlyOne({
      action: "role.unassign",
      denied: false,
      targetUserId: target.id,
    });
    expect(unassignAudit.permissionDelta?.lost.todo).toEqual(
      expect.arrayContaining(["read", "update"])
    );
  });

  it("rejects assign and unassign when the actor lacks the target user's permissions", async () => {
    await setupDb();
    const UserModel = getRbacTestUserModel();
    const access = createAccess({
      connection: mongoose.connection,
      defaultRoles: [
        {
          displayName: "Assigner",
          name: "assigner",
          permissions: {rbac: ["assignRoles"], todo: ["read"]},
        },
      ],
      statements: appStatements,
      userModel: UserModel as unknown as UserModel,
    });
    await access.roles.seedDefaults();

    const actor = createTestUser({roles: ["assigner"]});
    const privileged = await UserModel.create({
      email: "privileged@example.com",
      roles: ["superadmin"],
    });
    const unprivileged = await UserModel.create({
      email: "unprivileged@example.com",
      roles: [],
    });

    await expect(
      access.roles.assign({
        actor,
        roleNames: ["member"],
        userId: privileged.id,
      })
    ).rejects.toMatchObject({
      status: 403,
      title: "Cannot modify a user with permissions you do not hold",
    });
    expect((await UserModel.findById(privileged.id))?.roles).toEqual(["superadmin"]);

    await expect(
      access.roles.unassign({
        actor,
        roleNames: ["superadmin"],
        userId: privileged.id,
      })
    ).rejects.toMatchObject({
      status: 403,
      title: "Cannot modify a user with permissions you do not hold",
    });
    expect((await UserModel.findById(privileged.id))?.roles).toEqual(["superadmin"]);

    await access.roles.assign({
      actor,
      roleNames: ["member"],
      userId: unprivileged.id,
    });
    expect((await UserModel.findById(unprivileged.id))?.roles).toEqual(["member"]);
  });

  it("assertCanModifyUser rejects when the actor lacks the target user's permissions", async () => {
    await setupDb();
    const UserModel = getRbacTestUserModel();
    const access = createAccess({
      connection: mongoose.connection,
      defaultRoles: [
        {
          displayName: "Assigner",
          name: "assigner",
          permissions: {rbac: ["assignRoles"], todo: ["read"]},
        },
      ],
      statements: appStatements,
      userModel: UserModel as unknown as UserModel,
    });
    await access.roles.seedDefaults();

    const actor = createTestUser({roles: ["assigner"]});
    const privileged = await UserModel.create({
      email: "assert-privileged@example.com",
      roles: ["superadmin"],
    });
    const unprivileged = await UserModel.create({
      email: "assert-unprivileged@example.com",
      roles: [],
    });

    await expect(
      access.roles.assertCanModifyUser({actor, userId: privileged.id})
    ).rejects.toMatchObject({
      status: 403,
      title: "Cannot modify a user with permissions you do not hold",
    });
    await access.roles.assertCanModifyUser({actor, userId: unprivileged.id});
  });

  it("previews assignment and role permission changes", async () => {
    await setupDb();
    const UserModel = getRbacTestUserModel();
    const access = createAccess({
      connection: mongoose.connection,
      defaultRoles: [
        {
          displayName: "Reader",
          name: "reader",
          permissions: {todo: ["read"]},
        },
        {
          displayName: "Writer",
          name: "writer",
          permissions: {todo: ["update"]},
        },
      ],
      statements: appStatements,
      userModel: UserModel as unknown as UserModel,
    });
    await access.roles.seedDefaults();

    const target = await UserModel.create({email: "preview@example.com", roles: ["reader"]});
    const actor = createTestUser({roles: ["superadmin"]});
    const assignmentPreview = await access.roles.previewAssignment({
      actor,
      roleNames: ["reader", "writer"],
      userId: target.id,
    });
    expect(assignmentPreview.gained.todo).toEqual(expect.arrayContaining(["update"]));
    expect(assignmentPreview.resulting.todo).toEqual(expect.arrayContaining(["read", "update"]));

    const rolePreview = await access.roles.previewRoleChange({
      permissions: {todo: ["read", "list"]},
      roleName: "reader",
    });
    expect(rolePreview.gained.todo).toEqual(expect.arrayContaining(["list"]));
    expect(rolePreview.affectedUserCount).toBe(1);
  });

  it("rejects previewing roles whose permissions the actor does not hold", async () => {
    await setupDb();
    const UserModel = getRbacTestUserModel();
    const access = createAccess({
      connection: mongoose.connection,
      defaultRoles: [
        {
          displayName: "Assigner",
          name: "assigner",
          permissions: {rbac: ["assignRoles"], todo: ["read"]},
        },
      ],
      statements: appStatements,
      userModel: UserModel as unknown as UserModel,
    });
    await access.roles.seedDefaults();

    const actor = createTestUser({roles: ["assigner"]});
    const target = await UserModel.create({email: "preview-escalation@example.com", roles: []});

    await expect(
      access.roles.previewAssignment({
        actor,
        roleNames: ["superadmin"],
        userId: target.id,
      })
    ).rejects.toMatchObject({
      status: 403,
      title: "Cannot grant permissions you do not hold",
    });

    const RbacAudit = createRbacAuditModel(mongoose.connection);
    const deniedAssigns = await RbacAudit.find({action: "role.assign", denied: true});
    expect(deniedAssigns).toHaveLength(0);
  });

  it("rejects role management without manageRoles permission", async () => {
    await setupDb();
    const access = createAccess({
      connection: mongoose.connection,
      statements: appStatements,
    });
    await access.roles.seedDefaults();

    const actor = createTestUser({roles: ["member"]});
    await expect(
      access.roles.create({
        actor,
        role: {
          displayName: "Blocked",
          name: "blocked",
          permissions: {todo: ["read"]},
        },
      })
    ).rejects.toMatchObject({status: 403, title: "Missing rbac:manageRoles permission"});
  });

  it("rejects assignment without assignRoles permission", async () => {
    await setupDb();
    const UserModel = getRbacTestUserModel();
    const access = createAccess({
      connection: mongoose.connection,
      statements: appStatements,
      userModel: UserModel as unknown as UserModel,
    });
    await access.roles.seedDefaults();

    const actor = createTestUser({roles: ["auditor"]});
    const target = await UserModel.create({email: "noassign@example.com", roles: []});

    await expect(
      access.roles.assign({
        actor,
        roleNames: ["member"],
        userId: target.id,
      })
    ).rejects.toMatchObject({status: 403, title: "Missing rbac:assignRoles permission"});
  });

  it("rejects permission escalation when creating roles", async () => {
    await setupDb();
    const access = createAccess({
      connection: mongoose.connection,
      defaultRoles: [
        {
          displayName: "Role Manager",
          name: "role-manager",
          permissions: {rbac: ["manageRoles", "assignRoles"], todo: ["read"]},
        },
      ],
      statements: appStatements,
    });
    await access.roles.seedDefaults();

    const actor = createTestUser({roles: ["role-manager"]});
    await expect(
      access.roles.create({
        actor,
        role: {
          displayName: "Escalated",
          name: "escalated",
          permissions: {todo: ["delete"]},
        },
      })
    ).rejects.toMatchObject({status: 403, title: "Cannot grant permissions you do not hold"});

    const RbacAudit = createRbacAuditModel(mongoose.connection);
    const denied = await RbacAudit.find({action: "role.create", denied: true});
    expect(denied).toHaveLength(1);
    expect(denied[0]?.actorId).toBe(actor.id);
    expect(denied[0]?.permissionDelta?.gained.todo).toEqual(["delete"]);
  });

  it("rejects emptying or deleting a role whose permissions the actor does not hold", async () => {
    await setupDb();
    const access = createAccess({
      connection: mongoose.connection,
      defaultRoles: [
        {
          displayName: "Role Manager",
          name: "role-manager",
          permissions: {rbac: ["manageRoles"], todo: ["read"]},
        },
      ],
      statements: appStatements,
    });
    await access.roles.seedDefaults();

    const superadmin = createTestUser({roles: ["superadmin"]});
    await access.roles.create({
      actor: superadmin,
      role: {
        displayName: "Writer",
        name: "writer",
        permissions: {todo: ["update"]},
      },
    });

    const actor = createTestUser({email: "manager@example.com", roles: ["role-manager"]});
    await expect(
      access.roles.update({
        actor,
        changes: {permissions: {}},
        roleName: "writer",
      })
    ).rejects.toMatchObject({status: 403, title: "Cannot grant permissions you do not hold"});

    await expect(access.roles.remove({actor, roleName: "writer"})).rejects.toMatchObject({
      status: 403,
      title: "Cannot grant permissions you do not hold",
    });

    const RbacRole = createRbacRoleModel(mongoose.connection);
    const writer = await RbacRole.findExactlyOne({name: "writer"});
    expect(writer.permissions.todo).toEqual(["update"]);
  });

  it("rejects invalid permission sets", async () => {
    await setupDb();
    const access = createAccess({
      connection: mongoose.connection,
      statements: appStatements,
    });
    await access.roles.seedDefaults();

    const actor = createTestUser({roles: ["superadmin"]});
    await expect(
      access.roles.create({
        actor,
        role: {
          displayName: "Invalid",
          name: "invalid",
          permissions: {unknown: ["read"]},
        },
      })
    ).rejects.toMatchObject({status: 400, title: "Invalid permissions"});
  });

  it("does not leave previewed assignment grants in the live permission cache", async () => {
    await setupDb();
    const UserModel = getRbacTestUserModel();
    const access = createAccess({
      connection: mongoose.connection,
      defaultRoles: [
        {
          displayName: "Reader",
          name: "reader",
          permissions: {todo: ["read"]},
        },
        {
          displayName: "Writer",
          name: "writer",
          permissions: {todo: ["update"]},
        },
      ],
      statements: appStatements,
      userModel: UserModel as unknown as UserModel,
    });
    await access.roles.seedDefaults();

    const target = await UserModel.create({email: "cache-preview@example.com", roles: ["reader"]});
    const actor = createTestUser({roles: ["superadmin"]});
    await access.roles.previewAssignment({
      actor,
      roleNames: ["reader", "writer"],
      userId: target.id,
    });

    const live = await access.can({
      permissions: {todo: ["update"]},
      user: target as unknown as User,
    });
    expect(live.allowed).toBe(false);
  });

  it("diffs preview assignment against uncached current grants", async () => {
    await setupDb();
    const UserModel = getRbacTestUserModel();
    let shouldFail = false;
    const source: PermissionSource = {
      getGrants: async () => {
        if (shouldFail) {
          throw new Error("source unavailable");
        }
        return {permissions: {todo: ["list"]}};
      },
      name: "preview-source",
      staleOnFailure: "use-stale",
    };
    const access = createAccess({
      connection: mongoose.connection,
      defaultRoles: [
        {
          displayName: "Reader",
          name: "reader",
          permissions: {todo: ["read"]},
        },
        {
          displayName: "Writer",
          name: "writer",
          permissions: {todo: ["update"]},
        },
      ],
      sources: [source],
      statements: appStatements,
      userModel: UserModel as unknown as UserModel,
    });
    await access.roles.seedDefaults();

    const target = await UserModel.create({
      email: "preview-source@example.com",
      roles: ["reader"],
    });
    const warmed = await access.can({
      permissions: {todo: ["list"]},
      user: target as unknown as User,
    });
    expect(warmed.allowed).toBe(true);

    shouldFail = true;
    const assignmentPreview = await access.roles.previewAssignment({
      actor: createTestUser({roles: ["superadmin"]}),
      roleNames: ["reader", "writer"],
      userId: target.id,
    });

    expect(assignmentPreview.lost.todo ?? []).not.toEqual(expect.arrayContaining(["list"]));
    expect(assignmentPreview.gained.todo).toEqual(expect.arrayContaining(["update"]));
    expect(assignmentPreview.resulting.todo).toEqual(
      expect.arrayContaining(["list", "read", "update"])
    );

    const live = await access.can({
      permissions: {todo: ["update"]},
      user: target as unknown as User,
    });
    expect(live.allowed).toBe(false);
  });

  it("rejects conflicting role assignments", async () => {
    await setupDb();
    const UserModel = getRbacTestUserModel();
    const access = createAccess({
      connection: mongoose.connection,
      defaultRoles: [
        {
          displayName: "Role A",
          excludesRoles: ["role-b"],
          name: "role-a",
          permissions: {todo: ["read"]},
        },
        {
          displayName: "Role B",
          name: "role-b",
          permissions: {todo: ["update"]},
        },
      ],
      statements: appStatements,
      userModel: UserModel as unknown as UserModel,
    });
    await access.roles.seedDefaults();

    const actor = createTestUser({roles: ["superadmin"]});
    const target = await UserModel.create({email: "conflict@example.com", roles: []});

    await expect(
      access.roles.assign({
        actor,
        roleNames: ["role-a", "role-b"],
        userId: target.id,
      })
    ).rejects.toMatchObject({
      status: 409,
      title: "Role role-a conflicts with role-b",
    });
  });

  it("rejects locked role deletion and sealed role updates", async () => {
    await setupDb();
    const access = createAccess({
      connection: mongoose.connection,
      statements: appStatements,
    });
    await access.roles.seedDefaults();

    const actor = createTestUser({roles: ["superadmin"]});
    await expect(access.roles.remove({actor, roleName: "admin"})).rejects.toMatchObject({
      status: 400,
      title: "Cannot delete a locked role",
    });

    await expect(
      access.roles.update({
        actor,
        changes: {displayName: "Changed"},
        roleName: "superadmin",
      })
    ).rejects.toMatchObject({status: 400, title: "Cannot modify a sealed role"});
  });

  it("rejects renaming locked roles", async () => {
    await setupDb();
    const access = createAccess({
      connection: mongoose.connection,
      statements: appStatements,
    });
    await access.roles.seedDefaults();

    const actor = createTestUser({roles: ["superadmin"]});
    await expect(
      access.roles.update({
        actor,
        changes: {name: "renamed-admin"},
        roleName: "admin",
      })
    ).rejects.toMatchObject({status: 400, title: "Cannot rename a locked role"});
  });

  describe("role renames", () => {
    const setup = async () => {
      await setupDb();
      const UserModel = getRbacTestUserModel();
      await UserModel.deleteMany({});
      const access = createAccess({
        connection: mongoose.connection,
        defaultRoles: [
          {
            displayName: "Delegate",
            name: "delegate",
            permissions: {rbac: ["read", "manageRoles"], todo: ["read"]},
          },
          {displayName: "Viewer", name: "viewer", permissions: {todo: ["list"]}},
          {
            displayName: "Clinician",
            name: "clinician",
            permissions: {todo: ["update", "delete"]},
          },
        ],
        statements: appStatements,
        userModel: UserModel as unknown as UserModel,
      });
      await access.roles.seedDefaults();
      const actor = (await UserModel.create({
        email: "rename-delegate@example.com",
        roles: ["delegate", "viewer"],
      })) as unknown as RbacTestUser;
      const clinician = await UserModel.create({
        email: "rename-clinician@example.com",
        roles: ["clinician"],
      });
      return {access, actor, clinician, UserModel};
    };

    it("does not let a manageRoles holder rename a stronger role onto a name it holds", async () => {
      const {access, actor, UserModel} = await setup();

      await access.roles.update({actor, changes: {name: "viewer-parked"}, roleName: "viewer"});
      const reloadedActor = (await UserModel.findById(actor._id).orFail()) as unknown as User;
      await expect(
        access.roles.update({
          actor: reloadedActor,
          changes: {name: "viewer"},
          roleName: "clinician",
        })
      ).rejects.toMatchObject({status: 403, title: "Cannot grant permissions you do not hold"});

      const permissions = await access.getPermissions({
        user: (await UserModel.findById(actor._id).orFail()) as unknown as User,
      });
      expect(permissions.todo ?? []).not.toContain("delete");
      expect(permissions.todo ?? []).toContain("list");
    });

    it("moves holders to the new name so their grants do not change", async () => {
      const {access, clinician, UserModel} = await setup();
      const superadmin = createTestUser({roles: ["superadmin"]});

      await access.roles.update({
        actor: superadmin,
        changes: {name: "care-clinician"},
        roleName: "clinician",
      });

      const reloaded = await UserModel.findById(clinician._id).orFail();
      expect(reloaded.roles).toEqual(["care-clinician"]);
      const permissions = await access.getPermissions({user: reloaded as unknown as User});
      expect(permissions.todo).toEqual(expect.arrayContaining(["update", "delete"]));
    });

    it("rejects a rename onto a name users already hold", async () => {
      const {access, UserModel} = await setup();
      const superadmin = createTestUser({roles: ["superadmin"]});
      await UserModel.create({email: "stale-holder@example.com", roles: ["retired-role"]});

      await expect(
        access.roles.update({
          actor: superadmin,
          changes: {name: "retired-role"},
          roleName: "clinician",
        })
      ).rejects.toMatchObject({status: 409});
      await expect(
        access.roles.update({
          actor: superadmin,
          changes: {name: "viewer"},
          roleName: "clinician",
        })
      ).rejects.toMatchObject({status: 409});
    });
  });

  it("requires a configured user model for assignment operations", async () => {
    await setupDb();
    const access = createAccess({
      connection: mongoose.connection,
      statements: appStatements,
    });
    await access.roles.seedDefaults();

    const actor = createTestUser({roles: ["superadmin"]});
    const userId = new mongoose.Types.ObjectId().toString();

    await expect(access.roles.assign({actor, roleNames: ["member"], userId})).rejects.toMatchObject(
      {status: 500, title: "User model not configured for role assignment"}
    );

    await expect(
      access.roles.previewAssignment({actor, roleNames: ["member"], userId})
    ).rejects.toMatchObject({status: 500, title: "User model not configured for role assignment"});
  });

  it("returns 404 when the target user does not exist", async () => {
    await setupDb();
    const UserModel = getRbacTestUserModel();
    const access = createAccess({
      connection: mongoose.connection,
      statements: appStatements,
      userModel: UserModel as unknown as UserModel,
    });
    await access.roles.seedDefaults();

    const actor = createTestUser({roles: ["superadmin"]});
    const missingId = new mongoose.Types.ObjectId().toString();

    await expect(
      access.roles.assign({actor, roleNames: ["member"], userId: missingId})
    ).rejects.toMatchObject({status: 404, title: "User not found"});
  });

  it("rejects assignment when the user model cannot save", async () => {
    await setupDb();
    const UserModel = getRbacTestUserModel();
    const access = createAccess({
      connection: mongoose.connection,
      statements: appStatements,
      userModel: UserModel as unknown as UserModel,
    });
    await access.roles.seedDefaults();

    const actor = createTestUser({roles: ["superadmin"]});
    const targetId = new mongoose.Types.ObjectId();
    const originalFindById = UserModel.findById.bind(UserModel);
    UserModel.findById = (async () => ({
      id: targetId.toString(),
      roles: [],
    })) as unknown as typeof UserModel.findById;

    try {
      await expect(
        access.roles.assign({
          actor,
          roleNames: ["member"],
          userId: targetId.toString(),
        })
      ).rejects.toMatchObject({
        status: 500,
        title: "User model does not support saving role assignments",
      });
    } finally {
      UserModel.findById = originalFindById;
    }
  });

  it("does not record denied audits for non-escalation role-lookup failures", async () => {
    await setupDb();
    await createRbacRoleModel(mongoose.connection).seedDefaults({statements: appStatements});

    const actor = createTestUser({roles: ["superadmin"]});
    let actorCalls = 0;
    const {roleManager} = createRoleManager({
      connection: mongoose.connection,
      getActorPermissions: async () => {
        actorCalls += 1;
        if (actorCalls === 1) {
          return {rbac: ["manageRoles"], todo: ["read"]};
        }
        throw new Error("role lookup failed");
      },
      getPreviewPermissions: async () => ({}),
      invalidateCache: () => undefined,
      statements: appStatements,
    });

    await expect(
      roleManager.create({
        actor,
        role: {
          displayName: "Lookup Fail",
          name: "lookup-fail",
          permissions: {todo: ["read"]},
        },
      })
    ).rejects.toThrow("role lookup failed");

    const denied = await createRbacAuditModel(mongoose.connection).find({denied: true});
    expect(denied).toHaveLength(0);
  });

  it("requires a configured user model for unassign and modify checks", async () => {
    await setupDb();
    const access = createAccess({
      connection: mongoose.connection,
      statements: appStatements,
    });
    await access.roles.seedDefaults();

    const actor = createTestUser({roles: ["superadmin"]});
    const userId = new mongoose.Types.ObjectId().toString();

    await expect(
      access.roles.unassign({actor, roleNames: ["member"], userId})
    ).rejects.toMatchObject({status: 500, title: "User model not configured for role assignment"});

    await expect(access.roles.assertCanModifyUser({actor, userId})).rejects.toMatchObject({
      status: 500,
      title: "User model not configured for role assignment",
    });
  });

  it("returns 404 for unassign, previewAssignment, and assertCanModifyUser on missing users", async () => {
    await setupDb();
    const UserModel = getRbacTestUserModel();
    const access = createAccess({
      connection: mongoose.connection,
      statements: appStatements,
      userModel: UserModel as unknown as UserModel,
    });
    await access.roles.seedDefaults();

    const actor = createTestUser({roles: ["superadmin"]});
    const missingId = new mongoose.Types.ObjectId().toString();

    await expect(
      access.roles.unassign({actor, roleNames: ["member"], userId: missingId})
    ).rejects.toMatchObject({status: 404, title: "User not found"});

    await expect(
      access.roles.previewAssignment({actor, roleNames: ["member"], userId: missingId})
    ).rejects.toMatchObject({status: 404, title: "User not found"});

    await expect(
      access.roles.assertCanModifyUser({actor, userId: missingId})
    ).rejects.toMatchObject({status: 404, title: "User not found"});
  });

  it("rejects conflicting role assignments declared by the second role", async () => {
    await setupDb();
    const UserModel = getRbacTestUserModel();
    const access = createAccess({
      connection: mongoose.connection,
      defaultRoles: [
        {
          displayName: "Role C",
          name: "role-c",
          permissions: {todo: ["read"]},
        },
        {
          displayName: "Role D",
          excludesRoles: ["role-c"],
          name: "role-d",
          permissions: {todo: ["update"]},
        },
      ],
      statements: appStatements,
      userModel: UserModel as unknown as UserModel,
    });
    await access.roles.seedDefaults();

    const actor = createTestUser({roles: ["superadmin"]});
    const target = await UserModel.create({email: "reverse-conflict@example.com", roles: []});

    await expect(
      access.roles.assign({actor, roleNames: ["role-c", "role-d"], userId: target.id})
    ).rejects.toMatchObject({
      status: 409,
      title: "Role role-c conflicts with role-d",
    });
  });

  it("rejects changing locked fields on a locked role", async () => {
    await setupDb();
    const access = createAccess({
      connection: mongoose.connection,
      statements: appStatements,
    });
    await access.roles.seedDefaults();

    const actor = createTestUser({roles: ["superadmin"]});
    await expect(
      access.roles.update({
        actor,
        changes: {isSealed: true},
        roleName: "admin",
      })
    ).rejects.toMatchObject({status: 400, title: "Cannot change locked fields on a locked role"});
  });

  it("rejects excludesRoles updates that conflict with existing assignments", async () => {
    await setupDb();
    const UserModel = getRbacTestUserModel();
    const access = createAccess({
      connection: mongoose.connection,
      defaultRoles: [
        {
          displayName: "Writer",
          name: "writer",
          permissions: {todo: ["update"]},
        },
        {
          displayName: "Reader",
          name: "reader",
          permissions: {todo: ["read"]},
        },
      ],
      statements: appStatements,
      userModel: UserModel as unknown as UserModel,
    });
    await access.roles.seedDefaults();

    const actor = createTestUser({roles: ["superadmin"]});
    await UserModel.create({email: "both@example.com", roles: ["writer", "reader"]});

    await expect(
      access.roles.update({
        actor,
        changes: {excludesRoles: ["reader"]},
        roleName: "writer",
      })
    ).rejects.toMatchObject({
      status: 400,
      title: "excludesRoles conflicts with existing assignments",
    });
  });

  it("allows excludesRoles updates when no holder has the excluded role", async () => {
    await setupDb();
    const UserModel = getRbacTestUserModel();
    const access = createAccess({
      connection: mongoose.connection,
      defaultRoles: [
        {
          displayName: "Solo Writer",
          name: "solo-writer",
          permissions: {todo: ["update"]},
        },
        {
          displayName: "Solo Reader",
          name: "solo-reader",
          permissions: {todo: ["read"]},
        },
      ],
      statements: appStatements,
      userModel: UserModel as unknown as UserModel,
    });
    await access.roles.seedDefaults();

    const actor = createTestUser({roles: ["superadmin"]});
    await UserModel.create({email: "writer-only@example.com", roles: ["solo-writer"]});

    const updated = await access.roles.update({
      actor,
      changes: {excludesRoles: ["solo-reader"]},
      roleName: "solo-writer",
    });
    expect(updated.excludesRoles).toEqual(["solo-reader"]);
  });

  it("keeps the original escalation error when denied-audit persistence fails", async () => {
    await setupDb();
    await createRbacRoleModel(mongoose.connection).seedDefaults({statements: appStatements});

    const actor = createTestUser({roles: ["role-manager"]});
    const {roleManager} = createRoleManager({
      auditSinks: [
        async () => {
          throw new Error("audit sink down");
        },
      ],
      connection: mongoose.connection,
      getActorPermissions: async () => ({rbac: ["manageRoles"], todo: ["read"]}),
      getPreviewPermissions: async () => ({}),
      invalidateCache: () => undefined,
      statements: appStatements,
    });

    await expect(
      roleManager.create({
        actor,
        role: {
          displayName: "Escalated",
          name: "escalated-audit-fail",
          permissions: {todo: ["delete"]},
        },
      })
    ).rejects.toMatchObject({
      status: 403,
      title: "Cannot grant permissions you do not hold",
    });
  });
});
