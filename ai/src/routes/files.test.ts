import {beforeAll, beforeEach, describe, expect, it, mock} from "bun:test";
import {TerrenoApp} from "@terreno/api";
import type express from "express";
import type mongoose from "mongoose";
import supertest from "supertest";

import {FileAttachment} from "../models/fileAttachment";
import type {FileStorageService, UploadFileParams, UploadFileResult} from "../service/fileStorage";
import {authAsUser, ensureTestUsers, UserModel} from "../tests/helpers";
import {addFileRoutes} from "./files";

type MockFileStorageService = Pick<FileStorageService, "upload" | "delete" | "getSignedUrl">;

describe("File Routes", () => {
  let app: express.Application;
  let fileStorageService: MockFileStorageService;
  let adminId: mongoose.Types.ObjectId;
  let userId: mongoose.Types.ObjectId;

  beforeAll(async () => {
    await ensureTestUsers();
    const admin = await UserModel.findOne({email: "admin@example.com"});
    const user = await UserModel.findOne({email: "notAdmin@example.com"});
    adminId = admin!._id as mongoose.Types.ObjectId;
    userId = user!._id as mongoose.Types.ObjectId;
  });

  beforeEach(async () => {
    await FileAttachment.deleteMany({});
    fileStorageService = {
      delete: mock(async () => {}),
      getSignedUrl: mock(async () => "https://example.com/signed"),
      upload: mock(
        async (params: UploadFileParams): Promise<UploadFileResult> => ({
          filename: params.filename,
          gcsKey: `uploads/${params.userId.toString()}/${params.filename}`,
          id: "6710c2a4f1c0de0000000001",
          mimeType: params.mimeType,
          size: params.buffer.length,
          url: `https://example.com/${params.filename}`,
        })
      ),
    };
    app = new TerrenoApp({
      configureApp: (router, options) => {
        addFileRoutes(router, {
          fileStorageService: fileStorageService as FileStorageService,
          openApiOptions: options,
        });
      },
      skipListen: true,
      userModel: UserModel,
    }).build();
  });

  describe("POST /files/upload", () => {
    it("uploads a file", async () => {
      const agent = await authAsUser(app, "notAdmin");
      const res = await agent
        .post("/files/upload")
        .attach("file", Buffer.from("hello"), {contentType: "text/plain", filename: "hi.txt"});
      expect(res.status).toBe(200);
      expect(res.body.data.filename).toBe("hi.txt");
      expect(fileStorageService.upload as ReturnType<typeof mock>).toHaveBeenCalledTimes(1);
    });

    it("rejects when no file is provided", async () => {
      const agent = await authAsUser(app, "notAdmin");
      const res = await agent.post("/files/upload");
      expect(res.status).toBe(400);
    });

    it("rejects unsupported mime types", async () => {
      const agent = await authAsUser(app, "notAdmin");
      const res = await agent.post("/files/upload").attach("file", Buffer.from("<html></html>"), {
        contentType: "application/x-sh",
        filename: "danger.sh",
      });
      expect(res.status).toBe(500);
    });
  });

  describe("GET /files/*gcsKey", () => {
    const createUserFile = (): Promise<unknown> =>
      FileAttachment.create({
        filename: "hi.txt",
        gcsKey: `uploads/${userId.toString()}/1727550000000-hi.txt`,
        mimeType: "text/plain",
        size: 5,
        url: "https://example.com/hi.txt",
        userId,
      });
    const userFilePath = (): string => `/files/uploads/${userId.toString()}/1727550000000-hi.txt`;

    it("returns 404 when the file is missing", async () => {
      const agent = await authAsUser(app, "notAdmin");
      const res = await agent.get("/files/missing/key.txt");
      expect(res.status).toBe(404);
    });

    it("returns the signed URL when the requester owns the file", async () => {
      await createUserFile();
      const agent = await authAsUser(app, "notAdmin");
      const res = await agent.get(userFilePath());
      expect(res.status).toBe(200);
      expect(res.body.data.url).toBe("https://example.com/signed");
      expect(fileStorageService.getSignedUrl as ReturnType<typeof mock>).toHaveBeenCalledTimes(1);
    });

    it("requires authentication and signs no URL without it", async () => {
      await createUserFile();
      const res = await supertest(app).get(userFilePath());
      expect(res.status).toBe(401);
      expect(fileStorageService.getSignedUrl as ReturnType<typeof mock>).not.toHaveBeenCalled();
    });

    it("returns 404, as for a missing file, when another user owns the file", async () => {
      await FileAttachment.create({
        filename: "theirs.txt",
        gcsKey: `uploads/${adminId.toString()}/1727550000000-theirs.txt`,
        mimeType: "text/plain",
        size: 6,
        url: "https://example.com/theirs.txt",
        userId: adminId,
      });
      const agent = await authAsUser(app, "notAdmin");
      const res = await agent.get(`/files/uploads/${adminId.toString()}/1727550000000-theirs.txt`);
      expect(res.status).toBe(404);
      expect(res.body.title).toBe("File not found");
      expect(fileStorageService.getSignedUrl as ReturnType<typeof mock>).not.toHaveBeenCalled();
    });

    it("returns 404 to an admin who does not own the file, as DELETE refuses them", async () => {
      await createUserFile();
      const agent = await authAsUser(app, "admin");
      const res = await agent.get(userFilePath());
      expect(res.status).toBe(404);
      expect(fileStorageService.getSignedUrl as ReturnType<typeof mock>).not.toHaveBeenCalled();
    });
  });

  describe("DELETE /files/*gcsKey", () => {
    it("returns 404 when the file is missing", async () => {
      const agent = await authAsUser(app, "notAdmin");
      const res = await agent.delete("/files/uploads/missing/key.txt");
      expect(res.status).toBe(404);
    });

    it("requires authentication", async () => {
      const res = await supertest(app).delete("/files/any/thing.txt");
      expect(res.status).toBe(401);
    });

    it("deletes the file when the requester owns it", async () => {
      const attachment = await FileAttachment.create({
        filename: "mine.txt",
        gcsKey: "mine-single.txt",
        mimeType: "text/plain",
        size: 4,
        url: "https://example.com/mine.txt",
        userId,
      });
      const agent = await authAsUser(app, "notAdmin");
      const res = await agent.delete(`/files/${attachment.gcsKey}`);
      expect(res.status).toBe(200);
      expect(res.body.data.success).toBe(true);
      expect(fileStorageService.delete as ReturnType<typeof mock>).toHaveBeenCalledTimes(1);
    });

    it("deletes a file by the nested key an upload gets", async () => {
      const gcsKey = `uploads/${userId.toString()}/1727550000000-mine.txt`;
      await FileAttachment.create({
        filename: "mine.txt",
        gcsKey,
        mimeType: "text/plain",
        size: 4,
        url: "https://example.com/mine.txt",
        userId,
      });
      const agent = await authAsUser(app, "notAdmin");
      const res = await agent.delete(`/files/${gcsKey}`);
      expect(res.status).toBe(200);
      expect(fileStorageService.delete as ReturnType<typeof mock>).toHaveBeenCalledWith(gcsKey);
    });

    it("returns 403 when the requester does not own the file", async () => {
      const attachment = await FileAttachment.create({
        filename: "theirs.txt",
        gcsKey: "theirs-single.txt",
        mimeType: "text/plain",
        size: 6,
        url: "https://example.com/theirs.txt",
        userId: adminId,
      });
      const agent = await authAsUser(app, "notAdmin");
      const res = await agent.delete(`/files/${attachment.gcsKey}`);
      expect(res.status).toBe(403);
      expect(fileStorageService.delete as ReturnType<typeof mock>).not.toHaveBeenCalled();
    });
  });
});
