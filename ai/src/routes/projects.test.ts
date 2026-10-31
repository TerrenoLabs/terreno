import {beforeAll, beforeEach, describe, expect, it} from "bun:test";
import {TerrenoApp} from "@terreno/api";
import type express from "express";
import mongoose from "mongoose";

import {Project} from "../models/project";
import {authAsUser, ensureTestUsers, terrenoUserModel, UserModel} from "../tests/helpers";
import {addProjectRoutes} from "./projects";

describe("Project Routes", () => {
  let app: express.Application;
  let notAdminId: mongoose.Types.ObjectId;

  beforeAll(async () => {
    await ensureTestUsers();
    const user = await UserModel.findOne({email: "notAdmin@example.com"});
    notAdminId = user!._id as mongoose.Types.ObjectId;
  });

  beforeEach(async () => {
    await Project.deleteMany({});
    app = new TerrenoApp({
      configureApp: (router, options) => {
        addProjectRoutes(router, {openApiOptions: options});
      },
      skipListen: true,
      userModel: terrenoUserModel,
    }).build();
  });

  describe("project memories (subdoc)", () => {
    it("stores memories and exposes _id for each memory", async () => {
      const project = await Project.create({
        memories: [
          {source: "user" as const, text: "Memory 1"},
          {category: "pref", source: "auto" as const, text: "Memory 2"},
        ],
        name: "With memories",
        userId: notAdminId,
      });
      expect(project.memories.length).toBe(2);
      expect(project.memories[0]._id).toBeDefined();
      expect(project.memories[1].category).toBe("pref");
      expect(project.memories[1].source).toBe("auto");
    });

    it("defaults source to user when not specified", async () => {
      const project = await Project.create({
        memories: [{text: "No source"} as unknown as {source: "user"; text: string}],
        name: "Defaults",
        userId: notAdminId,
      });
      expect(project.memories[0].source).toBe("user");
    });
  });

  describe("model router CRUD", () => {
    it("creates a project for the authenticated user", async () => {
      const agent = await authAsUser(app, "notAdmin");
      const res = await agent.post("/gpt/projects").send({name: "Created"});
      expect(res.status).toBe(201);
      expect(res.body.data.name).toBe("Created");
      expect(res.body.data.userId).toBe(notAdminId.toString());
    });

    it("lists only the caller's projects", async () => {
      const other = new mongoose.Types.ObjectId();
      await Project.create({name: "Mine", userId: notAdminId});
      await Project.create({name: "Theirs", userId: other});
      const agent = await authAsUser(app, "notAdmin");
      const res = await agent.get("/gpt/projects");
      expect(res.status).toBe(200);
      const names = (res.body.data as Array<{name: string}>).map((p) => p.name);
      expect(names).toContain("Mine");
      expect(names).not.toContain("Theirs");
    });

    it("exposes ownerId virtual aliased to userId", async () => {
      const project = await Project.create({name: "With Owner", userId: notAdminId});
      expect(
        project.toObject<{ownerId: mongoose.Types.ObjectId}>({virtuals: true}).ownerId.toString()
      ).toBe(notAdminId.toString());
    });
  });

  describe("memory routes", () => {
    it("requires text when adding a memory", async () => {
      const project = await Project.create({name: "Proj", userId: notAdminId});
      const agent = await authAsUser(app, "notAdmin");
      const res = await agent
        .post(`/gpt/projects/${project._id.toString()}/memories`)
        .send({category: "pref"});
      expect(res.status).toBe(400);
    });

    it("adds a memory to a project owned by the caller", async () => {
      const project = await Project.create({name: "Proj", userId: notAdminId});
      const agent = await authAsUser(app, "notAdmin");
      const res = await agent
        .post(`/gpt/projects/${project._id.toString()}/memories`)
        .send({category: "pref", text: "Likes X"});
      expect(res.status).toBe(200);
      expect(res.body.data.text).toBe("Likes X");
      expect(res.body.data.category).toBe("pref");
      expect(res.body.data.source).toBe("user");
    });

    it("returns 404 when adding to a missing project", async () => {
      const agent = await authAsUser(app, "notAdmin");
      const res = await agent
        .post(`/gpt/projects/${new mongoose.Types.ObjectId().toString()}/memories`)
        .send({text: "Anything"});
      expect(res.status).toBe(404);
    });

    it("returns 403 when adding to another user's project", async () => {
      const other = new mongoose.Types.ObjectId();
      const project = await Project.create({name: "Theirs", userId: other});
      const agent = await authAsUser(app, "notAdmin");
      const res = await agent
        .post(`/gpt/projects/${project._id.toString()}/memories`)
        .send({text: "Anything"});
      expect(res.status).toBe(403);
    });

    it("deletes a memory from a project owned by the caller", async () => {
      const project = await Project.create({
        memories: [{source: "user" as const, text: "Mem"}],
        name: "Proj",
        userId: notAdminId,
      });
      const memoryId = project.memories[0]._id?.toString();
      const agent = await authAsUser(app, "notAdmin");
      const res = await agent.delete(
        `/gpt/projects/${project._id.toString()}/memories/${memoryId}`
      );
      expect(res.status).toBe(200);
      expect(res.body.data.deleted).toBe(true);
      const updated = await Project.findById(project._id);
      expect(updated?.memories.length).toBe(0);
    });

    it("returns 404 when deleting from a missing project", async () => {
      const agent = await authAsUser(app, "notAdmin");
      const res = await agent.delete(
        `/gpt/projects/${new mongoose.Types.ObjectId().toString()}/memories/${new mongoose.Types.ObjectId().toString()}`
      );
      expect(res.status).toBe(404);
    });

    it("returns 404 for deleting a missing memory", async () => {
      const project = await Project.create({name: "Proj", userId: notAdminId});
      const agent = await authAsUser(app, "notAdmin");
      const res = await agent.delete(
        `/gpt/projects/${project._id.toString()}/memories/${new mongoose.Types.ObjectId().toString()}`
      );
      expect(res.status).toBe(404);
    });

    it("returns 403 for deleting from another user's project", async () => {
      const other = new mongoose.Types.ObjectId();
      const project = await Project.create({
        memories: [{source: "user" as const, text: "Mem"}],
        name: "Theirs",
        userId: other,
      });
      const memoryId = project.memories[0]._id?.toString();
      const agent = await authAsUser(app, "notAdmin");
      const res = await agent.delete(
        `/gpt/projects/${project._id.toString()}/memories/${memoryId}`
      );
      expect(res.status).toBe(403);
    });
  });
});
