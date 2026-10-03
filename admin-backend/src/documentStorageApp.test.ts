import {afterEach, beforeEach, describe, expect, it, mock} from "bun:test";
import {PassThrough} from "node:stream";

// Mock @google-cloud/storage BEFORE importing anything that depends on it.
interface MockedFile {
  save: ReturnType<typeof mock>;
  getMetadata: ReturnType<typeof mock>;
  createReadStream: ReturnType<typeof mock>;
  delete: ReturnType<typeof mock>;
  name: string;
  metadata: Record<string, unknown>;
}

interface BucketBehavior {
  getFiles?: ReturnType<typeof mock>;
  fileFactory?: (name: string) => MockedFile;
}

const bucketBehavior: BucketBehavior = {};

mock.module("@google-cloud/storage", () => {
  class Storage {
    bucket(name: string) {
      void name;
      return {
        file: (path: string) => {
          if (bucketBehavior.fileFactory) {
            return bucketBehavior.fileFactory(path);
          }
          return {
            createReadStream: mock(() => {
              const stream = new PassThrough();
              setImmediate(() => {
                stream.end("filecontent");
              });
              return stream;
            }),
            delete: mock(async () => [{}]),
            getMetadata: mock(async () => [
              {contentType: "application/pdf", etag: "etag", size: 11, updated: "now"},
            ]),
            metadata: {},
            name: path,
            save: mock(async () => undefined),
          };
        },
        getFiles: bucketBehavior.getFiles ?? mock(async () => [[], null, {prefixes: []}]),
      };
    }
  }
  return {Storage};
});

import {
  addAuthRoutes,
  apiErrorMiddleware,
  apiUnauthorizedMiddleware,
  setupAuth,
  type UserModel as UserModelType,
} from "@terreno/api";
import {authAsUser, getBaseServer, setupDb, UserModel} from "@terreno/api/testing";
import type express from "express";
import supertest from "supertest";
import type TestAgent from "supertest/lib/agent";

import type {DocumentStorageOptions} from "./documentStorageApp";
import {DocumentStorageApp} from "./documentStorageApp";

const buildApp = (options: DocumentStorageOptions): express.Application => {
  const app = getBaseServer();
  setupAuth(app, UserModel as unknown as UserModelType);
  addAuthRoutes(app, UserModel as unknown as UserModelType);

  new DocumentStorageApp(options).register(app);

  app.use(apiUnauthorizedMiddleware);
  app.use(apiErrorMiddleware);
  return app;
};

describe("DocumentStorageApp admin contribution", () => {
  it("contributes the documents custom screen", () => {
    const contribution = new DocumentStorageApp({bucketName: "test-bucket"}).adminContribution();

    expect(contribution).toEqual({
      customScreens: [{displayName: "Documents", icon: "folder", name: "documents"}],
    });
  });
});

describe("DocumentStorageApp", () => {
  let app: express.Application;
  let adminAgent: TestAgent;
  let notAdminAgent: TestAgent;

  beforeEach(async () => {
    await setupDb();
    bucketBehavior.getFiles = undefined;
    bucketBehavior.fileFactory = undefined;
    app = buildApp({bucketName: "test-bucket", folderPrefix: "tenant/"});
    adminAgent = await authAsUser(app, "admin");
    notAdminAgent = await authAsUser(app, "notAdmin");
  });

  afterEach(() => {
    bucketBehavior.getFiles = undefined;
    bucketBehavior.fileFactory = undefined;
  });

  describe("GET /documents/", () => {
    it("lists files and folders", async () => {
      bucketBehavior.getFiles = mock(async () => [
        [
          {
            metadata: {contentType: "application/pdf", size: "2048", updated: "2024-01-01"},
            name: "tenant/report.pdf",
          },
          {
            metadata: {contentType: "image/png", size: "500", updated: "2024-01-02"},
            name: "tenant/logo.png",
          },
          // Should be excluded because it equals fullPrefix
          {metadata: {size: "0", updated: ""}, name: "tenant/"},
        ],
        null,
        {prefixes: ["tenant/archive/", "tenant/photos/"]},
      ]);

      const res = await adminAgent.get("/documents/").expect(200);
      expect(res.body.files).toHaveLength(2);
      expect(res.body.files[0].name).toBe("report.pdf");
      expect(res.body.files[0].fullPath).toBe("report.pdf");
      expect(res.body.files[0].size).toBe(2048);
      expect(res.body.folders).toEqual(["archive/", "photos/"]);
      expect(res.body.prefix).toBe("");
    });

    it("supports a prefix query param", async () => {
      bucketBehavior.getFiles = mock(async (opts: {prefix: string}) => {
        expect(opts.prefix).toBe("tenant/archive/");
        return [[], null, {prefixes: []}];
      });
      const res = await adminAgent.get("/documents/?prefix=archive/").expect(200);
      expect(res.body.prefix).toBe("archive/");
    });

    it("returns empty folders array when no prefixes present", async () => {
      bucketBehavior.getFiles = mock(async () => [[], null, undefined]);
      const res = await adminAgent.get("/documents/").expect(200);
      expect(res.body.folders).toEqual([]);
      expect(res.body.files).toEqual([]);
    });

    it("returns 403 for non-admins", async () => {
      await notAdminAgent.get("/documents/").expect(403);
    });

    it("returns 401 when unauthenticated", async () => {
      await supertest(app).get("/documents/").expect(401);
    });
  });

  describe("POST /documents/ (upload)", () => {
    it("rejects when no file is provided", async () => {
      const res = await adminAgent.post("/documents/").expect(400);
      expect(res.body.title).toInclude("No file provided");
    });

    it("sanitizes filenames and uploads to the bucket", async () => {
      const saved: {path?: string; body?: Buffer} = {};
      bucketBehavior.fileFactory = (path: string) =>
        ({
          createReadStream: mock(() => new PassThrough()),
          delete: mock(async () => [{}]),
          getMetadata: mock(async () => [{}]),
          metadata: {},
          name: path,
          save: mock(async (body: Buffer) => {
            saved.path = path;
            saved.body = body;
          }),
        }) as unknown as MockedFile;

      const res = await adminAgent
        .post("/documents/")
        .attach("file", Buffer.from("hello"), {
          contentType: "application/pdf",
          filename: "my doc!.pdf",
        })
        .field("prefix", "archive/")
        .expect(200);

      expect(res.body.name).toBe("my_doc_.pdf");
      expect(res.body.fullPath).toBe("archive/my_doc_.pdf");
      expect(saved.path).toBe("tenant/archive/my_doc_.pdf");
      expect(saved.body?.toString()).toBe("hello");
    });

    it("rejects uploads when file uploads are disabled", async () => {
      app = buildApp({
        bucketName: "test-bucket",
        fileUploadsEnabled: async () => false,
        folderPrefix: "tenant/",
      });
      const agent = await authAsUser(app, "admin");
      const res = await agent
        .post("/documents/")
        .attach("file", Buffer.from("hello"), {
          contentType: "application/pdf",
          filename: "notes.pdf",
        })
        .expect(403);
      expect(res.body.title).toBe("File uploads are disabled");
    });

    it("rejects disallowed mime types via multer fileFilter", async () => {
      await adminAgent
        .post("/documents/")
        .attach("file", Buffer.from("exec"), {
          contentType: "application/x-sh",
          filename: "bad.sh",
        })
        .expect(400);
    });

    it("uses options.allowedMimeTypes when provided", async () => {
      app = buildApp({
        allowedMimeTypes: ["text/plain"],
        bucketName: "test-bucket",
      });
      const agent = await authAsUser(app, "admin");

      await agent
        .post("/documents/")
        .attach("file", Buffer.from("pdf"), {
          contentType: "application/pdf",
          filename: "x.pdf",
        })
        .expect(400);

      await agent
        .post("/documents/")
        .attach("file", Buffer.from("text"), {
          contentType: "text/plain",
          filename: "x.txt",
        })
        .expect(200);
    });

    it("returns 403 for non-admins", async () => {
      await notAdminAgent
        .post("/documents/")
        .attach("file", Buffer.from("x"), {contentType: "text/plain", filename: "x.txt"})
        .expect(403);
    });
  });

  describe("GET /documents/download/*filepath", () => {
    it("handles a successful download request by invoking pipeline", async () => {
      // Use Readable.from so pipeline() sees a well-behaved stream that emits
      // a single buffer and ends cleanly, giving a deterministic 200.
      bucketBehavior.fileFactory = (path: string) =>
        ({
          createReadStream: mock(() => {
            const stream = new PassThrough();
            setImmediate(() => {
              stream.end(Buffer.from("DOWNLOADED"));
            });
            return stream;
          }),
          delete: mock(async () => [{}]),
          getMetadata: mock(async () => [{contentType: "text/plain", size: 10, updated: "now"}]),
          metadata: {},
          name: path,
          save: mock(async () => undefined),
        }) as unknown as MockedFile;

      const res = await adminAgent.get("/documents/download/readme.txt").expect(200);
      expect(res.headers["content-type"]).toInclude("text/plain");
      expect(res.headers["content-disposition"]).toInclude("readme.txt");
      expect(res.headers["content-length"]).toBe("10");
      expect(res.text).toBe("DOWNLOADED");
    });

    it("defaults content-type to application/octet-stream when not provided", async () => {
      bucketBehavior.fileFactory = () =>
        ({
          createReadStream: mock(() => {
            const stream = new PassThrough();
            setImmediate(() => {
              stream.end(Buffer.from("blob"));
            });
            return stream;
          }),
          delete: mock(async () => [{}]),
          getMetadata: mock(async () => [{}]),
          metadata: {},
          name: "blob",
          save: mock(async () => undefined),
        }) as unknown as MockedFile;

      const res = await adminAgent.get("/documents/download/some.bin").expect(200);
      expect(res.headers["content-type"]).toInclude("application/octet-stream");
      // No Content-Length header when size is missing from metadata
      expect(res.headers["content-length"]).toBeUndefined();
    });

    it("returns 404 when metadata lookup fails with code 404", async () => {
      bucketBehavior.fileFactory = () =>
        ({
          createReadStream: mock(() => new PassThrough()),
          delete: mock(async () => [{}]),
          getMetadata: mock(async () => {
            const err: Error & {code?: number} = new Error("not found");
            err.code = 404;
            throw err;
          }),
          metadata: {},
          name: "x",
          save: mock(async () => undefined),
        }) as unknown as MockedFile;

      const res = await adminAgent.get("/documents/download/missing.pdf").expect(404);
      expect(res.body.title).toInclude("File not found");
    });

    it("returns 500 for other metadata errors", async () => {
      bucketBehavior.fileFactory = () =>
        ({
          createReadStream: mock(() => new PassThrough()),
          delete: mock(async () => [{}]),
          getMetadata: mock(async () => {
            const err: Error & {code?: number} = new Error("broken");
            err.code = 500;
            throw err;
          }),
          metadata: {},
          name: "x",
          save: mock(async () => undefined),
        }) as unknown as MockedFile;

      const res = await adminAgent.get("/documents/download/boom.pdf").expect(500);
      expect(res.body.title).toInclude("Failed to access file");
      expect(JSON.stringify(res.body)).not.toInclude("broken");
    });

    it("logs and swallows stream errors once headers have been flushed", async () => {
      // When bytes have already started streaming, res.headersSent is true by
      // the time pipeline() rejects and the route must NOT attempt to throw a
      // new APIError. We exercise that branch by writing a chunk before
      // destroying the source; the connection is forcibly closed mid-response
      // so supertest may surface ECONNRESET — both a completed status and a
      // socket error prove the pipeline-error catch ran without re-sending
      // headers.
      const createReadStreamMock = mock(() => {
        const stream = new PassThrough();
        setImmediate(() => {
          stream.write(Buffer.from("partial"));
          setImmediate(() => stream.destroy(new Error("pipe broken")));
        });
        return stream;
      });
      bucketBehavior.fileFactory = () =>
        ({
          createReadStream: createReadStreamMock,
          delete: mock(async () => [{}]),
          getMetadata: mock(async () => [{contentType: "text/plain", updated: "now"}]),
          metadata: {},
          name: "x",
          save: mock(async () => undefined),
        }) as unknown as MockedFile;

      let status: number | undefined;
      let caught: unknown;
      try {
        const res = await adminAgent.get("/documents/download/problem.txt");
        status = res.status;
      } catch (err: unknown) {
        caught = err;
      }

      // Either supertest sees a completed response (200/500) or the socket is
      // reset after partial data. Both outcomes prove we exercised the route
      // and its pipeline-error catch branch without crashing the process.
      if (caught) {
        expect(String(caught)).toMatch(/ECONNRESET|socket|aborted/i);
      } else {
        expect(status).toBeDefined();
        expect([200, 500]).toContain(status as number);
      }
      expect(createReadStreamMock).toHaveBeenCalled();
    });

    it("returns 403 for non-admins", async () => {
      await notAdminAgent.get("/documents/download/doc.pdf").expect(403);
    });
  });

  describe("POST /documents/folder", () => {
    it("rejects missing folder name", async () => {
      const res = await adminAgent.post("/documents/folder").send({}).expect(400);
      expect(res.body.title).toInclude("Folder name is required");
    });

    it("sanitizes folder names and writes a placeholder blob", async () => {
      const saved: {path?: string} = {};
      bucketBehavior.fileFactory = (path: string) =>
        ({
          createReadStream: mock(() => new PassThrough()),
          delete: mock(async () => [{}]),
          getMetadata: mock(async () => [{}]),
          metadata: {},
          name: path,
          save: mock(async () => {
            saved.path = path;
          }),
        }) as unknown as MockedFile;

      const res = await adminAgent
        .post("/documents/folder")
        .send({folderName: "My Folder!", prefix: "archive/"})
        .expect(200);
      expect(res.body.folder).toBe("archive/My_Folder_/");
      expect(saved.path).toBe("tenant/archive/My_Folder_/");
    });

    it("treats prefix as optional", async () => {
      const res = await adminAgent.post("/documents/folder").send({folderName: "Root"}).expect(200);
      expect(res.body.folder).toBe("Root/");
    });
  });

  describe("DELETE /documents/folder/*folderpath", () => {
    it("deletes all files under the given folder", async () => {
      const deleted: string[] = [];
      bucketBehavior.getFiles = mock(async () => [
        [
          {
            delete: mock(async () => {
              deleted.push("tenant/archive/a.pdf");
              return [{}];
            }),
            metadata: {},
            name: "tenant/archive/a.pdf",
          },
          {
            delete: mock(async () => {
              deleted.push("tenant/archive/b.pdf");
              return [{}];
            }),
            metadata: {},
            name: "tenant/archive/b.pdf",
          },
        ],
        null,
        {prefixes: []},
      ]);

      const res = await adminAgent.delete("/documents/folder/archive").expect(200);
      expect(res.body.success).toBe(true);
      expect(deleted.sort()).toEqual(["tenant/archive/a.pdf", "tenant/archive/b.pdf"]);
    });
  });

  describe("DELETE /documents/*filepath", () => {
    it("deletes a single file", async () => {
      let deletedPath: string | undefined;
      bucketBehavior.fileFactory = (path: string) =>
        ({
          createReadStream: mock(() => new PassThrough()),
          delete: mock(async () => {
            deletedPath = path;
            return [{}];
          }),
          getMetadata: mock(async () => [{}]),
          metadata: {},
          name: path,
          save: mock(async () => undefined),
        }) as unknown as MockedFile;

      const res = await adminAgent.delete("/documents/report.pdf").expect(200);
      expect(res.body.success).toBe(true);
      expect(deletedPath).toBe("tenant/report.pdf");
    });

    it("returns 403 for non-admins", async () => {
      await notAdminAgent.delete("/documents/x.pdf").expect(403);
    });
  });

  describe("access: authenticated", () => {
    const recordingFileFactory = (saved: string[]) => (path: string) =>
      ({
        createReadStream: mock(() => new PassThrough()),
        delete: mock(async () => {
          saved.push(`delete:${path}`);
          return [{}];
        }),
        getMetadata: mock(async () => [{}]),
        metadata: {},
        name: path,
        save: mock(async () => {
          saved.push(`save:${path}`);
        }),
      }) as unknown as MockedFile;

    it("confines non-admins to their own users/<id>/ folder", async () => {
      app = buildApp({access: "authenticated", bucketName: "b", folderPrefix: "tenant/"});
      const agent = await authAsUser(app, "notAdmin");
      const user = await UserModel.findOne({email: "notAdmin@example.com"});
      const userId = String(user?._id);
      const userPrefix = `tenant/users/${userId}/`;

      bucketBehavior.getFiles = mock(async (opts: {prefix: string}) => {
        expect(opts.prefix).toBe(`${userPrefix}sub/`);
        return [
          [{metadata: {size: 1}, name: `${userPrefix}sub/a.txt`}],
          null,
          {prefixes: [`${userPrefix}sub/inner/`]},
        ];
      });
      const list = await agent.get("/documents/").query({prefix: "sub/"}).expect(200);
      expect(list.body.files[0].fullPath).toBe("sub/a.txt");
      expect(list.body.folders).toEqual(["sub/inner/"]);

      const saved: string[] = [];
      bucketBehavior.fileFactory = recordingFileFactory(saved);
      await agent
        .post("/documents/")
        .attach("file", Buffer.from("x"), {contentType: "text/plain", filename: "x.txt"})
        .expect(200);
      await agent.delete("/documents/x.txt").expect(200);
      expect(saved).toEqual([`save:${userPrefix}x.txt`, `delete:${userPrefix}x.txt`]);
    });

    it("keeps whole-bucket access for admins", async () => {
      app = buildApp({access: "authenticated", bucketName: "b", folderPrefix: "tenant/"});
      const agent = await authAsUser(app, "admin");
      bucketBehavior.getFiles = mock(async (opts: {prefix: string}) => {
        expect(opts.prefix).toBe("tenant/");
        return [[], null, {prefixes: []}];
      });
      await agent.get("/documents/").expect(200);
    });

    it("still requires authentication", async () => {
      app = buildApp({access: "authenticated", bucketName: "b"});
      await supertest(app).get("/documents/").expect(401);
    });
  });

  describe("uploadRateLimit", () => {
    it("allows one upload per IP per window, then returns 429", async () => {
      app = buildApp({bucketName: "b", uploadRateLimit: {max: 1, windowMs: 60_000}});
      const agent = await authAsUser(app, "admin");
      const upload = () =>
        agent
          .post("/documents/")
          .attach("file", Buffer.from("x"), {contentType: "text/plain", filename: "x.txt"});

      await upload().expect(200);
      const limited = await upload().expect(429);
      expect(limited.headers["retry-after"]).toBeDefined();
      // Listing is not rate limited.
      await agent.get("/documents/").expect(200);
    });
  });

  describe("configuration edge cases", () => {
    it("throws a 503 when no bucketName is configured", async () => {
      const originalBucket = process.env.GCS_BUCKET;
      process.env.GCS_BUCKET = "";
      app = buildApp({bucketName: ""});
      const agent = await authAsUser(app, "admin");
      const res = await agent.get("/documents/").expect(503);
      expect(res.body.title).toInclude("Storage not configured");
      if (originalBucket !== undefined) {
        process.env.GCS_BUCKET = originalBucket;
      } else {
        delete process.env.GCS_BUCKET;
      }
    });

    it("falls back to GCS_BUCKET env var when bucketName is falsy", async () => {
      const originalBucket = process.env.GCS_BUCKET;
      process.env.GCS_BUCKET = "env-bucket";
      app = buildApp({bucketName: ""});
      const agent = await authAsUser(app, "admin");
      bucketBehavior.getFiles = mock(async () => [[], null, {prefixes: []}]);
      await agent.get("/documents/").expect(200);
      if (originalBucket !== undefined) {
        process.env.GCS_BUCKET = originalBucket;
      } else {
        delete process.env.GCS_BUCKET;
      }
    });

    it("defaults folderPrefix to empty string", async () => {
      app = buildApp({bucketName: "b"});
      const agent = await authAsUser(app, "admin");
      bucketBehavior.getFiles = mock(async (opts: {prefix: string}) => {
        expect(opts.prefix).toBe("");
        return [[], null, {prefixes: []}];
      });
      await agent.get("/documents/").expect(200);
    });

    it("defaults basePath to /documents when not provided", async () => {
      app = buildApp({bucketName: "b"});
      const agent = await authAsUser(app, "admin");
      bucketBehavior.getFiles = mock(async () => [[], null, {prefixes: []}]);
      await agent.get("/documents/").expect(200);
    });

    it("supports a custom basePath", async () => {
      app = buildApp({basePath: "/files", bucketName: "b"});
      const agent = await authAsUser(app, "admin");
      bucketBehavior.getFiles = mock(async () => [[], null, {prefixes: []}]);
      await agent.get("/files/").expect(200);
    });

    it("accepts a maxFileSize option without rejecting normal-sized files", async () => {
      app = buildApp({bucketName: "b", maxFileSize: 1024});
      const agent = await authAsUser(app, "admin");
      const saved: {path?: string} = {};
      bucketBehavior.fileFactory = (path: string) =>
        ({
          createReadStream: mock(() => new PassThrough()),
          delete: mock(async () => [{}]),
          getMetadata: mock(async () => [{}]),
          metadata: {},
          name: path,
          save: mock(async () => {
            saved.path = path;
          }),
        }) as unknown as MockedFile;

      const res = await agent.post("/documents/").attach("file", Buffer.from("small"), {
        contentType: "text/plain",
        filename: "small.txt",
      });
      expect(res.status).toBe(200);
      expect(saved.path).toBe("small.txt");
    });
  });
});
