import {beforeAll, beforeEach, describe, expect, it, mock} from "bun:test";
import {AuditApp, TerrenoApp} from "@terreno/api";
import {expectAPIError, waitUntil} from "@terreno/test";
import type express from "express";
import mongoose from "mongoose";

import {GptSkill, setSkillFileStorage} from "../models/gptSkill";
import {authAsUser, authAsUserWithCredentials, ensureTestUsers, UserModel} from "../tests/helpers";
import {addSkillRoutes} from "./skills";

const OTHER_USER = {admin: false, email: "other@example.com", name: "Other", password: "password"};

const SKILL_BODY = {description: "d", instructions: "i", name: "brand-voice"};

const FILES = [
  {filename: "a.png", gcsKey: "skills/a.png", mimeType: "image/png", size: 10},
  {filename: "b.txt", gcsKey: "skills/b.txt", mimeType: "text/plain", size: 5},
];

describe("GPT skill routes", () => {
  let app: express.Application;
  let userAId: mongoose.Types.ObjectId;
  let userBId: mongoose.Types.ObjectId;
  let deleteFile: ReturnType<typeof mock>;
  let fileStorageService: {delete: ReturnType<typeof mock>};

  const buildApp = (withAudit = false): express.Application => {
    const terreno = new TerrenoApp({
      configureApp: (router, options) => {
        addSkillRoutes(router, {fileStorageService, openApiOptions: options} as never);
      },
      skipListen: true,
      userModel: UserModel as never,
    });
    if (withAudit) {
      terreno.register(new AuditApp());
    }
    return terreno.build();
  };

  const seedGlobal = async (extra: Record<string, unknown> = {}): Promise<mongoose.Document> =>
    GptSkill.create({
      description: "House style",
      instructions: "Be on brand",
      name: "house-style",
      scope: "global",
      ...extra,
    });

  beforeAll(async () => {
    await ensureTestUsers();
    await ensureTestUsers([OTHER_USER]);
    const a = await UserModel.findOne({email: "notAdmin@example.com"});
    const b = await UserModel.findOne({email: OTHER_USER.email});
    userAId = a!._id as mongoose.Types.ObjectId;
    userBId = b!._id as mongoose.Types.ObjectId;
  });

  beforeEach(async () => {
    await GptSkill.deleteMany({});
    deleteFile = mock(async () => {});
    fileStorageService = {delete: deleteFile};
    setSkillFileStorage(fileStorageService as never);
    app = buildApp();
  });

  const asB = () => authAsUserWithCredentials(app, {email: OTHER_USER.email, password: "password"});

  describe("create", () => {
    it("creates a user-scoped skill owned by the caller", async () => {
      const agent = await authAsUser(app, "notAdmin");
      const res = await agent.post("/gpt/skills").send(SKILL_BODY);
      expect(res.status).toBe(201);
      expect(res.body.data.scope).toBe("user");
      expect(res.body.data.userId).toBe(userAId.toString());
      expect(res.body.data.name).toBe("brand-voice");
    });

    it("ignores client-supplied files and userId on create", async () => {
      const agent = await authAsUser(app, "notAdmin");
      const res = await agent
        .post("/gpt/skills")
        .send({...SKILL_BODY, files: FILES, userId: userBId.toString()});
      expect(res.status).toBe(201);
      expect(res.body.data.userId).toBe(userAId.toString());
      expect(res.body.data.files).toEqual([]);
      const stored = await GptSkill.findById(res.body.data._id).lean();
      expect(stored?.files ?? []).toEqual([]);
      expect(String(stored?.userId)).toBe(userAId.toString());
    });

    it("rejects a request without a token with 401", async () => {
      const res = await (await import("supertest"))
        .default(app)
        .post("/gpt/skills")
        .send(SKILL_BODY);
      expect(res.status).toBe(401);
    });

    it("forbids a non-admin creating a global skill", async () => {
      const agent = await authAsUser(app, "notAdmin");
      const res = await agent.post("/gpt/skills").send({...SKILL_BODY, scope: "global"});
      expectAPIError(res, {status: 403, title: "Only admins can create global skills"});
    });

    it("lets an admin create a global skill with no userId", async () => {
      const agent = await authAsUser(app, "admin");
      const res = await agent.post("/gpt/skills").send({...SKILL_BODY, scope: "global"});
      expect(res.status).toBe(201);
      expect(res.body.data.scope).toBe("global");
      expect(res.body.data.userId).toBeUndefined();
    });

    it("rejects a name with uppercase and spaces with 400", async () => {
      const agent = await authAsUser(app, "notAdmin");
      const res = await agent.post("/gpt/skills").send({...SKILL_BODY, name: "Brand Voice"});
      expect(res.status).toBe(400);
    });

    it("rejects a 65-character name with 400", async () => {
      const agent = await authAsUser(app, "notAdmin");
      const res = await agent.post("/gpt/skills").send({...SKILL_BODY, name: "a".repeat(65)});
      expect(res.status).toBe(400);
    });

    it("accepts a 64-character name", async () => {
      const agent = await authAsUser(app, "notAdmin");
      const res = await agent.post("/gpt/skills").send({...SKILL_BODY, name: "a".repeat(64)});
      expect(res.status).toBe(201);
    });

    it("rejects a 1025-character description with 400", async () => {
      const agent = await authAsUser(app, "notAdmin");
      const res = await agent
        .post("/gpt/skills")
        .send({...SKILL_BODY, description: "d".repeat(1025)});
      expect(res.status).toBe(400);
    });

    it("rejects an empty description with 400", async () => {
      const agent = await authAsUser(app, "notAdmin");
      const res = await agent.post("/gpt/skills").send({...SKILL_BODY, description: ""});
      expect(res.status).toBe(400);
    });

    it("rejects a duplicate own name with 409", async () => {
      const agent = await authAsUser(app, "notAdmin");
      await agent.post("/gpt/skills").send(SKILL_BODY).expect(201);
      const res = await agent.post("/gpt/skills").send(SKILL_BODY);
      expectAPIError(res, {status: 409, title: "Skill brand-voice already exists"});
    });

    it("rejects a user skill that reuses a global name with 409", async () => {
      await seedGlobal();
      const agent = await authAsUser(app, "notAdmin");
      const res = await agent.post("/gpt/skills").send({...SKILL_BODY, name: "house-style"});
      expectAPIError(res, {
        status: 409,
        title: "A global skill named house-style already exists",
      });
    });

    it("lets two users each own a skill with the same name", async () => {
      const a = await authAsUser(app, "notAdmin");
      const b = await asB();
      await a.post("/gpt/skills").send(SKILL_BODY).expect(201);
      const res = await b.post("/gpt/skills").send(SKILL_BODY);
      expect(res.status).toBe(201);
    });
  });

  describe("list and read", () => {
    it("lists the caller's skills plus globals, without instructions", async () => {
      await seedGlobal();
      const a = await authAsUser(app, "notAdmin");
      await a.post("/gpt/skills").send(SKILL_BODY).expect(201);

      const res = await a.get("/gpt/skills");
      expect(res.status).toBe(200);
      const names = res.body.data.map((s: {name: string}) => s.name).sort();
      expect(names).toEqual(["brand-voice", "house-style"]);
      for (const skill of res.body.data) {
        expect(skill.instructions).toBeUndefined();
        expect(skill.description).toBeDefined();
        expect(skill.enabled).toBe(true);
      }
    });

    it("lists only global skills for another user", async () => {
      await seedGlobal();
      const a = await authAsUser(app, "notAdmin");
      await a.post("/gpt/skills").send(SKILL_BODY).expect(201);

      const b = await asB();
      const res = await b.get("/gpt/skills");
      expect(res.status).toBe(200);
      expect(res.body.data.map((s: {name: string}) => s.name)).toEqual(["house-style"]);
    });

    it("exposes only filename, mimeType and size for files in the list", async () => {
      await GptSkill.create({
        description: "d",
        files: FILES,
        instructions: "i",
        name: "with-files",
        scope: "user",
        userId: userAId,
      });
      const a = await authAsUser(app, "notAdmin");
      const res = await a.get("/gpt/skills");
      expect(res.body.data[0].files).toEqual([
        {filename: "a.png", mimeType: "image/png", size: 10},
        {filename: "b.txt", mimeType: "text/plain", size: 5},
      ]);
    });

    it("includes instructions when the owner reads the skill", async () => {
      const a = await authAsUser(app, "notAdmin");
      const created = await a.post("/gpt/skills").send(SKILL_BODY);
      const res = await a.get(`/gpt/skills/${created.body.data._id}`);
      expect(res.status).toBe(200);
      expect(res.body.data.instructions).toBe("i");
    });

    it("lets any user read a global skill with instructions", async () => {
      const global = await seedGlobal();
      const b = await asB();
      const res = await b.get(`/gpt/skills/${global._id}`);
      expect(res.status).toBe(200);
      expect(res.body.data.instructions).toBe("Be on brand");
    });

    it("forbids reading another user's skill with 403", async () => {
      const a = await authAsUser(app, "notAdmin");
      const created = await a.post("/gpt/skills").send(SKILL_BODY);
      const b = await asB();
      const res = await b.get(`/gpt/skills/${created.body.data._id}`);
      expect(res.status).toBe(403);
    });

    it("returns 404 for a missing id", async () => {
      const a = await authAsUser(app, "notAdmin");
      const res = await a.get(`/gpt/skills/${new mongoose.Types.ObjectId()}`);
      expect(res.status).toBe(404);
    });

    it("rejects an unauthenticated list with 401", async () => {
      const res = await (await import("supertest")).default(app).get("/gpt/skills");
      expect(res.status).toBe(401);
    });
  });

  describe("update", () => {
    it("lets the owner patch their skill", async () => {
      const a = await authAsUser(app, "notAdmin");
      const created = await a.post("/gpt/skills").send(SKILL_BODY);
      const res = await a
        .patch(`/gpt/skills/${created.body.data._id}`)
        .send({description: "new", enabled: false});
      expect(res.status).toBe(200);
      expect(res.body.data.description).toBe("new");
      expect(res.body.data.enabled).toBe(false);
    });

    it("ignores client-supplied files, scope and userId on patch", async () => {
      const a = await authAsUser(app, "notAdmin");
      const created = await a.post("/gpt/skills").send(SKILL_BODY);
      const res = await a
        .patch(`/gpt/skills/${created.body.data._id}`)
        .send({description: "new", files: FILES, scope: "global", userId: userBId.toString()});
      expect(res.status).toBe(200);
      expect(res.body.data.description).toBe("new");
      const stored = await GptSkill.findById(created.body.data._id).lean();
      expect(stored?.files ?? []).toEqual([]);
      expect(stored?.scope).toBe("user");
      expect(String(stored?.userId)).toBe(userAId.toString());
    });

    it("forbids patching another user's skill with 403", async () => {
      const a = await authAsUser(app, "notAdmin");
      const created = await a.post("/gpt/skills").send(SKILL_BODY);
      const b = await asB();
      const res = await b.patch(`/gpt/skills/${created.body.data._id}`).send({description: "x"});
      expect(res.status).toBe(403);
    });

    it("forbids a non-admin patching a global skill with 403", async () => {
      const global = await seedGlobal();
      const a = await authAsUser(app, "notAdmin");
      const res = await a.patch(`/gpt/skills/${global._id}`).send({description: "x"});
      expect(res.status).toBe(403);
    });

    it("lets an admin patch a global skill", async () => {
      const global = await seedGlobal();
      const admin = await authAsUser(app, "admin");
      const res = await admin.patch(`/gpt/skills/${global._id}`).send({description: "x"});
      expect(res.status).toBe(200);
      expect(res.body.data.description).toBe("x");
    });

    it("rejects renaming onto an existing own skill with 409", async () => {
      const a = await authAsUser(app, "notAdmin");
      await a
        .post("/gpt/skills")
        .send({...SKILL_BODY, name: "first"})
        .expect(201);
      const second = await a.post("/gpt/skills").send({...SKILL_BODY, name: "second"});
      const res = await a.patch(`/gpt/skills/${second.body.data._id}`).send({name: "first"});
      expect(res.status).toBe(409);
    });
  });

  describe("delete", () => {
    it("forbids a non-admin deleting a global skill with 403", async () => {
      const global = await seedGlobal();
      const a = await authAsUser(app, "notAdmin");
      const res = await a.delete(`/gpt/skills/${global._id}`);
      expect(res.status).toBe(403);
    });

    it("lets an admin delete a global skill", async () => {
      const global = await seedGlobal();
      const admin = await authAsUser(app, "admin");
      const res = await admin.delete(`/gpt/skills/${global._id}`);
      expect(res.status).toBe(204);
    });

    it("forbids deleting another user's skill with 403", async () => {
      const a = await authAsUser(app, "notAdmin");
      const created = await a.post("/gpt/skills").send(SKILL_BODY);
      const b = await asB();
      const res = await b.delete(`/gpt/skills/${created.body.data._id}`);
      expect(res.status).toBe(403);
    });

    it("soft-deletes, removes each file from storage, and hides the skill from the list", async () => {
      const skill = await GptSkill.create({
        description: "d",
        files: FILES,
        instructions: "i",
        name: "with-files",
        scope: "user",
        userId: userAId,
      });
      const a = await authAsUser(app, "notAdmin");
      const res = await a.delete(`/gpt/skills/${skill._id}`);
      expect(res.status).toBe(204);

      await waitUntil(() => deleteFile.mock.calls.length === 2);
      expect(deleteFile.mock.calls.map((c) => c[0]).sort()).toEqual([
        "skills/a.png",
        "skills/b.txt",
      ]);
      const list = await a.get("/gpt/skills");
      expect(list.body.data).toEqual([]);
    });

    it("frees the name after a delete so it can be reused", async () => {
      const a = await authAsUser(app, "notAdmin");
      const created = await a.post("/gpt/skills").send(SKILL_BODY);
      await a.delete(`/gpt/skills/${created.body.data._id}`).expect(204);
      const res = await a.post("/gpt/skills").send(SKILL_BODY);
      expect(res.status).toBe(201);
    });
  });

  describe("model hooks outside the routes", () => {
    it("defaults a skill with no scope and no userId to global", async () => {
      const skill = await GptSkill.create({description: "d", instructions: "i", name: "plain"});
      expect(skill.scope).toBe("global");
      expect(skill.userId).toBeUndefined();
    });

    it("rejects a user skill named like a global with an APIError 409", async () => {
      await seedGlobal();
      const error = await GptSkill.create({
        description: "d",
        instructions: "i",
        name: "house-style",
        scope: "user",
        userId: userBId,
      }).catch((e: unknown) => e);
      expect((error as {status?: number}).status).toBe(409);
    });

    it("removes files from storage when a skill is soft-deleted through save", async () => {
      const skill = await GptSkill.create({
        description: "d",
        files: FILES,
        instructions: "i",
        name: "global-files",
        scope: "global",
      });
      skill.deleted = true;
      await skill.save();
      await waitUntil(() => deleteFile.mock.calls.length === 2);
      expect(deleteFile.mock.calls.map((c) => c[0]).sort()).toEqual([
        "skills/a.png",
        "skills/b.txt",
      ]);
    });

    it("removes files from storage when a skill is soft-deleted through updateOne", async () => {
      const skill = await GptSkill.create({
        description: "d",
        files: FILES,
        instructions: "i",
        name: "global-files",
        scope: "global",
      });
      await GptSkill.updateOne({_id: skill._id}, {deleted: true});
      await waitUntil(() => deleteFile.mock.calls.length === 2);
      expect(deleteFile.mock.calls.map((c) => c[0]).sort()).toEqual([
        "skills/a.png",
        "skills/b.txt",
      ]);
    });

    it("does not delete files when a skill is saved without being deleted", async () => {
      const skill = await GptSkill.create({
        description: "d",
        files: FILES,
        instructions: "i",
        name: "keeper",
        scope: "global",
      });
      skill.description = "changed";
      await skill.save();
      expect(deleteFile).not.toHaveBeenCalled();
    });
  });

  describe("audit", () => {
    it("records one create event for GptSkill when AuditApp is registered", async () => {
      await mongoose.connection.collection("auditevents").deleteMany({});
      app = buildApp(true);
      const a = await authAsUser(app, "notAdmin");
      const res = await a.post("/gpt/skills").send(SKILL_BODY);
      expect(res.status).toBe(201);

      await waitUntil(
        async () =>
          (await mongoose.connection
            .collection("auditevents")
            .countDocuments({modelName: "GptSkill"})) === 1
      );
      const events = await mongoose.connection
        .collection("auditevents")
        .find({modelName: "GptSkill"})
        .toArray();
      expect(events.length).toBe(1);
      expect(events[0].verb).toBe("created");
      expect(events[0].recordId).toBe(res.body.data._id);
    });
  });
});
