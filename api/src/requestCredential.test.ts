import {beforeEach, describe, expect, it} from "bun:test";
import type express from "express";
import mongoose, {model, Schema} from "mongoose";

import {modelRouter} from "./api";
import type {UserModel as UserModelType} from "./auth";
import {clearMCPRegistry} from "./mcp/registry";
import {Permissions} from "./permissions";
import {
  getCurrentRequestContext,
  type RequestCredential,
  runWithRequestContext,
  updateRequestContextFromRequest,
} from "./requestContext";
import {TerrenoApp} from "./terrenoApp";
import {authAsUser, setupDb, UserModel} from "./tests";

const typedUserModel = UserModel as unknown as UserModelType;

const gadgetSchema = new Schema({name: {description: "Gadget name", type: String}});
const GadgetModel =
  (mongoose.models.CredentialGadget as mongoose.Model<{name?: string}> | undefined) ??
  model<{name?: string}>("CredentialGadget", gadgetSchema);

const fakeRequest = (fields: Record<string, unknown>): express.Request =>
  ({header: () => undefined, ...fields}) as unknown as express.Request;

const credentialFor = (fields: Record<string, unknown>): RequestCredential | undefined =>
  runWithRequestContext({}, () => {
    updateRequestContextFromRequest(fakeRequest(fields));
    return getCurrentRequestContext()?.credential;
  });

describe("request context credential", () => {
  it("records jwt when a decoded JWT authenticated the user", () => {
    expect(credentialFor({authTokenPayload: {id: "u1"}, user: {id: "u1"}})).toBe("jwt");
  });

  it("records better-auth-session when a Better Auth session authenticated the user", () => {
    expect(
      credentialFor({
        authTokenPayload: {id: "u1"},
        betterAuthSession: {session: {id: "s1"}},
        user: {id: "u1"},
      })
    ).toBe("better-auth-session");
  });

  it("leaves the credential unset for anonymous requests", () => {
    expect(credentialFor({authTokenPayload: {id: "u1"}})).toBeUndefined();
  });

  describe("inside a REST permission function", () => {
    let app: express.Application;
    let seen: Array<RequestCredential | undefined>;

    beforeEach(async () => {
      await setupDb();
      clearMCPRegistry();
      seen = [];
      const recordCredential = (): boolean => {
        seen.push(getCurrentRequestContext()?.credential);
        return true;
      };
      app = new TerrenoApp({skipListen: true, userModel: typedUserModel})
        .register(
          modelRouter("/credential-gadgets", GadgetModel, {
            permissions: {
              create: [Permissions.IsAuthenticated],
              delete: [],
              list: [Permissions.IsAuthenticated, recordCredential],
              read: [Permissions.IsAuthenticated],
              update: [],
            },
          })
        )
        .build();
    });

    it("reports jwt for a JWT bearer", async () => {
      const agent = await authAsUser(app, "notAdmin");

      const res = await agent.get("/credential-gadgets");

      expect(res.status).toBe(200);
      expect(seen).toEqual(["jwt"]);
    });
  });
});
