import {beforeEach, describe, expect, it} from "bun:test";
import {createAccess, Permissions, terrenoStatements} from "@terreno/api";
import mongoose from "mongoose";

import {UserModel} from "../tests/helpers";
import {resolveObservabilityPermissions} from "./permissions";

describe("resolveObservabilityPermissions", () => {
  beforeEach(async () => {
    await UserModel.deleteMany({});
  });

  it("grants every observability action when accessControl is omitted", async () => {
    const user = await UserModel.create({
      admin: false,
      email: "no-ac@example.com",
      name: "No AC",
    });
    const permissions = await resolveObservabilityPermissions({user});
    expect(permissions.aiPrompt?.list).toBe(true);
    expect(permissions.aiPrompt?.create).toBe(true);
    expect(permissions.aiExperiment?.promote).toBe(true);
    expect(permissions.aiReview?.score).toBe(true);
  });

  it("grants every action for legacy admin users", async () => {
    const user = await UserModel.create({
      admin: true,
      email: "legacy@example.com",
      name: "Legacy",
    });
    const accessControl = createAccess({
      connection: mongoose.connection,
      resolvePermissions: async () => ({
        admin: ["access"],
        aiPrompt: ["list", "read"],
      }),
      statements: terrenoStatements,
    });
    const permissions = await resolveObservabilityPermissions({accessControl, user});
    expect(permissions.aiPrompt?.playground).toBe(true);
    expect(permissions.aiDataset?.delete).toBe(true);
    expect(permissions.aiEvaluator?.update).toBe(true);
    expect(permissions.aiTrace?.read).toBe(true);
  });

  it("reflects effective RBAC grants for non-admin users", async () => {
    const user = await UserModel.create({
      admin: false,
      email: "auditor@example.com",
      name: "Auditor",
    });
    const accessControl = createAccess({
      connection: mongoose.connection,
      resolvePermissions: async () => ({
        admin: ["access"],
        aiPrompt: ["list", "read"],
        aiTrace: ["list", "read"],
      }),
      statements: terrenoStatements,
    });
    const permissions = await resolveObservabilityPermissions({accessControl, user});
    expect(permissions.aiPrompt).toEqual({
      create: false,
      list: true,
      playground: false,
      promote: false,
      read: true,
      update: false,
    });
    expect(permissions.aiTrace?.list).toBe(true);
    expect(permissions.aiDataset?.create).toBe(false);
  });

  it("returns all false when the user lacks admin shell access", async () => {
    const user = await UserModel.create({
      admin: false,
      email: "outsider@example.com",
      name: "Outsider",
    });
    const accessControl = createAccess({
      connection: mongoose.connection,
      resolvePermissions: async () => ({
        aiPrompt: ["list", "read"],
      }),
      statements: terrenoStatements,
    });
    const permissions = await resolveObservabilityPermissions({accessControl, user});
    expect(permissions.aiPrompt?.list).toBe(false);
    expect(permissions.aiPrompt?.read).toBe(false);
  });

  it("matches Permissions.IsAdmin for the legacy flag", () => {
    expect(Permissions.IsAdmin("read", {admin: true} as never)).toBe(true);
  });
});
