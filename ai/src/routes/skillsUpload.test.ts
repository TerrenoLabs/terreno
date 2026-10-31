import {beforeAll, beforeEach, describe, expect, it, mock, spyOn} from "bun:test";
import {AuditApp, flushAuditRecorderForTests, TerrenoApp} from "@terreno/api";
import {expectAPIError, registerGcsMock} from "@terreno/test";
import type express from "express";
import {strToU8, zipSync} from "fflate";
import mongoose from "mongoose";

import {FileAttachment} from "../models/fileAttachment";
import {GptSkill} from "../models/gptSkill";
import type {UploadFileParams, UploadFileResult} from "../service/fileStorage";
import {authAsUser, ensureTestUsers, UserModel} from "../tests/helpers";
import {addSkillRoutes} from "./skills";

// In-memory @google-cloud/storage, so the real FileStorageService can run in one case below.
const gcs = registerGcsMock();
const {FileStorageService} = await import("../service/fileStorage");

const SKILL_MD = "---\nname: poster-style\ndescription: Poster look\n---\n# Steps";
const PNG = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);

const zipOf = (entries: Record<string, Uint8Array | string>): Buffer =>
  Buffer.from(
    zipSync(
      Object.fromEntries(
        Object.entries(entries).map(([path, data]) => [
          path,
          typeof data === "string" ? strToU8(data) : data,
        ])
      )
    )
  );

describe("POST /gpt/skills/upload", () => {
  let userId: mongoose.Types.ObjectId;
  let upload: ReturnType<typeof mock>;
  let remove: ReturnType<typeof mock>;

  const buildApp = (
    withStorage = true,
    withAudit = false,
    fileStorageService: unknown = withStorage ? {delete: remove, upload} : undefined
  ): express.Application => {
    const terreno = new TerrenoApp({
      configureApp: (router, options) => {
        addSkillRoutes(router, {
          fileStorageService,
          openApiOptions: options,
        } as never);
      },
      skipListen: true,
      userModel: UserModel as never,
    });
    if (withAudit) {
      terreno.register(new AuditApp());
    }
    return terreno.build();
  };

  const uploadCalls = (): UploadFileParams[] => upload.mock.calls.map((c) => c[0]);

  beforeAll(async () => {
    await ensureTestUsers();
    const user = await UserModel.findOne({email: "notAdmin@example.com"});
    userId = user!._id as mongoose.Types.ObjectId;
  });

  beforeEach(async () => {
    await GptSkill.deleteMany({});
    remove = mock(async () => {});
    upload = mock(
      async (params: UploadFileParams): Promise<UploadFileResult> => ({
        filename: params.filename,
        gcsKey: `${params.keyPrefix}/${params.userId}/1-${params.filename}`,
        id: "6710c2a4f1c0de0000000001",
        mimeType: params.mimeType,
        size: params.buffer.length,
        url: "https://example.com/x",
      })
    );
  });

  it("creates a skill from a .md upload with no storage configured", async () => {
    const agent = await authAsUser(buildApp(false), "notAdmin");
    const res = await agent
      .post("/gpt/skills/upload")
      .attach("file", Buffer.from(SKILL_MD), {contentType: "text/markdown", filename: "SKILL.md"});
    expect(res.status).toBe(201);
    expect(res.body.data.name).toBe("poster-style");
    expect(res.body.data.description).toBe("Poster look");
    expect(res.body.data.instructions).toBe("# Steps");
    expect(res.body.data.scope).toBe("user");
    expect(res.body.data.files).toEqual([]);
    const saved = await GptSkill.findById(res.body.data._id);
    expect(String(saved?.userId)).toBe(userId.toString());
  });

  it("documents the created skill as the upload response in OpenAPI", async () => {
    const agent = await authAsUser(buildApp(false), "notAdmin");
    const res = await agent.get("/openapi.json");
    const responses = res.body.paths["/gpt/skills/upload"]?.post?.responses;
    const schema = (responses?.["201"] ?? responses?.["200"])?.content["application/json"].schema;
    const skill = schema.properties.data;
    expect(Object.keys(skill.properties).sort()).toEqual([
      "_id",
      "created",
      "description",
      "enabled",
      "files",
      "instructions",
      "name",
      "scope",
      "updated",
      "userId",
    ]);
    expect(skill.properties.scope.enum).toEqual(["user", "global"]);
  });

  it("stores zip files under skills/<skillId> with the uploader's userId", async () => {
    const agent = await authAsUser(buildApp(), "notAdmin");
    const res = await agent
      .post("/gpt/skills/upload")
      .attach("file", zipOf({"poster-style/ref.png": PNG, "poster-style/SKILL.md": SKILL_MD}), {
        contentType: "application/zip",
        filename: "poster-style.zip",
      });
    expect(res.status).toBe(201);
    expect(res.body.data.files).toEqual([
      {filename: "ref.png", mimeType: "image/png", size: PNG.length},
    ]);
    const calls = uploadCalls();
    expect(calls).toHaveLength(1);
    expect(calls[0].keyPrefix).toBe(`skills/${res.body.data._id}`);
    expect(String(calls[0].userId)).toBe(userId.toString());
    expect(calls[0].filename).toBe("ref.png");
    const saved = await GptSkill.findById(res.body.data._id);
    // The route stores the key the storage service returned.
    expect(saved?.files[0].gcsKey).toBe(`skills/${res.body.data._id}/${userId}/1-ref.png`);
  });

  it("returns 400 for a zip with files and no storage", async () => {
    const agent = await authAsUser(buildApp(false), "notAdmin");
    const res = await agent
      .post("/gpt/skills/upload")
      .attach("file", zipOf({"ref.png": PNG, "SKILL.md": SKILL_MD}), {
        contentType: "application/zip",
        filename: "s.zip",
      });
    expectAPIError(res, {status: 400, title: "File storage is not configured"});
    expect(await GptSkill.countDocuments({})).toBe(0);
  });

  it("returns 500, saves nothing and deletes the first key when a later upload fails", async () => {
    let calls = 0;
    upload.mockImplementation(async (params: UploadFileParams): Promise<UploadFileResult> => {
      calls += 1;
      if (calls === 2) {
        throw new Error("storage down");
      }
      return {
        filename: params.filename,
        gcsKey: `first-key/${params.filename}`,
        id: "6710c2a4f1c0de0000000001",
        mimeType: params.mimeType,
        size: params.buffer.length,
        url: "https://example.com/x",
      };
    });
    const agent = await authAsUser(buildApp(), "notAdmin");
    const res = await agent
      .post("/gpt/skills/upload")
      .attach("file", zipOf({"a.png": PNG, "b.png": PNG, "SKILL.md": SKILL_MD}), {
        contentType: "application/zip",
        filename: "s.zip",
      });
    expect(res.status).toBe(500);
    expect(await GptSkill.countDocuments({})).toBe(0);
    expect(remove).toHaveBeenCalledTimes(1);
    expect(remove.mock.calls[0][0]).toStartWith("first-key/");
  });

  it("leaves no object or skill when an attachment write fails after its object is stored", async () => {
    gcs.reset();
    await FileAttachment.deleteMany({});
    const realCreate = FileAttachment.create.bind(FileAttachment);
    let creates = 0;
    const create = spyOn(FileAttachment, "create").mockImplementation((async (
      ...args: Parameters<typeof FileAttachment.create>
    ) => {
      creates += 1;
      if (creates === 2) {
        throw new Error("attachment write failed");
      }
      return realCreate(...args);
    }) as never);
    try {
      const storage = new FileStorageService({bucketName: "test-bucket"});
      const agent = await authAsUser(buildApp(true, false, storage), "notAdmin");
      const res = await agent
        .post("/gpt/skills/upload")
        .attach("file", zipOf({"a.png": PNG, "b.png": PNG, "SKILL.md": SKILL_MD}), {
          contentType: "application/zip",
          filename: "s.zip",
        });
      expect(res.status).toBe(500);
    } finally {
      create.mockRestore();
    }
    expect(gcs.fileMocks.save).toHaveBeenCalledTimes(2);
    expect(gcs.listObjects()).toEqual([]);
    expect(await GptSkill.countDocuments({})).toBe(0);
  });

  it("forbids a non-admin uploading with scope=global", async () => {
    const agent = await authAsUser(buildApp(), "notAdmin");
    const res = await agent
      .post("/gpt/skills/upload")
      .field("scope", "global")
      .attach("file", Buffer.from(SKILL_MD), {contentType: "text/markdown", filename: "SKILL.md"});
    expect(res.status).toBe(403);
    expect(await GptSkill.countDocuments({})).toBe(0);
  });

  it("lets an admin upload a global skill", async () => {
    const agent = await authAsUser(buildApp(), "admin");
    const res = await agent
      .post("/gpt/skills/upload")
      .field("scope", "global")
      .attach("file", Buffer.from(SKILL_MD), {contentType: "text/markdown", filename: "SKILL.md"});
    expect(res.status).toBe(201);
    expect(res.body.data.scope).toBe("global");
  });

  it("returns 413 for an upload over 10 MB", async () => {
    const agent = await authAsUser(buildApp(), "notAdmin");
    const res = await agent
      .post("/gpt/skills/upload")
      .attach("file", Buffer.alloc(10 * 1024 * 1024 + 1, 97), {
        contentType: "application/zip",
        filename: "big.zip",
      });
    expect(res.status).toBe(413);
  });

  it("returns 400 for an unsupported file type in the zip", async () => {
    const agent = await authAsUser(buildApp(), "notAdmin");
    const res = await agent
      .post("/gpt/skills/upload")
      .attach("file", zipOf({"SKILL.md": SKILL_MD, "x.exe": new Uint8Array([1])}), {
        contentType: "application/zip",
        filename: "s.zip",
      });
    expectAPIError(res, {status: 400, title: "Unsupported file type: x.exe"});
    expect(upload).not.toHaveBeenCalled();
  });

  it("returns 400 when no file is attached", async () => {
    const agent = await authAsUser(buildApp(), "notAdmin");
    const res = await agent.post("/gpt/skills/upload");
    expectAPIError(res, {status: 400, title: "No file provided"});
  });

  it("returns 400 for a file that is neither .md nor .zip", async () => {
    const agent = await authAsUser(buildApp(), "notAdmin");
    const res = await agent
      .post("/gpt/skills/upload")
      .attach("file", Buffer.from(SKILL_MD), {contentType: "text/plain", filename: "skill.txt"});
    expectAPIError(res, {status: 400, title: "Upload a SKILL.md file or a .zip skill package"});
    expect(await GptSkill.countDocuments({})).toBe(0);
  });

  it("deletes stored keys when the save fails after the uploads succeed", async () => {
    upload.mockImplementation(async (params: UploadFileParams): Promise<UploadFileResult> => {
      // A same-named skill appears after validation, so the final save hits the name rule.
      await GptSkill.create({
        description: "Raced in",
        instructions: "x",
        name: "poster-style",
        scope: "user",
        userId,
      });
      return {
        filename: params.filename,
        gcsKey: "stored-key/ref.png",
        id: "6710c2a4f1c0de0000000001",
        mimeType: params.mimeType,
        size: params.buffer.length,
        url: "https://example.com/x",
      };
    });
    const agent = await authAsUser(buildApp(), "notAdmin");
    const res = await agent
      .post("/gpt/skills/upload")
      .attach("file", zipOf({"ref.png": PNG, "SKILL.md": SKILL_MD}), {
        contentType: "application/zip",
        filename: "s.zip",
      });
    expect(res.status).toBe(409);
    expect(remove.mock.calls.map((c) => c[0])).toEqual(["stored-key/ref.png"]);
    expect(await GptSkill.countDocuments({description: "Poster look"})).toBe(0);
  });

  it("rejects an unauthenticated upload with 401", async () => {
    const supertest = (await import("supertest")).default;
    const res = await supertest(buildApp())
      .post("/gpt/skills/upload")
      .attach("file", Buffer.from(SKILL_MD), {contentType: "text/markdown", filename: "SKILL.md"});
    expect(res.status).toBe(401);
  });

  it("records one create event for GptSkill when AuditApp is registered", async () => {
    await mongoose.connection.collection("auditevents").deleteMany({});
    const agent = await authAsUser(buildApp(false, true), "notAdmin");
    const res = await agent
      .post("/gpt/skills/upload")
      .attach("file", Buffer.from(SKILL_MD), {contentType: "text/markdown", filename: "SKILL.md"});
    expect(res.status).toBe(201);
    await flushAuditRecorderForTests();
    const events = await mongoose.connection
      .collection("auditevents")
      .find({modelName: "GptSkill"})
      .toArray();
    expect(events).toHaveLength(1);
    expect(events[0].verb).toBe("created");
    expect(events[0].recordId).toBe(res.body.data._id);
  });
});
