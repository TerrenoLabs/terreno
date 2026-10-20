/** Verifies `/openapi.json` documents the auth, me, and recovery routes TerrenoApp mounts. */
import {afterEach, beforeEach, describe, expect, it} from "bun:test";
import type express from "express";
import mongoose from "mongoose";
import supertest from "supertest";

import type {UserModel as UserModelType} from "./auth";
import {createAccess} from "./rbac/access";
import {terrenoStatements} from "./rbac/statements";
import {TerrenoApp} from "./terrenoApp";
import {authAsUser, setupDb, UserModel} from "./tests";

const typedUserModel = UserModel as unknown as UserModelType;

interface OpenApiSchemaNode {
  properties?: Record<string, OpenApiSchemaNode>;
  required?: string[];
  type?: string;
}

interface OpenApiOperation {
  parameters?: {in: string; name: string}[];
  requestBody?: {content: Record<string, {schema: OpenApiSchemaNode}>};
  responses: Record<string, {content?: Record<string, {schema: OpenApiSchemaNode}>}>;
  tags?: string[];
}

type OpenApiPaths = Record<string, Record<string, OpenApiOperation>>;

const fetchPaths = async (app: express.Application): Promise<OpenApiPaths> => {
  const res = await supertest(app).get("/openapi.json").expect(200);
  return res.body.paths as OpenApiPaths;
};

const jsonSchema = (
  operation: OpenApiOperation | undefined,
  status: string
): OpenApiSchemaNode | undefined => {
  return operation?.responses[status]?.content?.["application/json"]?.schema;
};

describe("auth OpenAPI documentation", () => {
  const originalEnv = process.env;

  beforeEach(async () => {
    process.env = {
      ...originalEnv,
      REFRESH_TOKEN_SECRET: "test-refresh-secret",
      SESSION_SECRET: "test-session-secret",
      TOKEN_EXPIRES_IN: "1h",
      TOKEN_ISSUER: "test-issuer",
      TOKEN_SECRET: "test-secret",
    };
    await setupDb();
  });

  afterEach(() => {
    process.env = originalEnv;
  });

  describe("/auth/me", () => {
    it("documents GET with the user model fields inside a data envelope", async () => {
      const app = new TerrenoApp({skipListen: true, userModel: typedUserModel}).build();
      const paths = await fetchPaths(app);

      const getMe = paths["/auth/me"]?.get;
      expect(getMe?.tags).toEqual(["auth"]);
      const body = jsonSchema(getMe, "200");
      expect(body?.required).toEqual(["data"]);
      const user = body?.properties?.data;
      expect(user?.type).toBe("object");
      expect(user?.properties?.email?.type).toBe("string");
      expect(user?.properties?.admin?.type).toBe("boolean");
      expect(user?.properties?.id?.type).toBe("string");
      expect(user?.properties?._id?.type).toBe("string");
      expect(user?.required).toEqual(expect.arrayContaining(["_id", "id"]));
      // passport-local-mongoose stores these with select: false, so /auth/me never returns them.
      expect(user?.properties?.hash).toBeUndefined();
      expect(user?.properties?.salt).toBeUndefined();
      // Without accessControl the handler adds no roles/permissions.
      expect(user?.properties?.permissions).toBeUndefined();
    });

    it("documents every field GET /auth/me actually returns", async () => {
      const app = new TerrenoApp({skipListen: true, userModel: typedUserModel}).build();
      const paths = await fetchPaths(app);
      const documented = Object.keys(
        jsonSchema(paths["/auth/me"]?.get, "200")?.properties?.data?.properties ?? {}
      );

      const agent = await authAsUser(app, "notAdmin");
      const res = await agent.get("/auth/me").expect(200);
      const returned = Object.keys(res.body.data).filter((key) => key !== "__v");
      expect(documented).toEqual(expect.arrayContaining(returned));
    });

    it("documents PATCH with a partial user body that omits privileged fields", async () => {
      const app = new TerrenoApp({skipListen: true, userModel: typedUserModel}).build();
      const paths = await fetchPaths(app);

      const patchMe = paths["/auth/me"]?.patch;
      const requestSchema = patchMe?.requestBody?.content["application/json"]?.schema;
      expect(requestSchema?.properties?.name?.type).toBe("string");
      expect(requestSchema?.properties?.email?.type).toBe("string");
      expect(requestSchema?.required).toBeUndefined();
      for (const field of ["admin", "emailVerified", "tokenEpoch", "_id", "hash", "salt"]) {
        expect(requestSchema?.properties?.[field]).toBeUndefined();
      }
      const body = jsonSchema(patchMe, "200");
      expect(body?.required).toEqual(["data"]);
      expect(body?.properties?.data?.properties?.id?.type).toBe("string");
    });

    it("keeps PATCH /auth/me behavior: privileged fields are still ignored", async () => {
      const app = new TerrenoApp({skipListen: true, userModel: typedUserModel}).build();
      const agent = await authAsUser(app, "notAdmin");
      const res = await agent.patch("/auth/me").send({admin: true, name: "Renamed"}).expect(200);
      expect(res.body.data.name).toBe("Renamed");
      expect(res.body.data.admin).toBe(false);
    });

    it("documents roles and permissions when accessControl is configured", async () => {
      const access = createAccess({
        connection: mongoose.connection,
        statements: terrenoStatements,
        userModel: typedUserModel,
      });
      const app = new TerrenoApp({
        accessControl: access,
        skipListen: true,
        userModel: typedUserModel,
      }).build();
      const paths = await fetchPaths(app);

      const user = jsonSchema(paths["/auth/me"]?.get, "200")?.properties?.data;
      expect(user?.properties?.roles?.type).toBe("array");
      expect(user?.properties?.permissions?.type).toBe("object");
      expect(user?.required).toEqual(expect.arrayContaining(["roles", "permissions"]));
    });
  });

  describe("recovery routes", () => {
    it("documents forgotPassword, resetPassword, sendVerification, and verifyEmail", async () => {
      const app = new TerrenoApp({
        authOptions: {publicAppUrl: "https://app.example.com"},
        skipListen: true,
        userModel: typedUserModel,
      }).build();
      const paths = await fetchPaths(app);

      const forgot = paths["/auth/forgotPassword"]?.post;
      expect(forgot?.requestBody?.content["application/json"]?.schema.properties?.email?.type).toBe(
        "string"
      );
      expect(forgot?.responses["200"]).toBeUndefined();
      const forgotBody = jsonSchema(forgot, "202");
      expect(forgotBody?.required).toEqual(["data"]);
      expect(forgotBody?.properties?.data?.properties?.ok?.type).toBe("boolean");

      for (const path of ["/auth/resetPassword", "/resetPassword"]) {
        const reset = paths[path]?.post;
        expect(
          Object.keys(reset?.requestBody?.content["application/json"]?.schema.properties ?? {})
        ).toEqual(["newPassword", "password", "token"]);
        const resetData = jsonSchema(reset, "200")?.properties?.data;
        expect(resetData?.required).toEqual(["refreshToken", "token", "userId"]);
      }

      const sendVerification = paths["/auth/sendVerification"]?.post;
      expect(sendVerification?.requestBody).toBeUndefined();
      expect(jsonSchema(sendVerification, "202")?.properties?.data?.properties?.ok?.type).toBe(
        "boolean"
      );

      const verifyEmail = paths["/auth/verifyEmail"]?.post;
      expect(
        verifyEmail?.requestBody?.content["application/json"]?.schema.properties?.token?.type
      ).toBe("string");
      expect(jsonSchema(verifyEmail, "200")?.properties?.data?.properties?.ok?.type).toBe(
        "boolean"
      );
    });

    it("omits routes the auth options turn off", async () => {
      const app = new TerrenoApp({
        authOptions: {emailVerification: false, legacyResetPasswordRoute: false},
        skipListen: true,
        userModel: typedUserModel,
      }).build();
      const paths = await fetchPaths(app);

      expect(paths["/auth/forgotPassword"]?.post).toBeDefined();
      expect(paths["/resetPassword"]).toBeUndefined();
      expect(paths["/auth/sendVerification"]).toBeUndefined();
      expect(paths["/auth/verifyEmail"]).toBeUndefined();
    });
  });
});
