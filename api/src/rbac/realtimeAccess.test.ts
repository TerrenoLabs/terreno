import {describe, expect, it} from "bun:test";
import mongoose from "mongoose";

import type {User} from "../auth";
import {Permissions} from "../permissions";
import {setupDb} from "../tests";
import {createAccess} from "./access";
import {canReadDocumentRealtime} from "./realtimeAccess";
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

type RealtimeAccessEntry = Parameters<typeof canReadDocumentRealtime>[0];

const makeEntry = (options: RealtimeAccessEntry["options"]): RealtimeAccessEntry => ({options});

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
  it("falls back to router read permissions when access config is absent", async () => {
    const user = createTestUser({admin: true});
    const entry = makeEntry({permissions: {read: [Permissions.IsAdmin]}});

    expect(await canReadDocumentRealtime(entry, user, {title: "Any"})).toBe(true);
    expect(await canReadDocumentRealtime(entry, createTestUser(), {title: "Any"})).toBe(false);
  });

  it("uses a custom read action override for document reads", async () => {
    const permissionRequests: PermissionRequest<Statements>[] = [];
    const entry = makeEntry({
      access: {actions: {read: "list"}, resource: "todo"},
      accessControl: makeStubAccess({
        allowed: true,
        onCheck: (args) => {
          permissionRequests.push(args.permissions);
          return undefined;
        },
      }),
    });

    expect(await canReadDocumentRealtime(entry, createTestUser(), {title: "Any"})).toBe(true);
    expect(permissionRequests).toEqual([{todo: ["list"]}]);
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
});
