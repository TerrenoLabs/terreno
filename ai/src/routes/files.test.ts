import {beforeAll, beforeEach, describe, expect, it, mock} from "bun:test";
import {TerrenoApp} from "@terreno/api";
import {expectDocumentedResponse, type OpenApiResponseSpec} from "@terreno/api/testing";
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

    it("rejects uploads when file uploads are disabled", async () => {
      const gated = new TerrenoApp({
        configureApp: (router, options) => {
          addFileRoutes(router, {
            fileStorageService: fileStorageService as FileStorageService,
            fileUploadsEnabled: async () => false,
            openApiOptions: options,
          });
        },
        skipListen: true,
        userModel: UserModel,
      }).build();
      const agent = await authAsUser(gated, "notAdmin");
      const res = await agent
        .post("/files/upload")
        .attach("file", Buffer.from("hello"), {contentType: "text/plain", filename: "hi.txt"});
      expect(res.status).toBe(403);
      expect(res.body.title).toBe("File uploads are disabled");
      expect(fileStorageService.upload as ReturnType<typeof mock>).not.toHaveBeenCalled();
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
  describe("OpenAPI", () => {
    it("documents POST /files/upload as multipart/form-data with the data envelope", async () => {
      const res = await supertest(app).get("/openapi.json").expect(200);
      const operation = res.body.paths["/files/upload"]?.post;
      expect(operation?.tags).toEqual(["files"]);
      expect(Object.keys(operation.requestBody.content)).toEqual(["multipart/form-data"]);
      const requestSchema = operation.requestBody.content["multipart/form-data"].schema;
      expect(requestSchema.required).toEqual(["file"]);
      expect(requestSchema.properties.file.format).toBe("binary");
      expect(requestSchema.properties.file.type).toBe("string");
      const responseSchema = operation.responses["200"].content["application/json"].schema;
      expect(responseSchema.required).toEqual(["data"]);
      expect(responseSchema.properties.data.required).toEqual([
        "filename",
        "gcsKey",
        "id",
        "mimeType",
        "size",
        "url",
      ]);

      // The generator keeps Express 5's `*gcsKey` wildcard as written, so find the key route.
      const keyPath = Object.keys(res.body.paths).find(
        (path) => path.startsWith("/files/") && path !== "/files/upload"
      );
      const keyRoute = res.body.paths[keyPath ?? ""];
      interface SchemaNode {
        properties: Record<string, SchemaNode & {type?: string}>;
      }
      const dataOf = (operation: {
        responses: Record<string, {content: Record<string, {schema: SchemaNode}>}>;
      }): SchemaNode =>
        operation.responses["200"].content["application/json"].schema.properties.data;
      expect(dataOf(keyRoute.get).properties.url.type).toBe("string");
      expect(dataOf(keyRoute.delete).properties.success.type).toBe("boolean");
    });

    it("documents every field the upload returns", async () => {
      const docs = await supertest(app).get("/openapi.json").expect(200);
      const documented = Object.keys(
        docs.body.paths["/files/upload"].post.responses["200"].content["application/json"].schema
          .properties.data.properties
      );
      const agent = await authAsUser(app, "notAdmin");
      const res = await agent
        .post("/files/upload")
        .attach("file", Buffer.from("hello"), {contentType: "text/plain", filename: "hi.txt"})
        .expect(200);
      expect(documented).toEqual(expect.arrayContaining(Object.keys(res.body.data)));
    });

    it("returns upload, read, and delete bodies that match the documented schemas", async () => {
      const spec = (await supertest(app).get("/openapi.json").expect(200))
        .body as OpenApiResponseSpec;
      const keyPath = Object.keys(spec.paths ?? {}).find(
        (path) => path.startsWith("/files/") && path !== "/files/upload"
      );
      expect(keyPath).toBeDefined();
      const agent = await authAsUser(app, "notAdmin");

      const uploaded = await agent
        .post("/files/upload")
        .attach("file", Buffer.from("hello"), {contentType: "text/plain", filename: "hi.txt"})
        .expect(200);
      expectDocumentedResponse({method: "post", path: "/files/upload", response: uploaded, spec});

      const gcsKey = `uploads/${userId.toString()}/1727550000000-documented.txt`;
      await FileAttachment.create({
        filename: "documented.txt",
        gcsKey,
        mimeType: "text/plain",
        size: 5,
        url: "https://example.com/documented.txt",
        userId,
      });

      const read = await agent.get(`/files/${gcsKey}`).expect(200);
      expectDocumentedResponse({method: "get", path: keyPath ?? "", response: read, spec});

      const deleted = await agent.delete(`/files/${gcsKey}`).expect(200);
      expectDocumentedResponse({method: "delete", path: keyPath ?? "", response: deleted, spec});
    });
  });

  describe("runtime-resolved storage", () => {
    it("answers 503 while storage is unconfigured and uploads once it resolves", async () => {
      let current: FileStorageService | undefined;
      const runtimeApp = new TerrenoApp({
        configureApp: (router, options) => {
          addFileRoutes(router, {
            fileStorageService: () => current,
            gcsBucket: "",
            openApiOptions: options,
          });
        },
        skipListen: true,
        userModel: UserModel,
      }).build();
      const agent = await authAsUser(runtimeApp, "notAdmin");

      const docs = await supertest(runtimeApp).get("/openapi.json").expect(200);
      expect(docs.body.paths["/files/upload"]?.post).toBeDefined();

      const unconfigured = await agent
        .post("/files/upload")
        .attach("file", Buffer.from("hello"), {contentType: "text/plain", filename: "hi.txt"});
      expect(unconfigured.status).toBe(503);
      expect(unconfigured.body.title).toBe("File storage is not configured");
      expect(fileStorageService.upload as ReturnType<typeof mock>).not.toHaveBeenCalled();

      current = fileStorageService as FileStorageService;
      const configured = await agent
        .post("/files/upload")
        .attach("file", Buffer.from("hello"), {contentType: "text/plain", filename: "hi.txt"});
      expect(configured.status).toBe(200);
      expect(fileStorageService.upload as ReturnType<typeof mock>).toHaveBeenCalledTimes(1);
    });
  });
});
