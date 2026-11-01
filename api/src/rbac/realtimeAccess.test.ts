import {describe, expect, it} from "bun:test";
import mongoose from "mongoose";

import type {User} from "../auth";
import {Permissions} from "../permissions";
import type {RealtimeRegistryEntry} from "../realtime/registry";
import {setupDb} from "../tests";
import {createAccess} from "./access";
import {
  canReadDocumentRealtime,
  canSubscribeRealtime,
  maskRealtimeDocument,
} from "./realtimeAccess";
import {OwnerScope} from "./scopes";
import {terrenoStatements} from "./statements";
import type {
  AccessCheckArgs,
  AccessResult,
  AnyTerrenoAccess,
  PermissionRequest,
  Statements,
} from "./types";

const appStatements = {
  ...terrenoStatements,
  todo: ["create", "read", "update", "delete", "list"],
} as const;

const createTestUser = (
  overrides: Partial<User & {roles: string[]}> = {}
): User & {roles: string[]} => {
  const id = new mongoose.Types.ObjectId();
  return {
    _id: id as unknown as User["_id"],
    admin: false,
    id: id.toString(),
    roles: [],
    ...overrides,
  };
};

// Realtime access reads only access/permissions; tests omit the rest of ModelRouterOptions.
const makeEntry = (options: Partial<RealtimeRegistryEntry["options"]>): RealtimeRegistryEntry => ({
  collectionName: "todos",
  config: {methods: ["create", "update", "delete"], roomStrategy: "owner"},
  modelName: "Todo",
  options: options as RealtimeRegistryEntry["options"],
  routePath: "/todos",
});

const makeStubAccess = ({
  allowed,
  onCheck,
}: {
  allowed: boolean;
  onCheck?: (args: AccessCheckArgs<Statements>) => AccessResult | undefined;
}): AnyTerrenoAccess =>
  ({
    can: async (args: AccessCheckArgs<Statements>): Promise<AccessResult> =>
      onCheck?.(args) ?? {allowed},
    statements: appStatements,
  }) as unknown as AnyTerrenoAccess;

describe("realtimeAccess", () => {
  it("uses accessControl permissions for subscriptions", async () => {
    await setupDb();
    const access = createAccess({
      connection: mongoose.connection,
      defaultRoles: [
        {
          displayName: "Reader",
          name: "reader",
          permissions: {todo: ["read", "list"]},
        },
      ],
      statements: appStatements,
    });
    await access.roles.seedDefaults();

    const user = createTestUser({roles: ["reader"]});
    const entry = makeEntry({
      access: {resource: "todo"},
      accessControl: access as AnyTerrenoAccess,
    });

    expect(await canSubscribeRealtime(entry, "list", user)).toBe(true);
    expect(await canSubscribeRealtime(entry, "read", user)).toBe(true);
  });

  it("returns false when the realtime action override is null", async () => {
    await setupDb();
    const access = createAccess({
      connection: mongoose.connection,
      statements: appStatements,
    });
    await access.roles.seedDefaults();

    const user = createTestUser({roles: ["superadmin"]});
    const entry = makeEntry({
      access: {actions: {list: null}, resource: "todo"},
      accessControl: access as AnyTerrenoAccess,
    });

    expect(await canSubscribeRealtime(entry, "list", user)).toBe(false);
  });

  it("honors custom action overrides for realtime subscriptions", async () => {
    await setupDb();
    const access = createAccess({
      connection: mongoose.connection,
      defaultRoles: [
        {
          displayName: "Updater",
          name: "updater",
          permissions: {todo: ["update"]},
        },
      ],
      statements: appStatements,
    });
    await access.roles.seedDefaults();

    const user = createTestUser({roles: ["updater"]});
    const entry = makeEntry({
      access: {actions: {list: "update"}, resource: "todo"},
      accessControl: access as AnyTerrenoAccess,
    });

    expect(await canSubscribeRealtime(entry, "list", user)).toBe(true);
  });

  it("falls back to legacy permissions when access config is absent", async () => {
    const user = createTestUser({admin: true});
    const entry = makeEntry({
      permissions: {
        create: [Permissions.IsAdmin],
        delete: [Permissions.IsAdmin],
        list: [Permissions.IsAdmin],
        read: [Permissions.IsAdmin],
        update: [Permissions.IsAdmin],
      },
    });

    expect(await canSubscribeRealtime(entry, "list", user)).toBe(true);
    expect(await canSubscribeRealtime(entry, "list", createTestUser())).toBe(false);
  });

  it("checks document-level access with scopes", async () => {
    await setupDb();
    const access = createAccess({
      connection: mongoose.connection,
      defaultRoles: [
        {
          displayName: "Reader",
          name: "reader",
          permissions: {todo: ["read"]},
        },
      ],
      scopes: {
        "todo.read": OwnerScope(),
      },
      statements: appStatements,
    });
    await access.roles.seedDefaults();

    const user = createTestUser({roles: ["reader"]});
    const entry = makeEntry({
      access: {resource: "todo"},
      accessControl: access as AnyTerrenoAccess,
    });

    expect(await canReadDocumentRealtime(entry, user, {ownerId: user.id, title: "Mine"})).toBe(
      true
    );
    expect(
      await canReadDocumentRealtime(entry, user, {
        ownerId: new mongoose.Types.ObjectId().toString(),
        title: "Other",
      })
    ).toBe(false);
  });

  it("applies per-router access.scope on realtime document reads", async () => {
    await setupDb();
    const access = createAccess({
      connection: mongoose.connection,
      defaultRoles: [
        {
          displayName: "Reader",
          name: "reader",
          permissions: {todo: ["read"]},
        },
      ],
      statements: appStatements,
    });
    await access.roles.seedDefaults();

    const user = createTestUser({roles: ["reader"]});
    const entry = makeEntry({
      access: {
        resource: "todo",
        scope: {
          check: ({doc}) => (doc as {ownerId?: string} | undefined)?.ownerId === user.id,
        },
      },
      accessControl: access as AnyTerrenoAccess,
    });

    expect(await canReadDocumentRealtime(entry, user, {ownerId: user.id, title: "Mine"})).toBe(
      true
    );
    expect(
      await canReadDocumentRealtime(entry, user, {
        ownerId: new mongoose.Types.ObjectId().toString(),
        title: "Other",
      })
    ).toBe(false);
  });

  it("masks realtime documents using field views", async () => {
    await setupDb();
    const access = createAccess({
      connection: mongoose.connection,
      defaultRoles: [
        {
          displayName: "Reader",
          name: "reader",
          permissions: {todo: ["read"]},
        },
      ],
      fieldViews: {
        todo: {
          select: () => "public",
          views: {
            public: {omit: [], read: ["title"], write: ["title"]},
          },
        },
      },
      statements: appStatements,
    });
    await access.roles.seedDefaults();

    const user = createTestUser({roles: ["reader"]});
    const entry = makeEntry({
      access: {resource: "todo"},
      accessControl: access as AnyTerrenoAccess,
    });

    const masked = await maskRealtimeDocument(
      entry,
      user,
      {secret: "hidden", title: "Visible"},
      "read"
    );
    expect(masked).toEqual({title: "Visible"});
  });

  it("returns documents unchanged when access config is missing", async () => {
    const entry = makeEntry({});
    const doc = {title: "Plain"};
    expect(await maskRealtimeDocument(entry, undefined, doc, "read")).toBe(doc);
  });

  it("falls back to the read action when the resource has no list statement", async () => {
    await setupDb();
    const readOnlyStatements = {
      ...terrenoStatements,
      note: ["create", "read", "update", "delete"],
    } as const;
    const access = createAccess({
      connection: mongoose.connection,
      defaultRoles: [
        {
          displayName: "Note Reader",
          name: "note-reader",
          permissions: {note: ["read"]},
        },
      ],
      statements: readOnlyStatements,
    });
    await access.roles.seedDefaults();

    const user = createTestUser({roles: ["note-reader"]});
    const entry = makeEntry({
      access: {resource: "note"},
      accessControl: access as AnyTerrenoAccess,
    });

    expect(await canSubscribeRealtime(entry, "list", user)).toBe(true);
  });

  it("returns false for document reads when the read action override is null", async () => {
    const user = createTestUser();
    const entry = makeEntry({
      access: {actions: {read: null}, resource: "todo"},
      accessControl: makeStubAccess({allowed: true}),
    });

    expect(await canReadDocumentRealtime(entry, user, {title: "Any"})).toBe(false);
  });

  it("denies scoped document reads for anonymous subscribers", async () => {
    const entry = makeEntry({
      access: {resource: "todo", scope: {check: () => true}},
      accessControl: makeStubAccess({allowed: true}),
    });

    expect(await canReadDocumentRealtime(entry, undefined, {title: "Any"})).toBe(false);
  });

  it("re-checks permissions returned by a scope check", async () => {
    const permissionRequests: PermissionRequest<Statements>[] = [];
    const user = createTestUser();
    const entry = makeEntry({
      access: {
        resource: "todo",
        scope: {check: () => ({todo: ["update"]})},
      },
      accessControl: makeStubAccess({
        allowed: true,
        onCheck: (args) => {
          permissionRequests.push(args.permissions);
          return undefined;
        },
      }),
    });

    expect(await canReadDocumentRealtime(entry, user, {title: "Any"})).toBe(true);
    expect(permissionRequests).toEqual([{todo: ["read"]}, {todo: ["update"]}]);
  });

  it("denies document reads when scope permissions are not granted", async () => {
    const user = createTestUser();
    const entry = makeEntry({
      access: {
        resource: "todo",
        scope: {check: () => ({todo: ["delete"]})},
      },
      accessControl: makeStubAccess({
        allowed: true,
        onCheck: (args) => {
          if (args.permissions.todo?.includes("delete")) {
            return {allowed: false};
          }
          return undefined;
        },
      }),
    });

    expect(await canReadDocumentRealtime(entry, user, {title: "Any"})).toBe(false);
  });

  it("applies access.also.read to realtime document reads", async () => {
    const owner = createTestUser();
    const other = createTestUser();
    const doc = {ownerId: owner.id, text: "dummy-owner-only"};
    const entry = makeEntry({
      access: {also: {read: [Permissions.IsOwner]}, resource: "todo"},
      accessControl: makeStubAccess({allowed: true}),
    });

    expect(await canReadDocumentRealtime(entry, owner, doc)).toBe(true);
    expect(await canReadDocumentRealtime(entry, other, doc)).toBe(false);
  });

  it("applies access.also.read after a scope check returns extra permissions", async () => {
    const owner = createTestUser();
    const other = createTestUser();
    const doc = {ownerId: owner.id, text: "dummy-owner-only"};
    const entry = makeEntry({
      access: {
        also: {read: [Permissions.IsOwner]},
        resource: "todo",
        scope: {check: () => ({todo: ["read"]})},
      },
      accessControl: makeStubAccess({allowed: true}),
    });

    expect(await canReadDocumentRealtime(entry, owner, doc)).toBe(true);
    expect(await canReadDocumentRealtime(entry, other, doc)).toBe(false);
  });

  it("applies access.also to realtime subscriptions", async () => {
    const admin = createTestUser({admin: true});
    const member = createTestUser();
    const entry = makeEntry({
      access: {also: {list: [Permissions.IsAdmin]}, resource: "todo"},
      accessControl: makeStubAccess({allowed: true}),
    });

    expect(await canSubscribeRealtime(entry, "list", admin)).toBe(true);
    expect(await canSubscribeRealtime(entry, "list", member)).toBe(false);
    expect(await canSubscribeRealtime(entry, "read", member)).toBe(true);
  });
});
