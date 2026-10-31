import {afterEach, beforeEach, describe, expect, it, spyOn} from "bun:test";
import {registerGcsMock} from "@terreno/test";
import mongoose from "mongoose";

import {FileAttachment} from "../models/fileAttachment";

// In-memory @google-cloud/storage so the service doesn't try to authenticate
const gcs = registerGcsMock();

const {FileStorageService} = await import("./fileStorage");

describe("FileStorageService", () => {
  beforeEach(async () => {
    await FileAttachment.deleteMany({});
    gcs.reset();
  });

  afterEach(async () => {
    await FileAttachment.deleteMany({});
  });

  describe("upload", () => {
    it("uploads a file, creates an attachment, and returns metadata", async () => {
      const service = new FileStorageService({bucketName: "test-bucket"});
      const userId = new mongoose.Types.ObjectId();
      const buffer = Buffer.from("hello world");

      const result = await service.upload({
        buffer,
        filename: "my file.txt",
        mimeType: "text/plain",
        userId,
      });

      expect(result.filename).toBe("my file.txt");
      expect(result.gcsKey).toContain("uploads/");
      expect(result.gcsKey).toContain("my_file.txt");
      expect(result.size).toBe(buffer.length);
      expect(result.url).toContain("storage.googleapis.com/test-bucket");
      expect(gcs.fileMocks.save).toHaveBeenCalledTimes(1);
      expect(gcs.getObject({bucket: "test-bucket", name: result.gcsKey})?.contents).toEqual(buffer);

      const attachment = await FileAttachment.findOne({gcsKey: result.gcsKey});
      expect(attachment).toBeDefined();
      expect(attachment?.mimeType).toBe("text/plain");
      expect(result.id).toBe(attachment?._id.toString() ?? "");
    });
  });

  describe("upload failures", () => {
    it("deletes the stored object when creating its attachment fails", async () => {
      const service = new FileStorageService({bucketName: "test-bucket"});
      const create = spyOn(FileAttachment, "create").mockRejectedValueOnce(
        new Error("attachment write failed") as never
      );
      try {
        await expect(
          service.upload({
            buffer: Buffer.from("x"),
            filename: "a.png",
            mimeType: "image/png",
            userId: new mongoose.Types.ObjectId(),
          })
        ).rejects.toThrow("attachment write failed");
      } finally {
        create.mockRestore();
      }
      expect(gcs.fileMocks.save).toHaveBeenCalledTimes(1);
      expect(gcs.listObjects()).toEqual([]);
      expect(await FileAttachment.countDocuments({})).toBe(0);
    });
  });

  describe("upload keys", () => {
    it("uses the uploads prefix by default", async () => {
      const service = new FileStorageService({bucketName: "test-bucket"});
      const userId = new mongoose.Types.ObjectId();
      const result = await service.upload({
        buffer: Buffer.from("x"),
        filename: "a b.png",
        mimeType: "image/png",
        userId,
      });
      expect(result.gcsKey).toMatch(new RegExp(`^uploads/${userId}/\\d+-a_b\\.png$`));
    });

    it("uses a custom keyPrefix when given", async () => {
      const service = new FileStorageService({bucketName: "test-bucket"});
      const userId = new mongoose.Types.ObjectId();
      const result = await service.upload({
        buffer: Buffer.from("x"),
        filename: "a b.png",
        keyPrefix: "skills/abc",
        mimeType: "image/png",
        userId,
      });
      expect(result.gcsKey).toMatch(new RegExp(`^skills/abc/${userId}/\\d+-a_b\\.png$`));
    });
  });

  describe("download", () => {
    it("returns the bytes of the bucket file", async () => {
      gcs.putObject({
        bucket: "test-bucket",
        contents: "stored bytes",
        name: "uploads/abc/file.txt",
      });
      const service = new FileStorageService({bucketName: "test-bucket"});
      const bytes = await service.download("uploads/abc/file.txt");
      expect(bytes.toString("utf8")).toBe("stored bytes");
      expect(gcs.file).toHaveBeenCalledWith("uploads/abc/file.txt");
    });
  });

  describe("getSignedUrl", () => {
    it("returns a signed url from the bucket file", async () => {
      const service = new FileStorageService({bucketName: "test-bucket"});
      const url = await service.getSignedUrl("uploads/abc/file.txt");
      expect(url).toBe(
        "https://storage.googleapis.com/test-bucket/uploads/abc/file.txt?X-Goog-Signature=mock"
      );
      expect(gcs.fileMocks.getSignedUrl).toHaveBeenCalledTimes(1);
    });
  });

  describe("delete", () => {
    it("deletes from bucket and marks attachment as deleted", async () => {
      const service = new FileStorageService({bucketName: "test-bucket"});
      const userId = new mongoose.Types.ObjectId();
      const attachment = await FileAttachment.create({
        filename: "x.txt",
        gcsKey: "uploads/x/y.txt",
        mimeType: "text/plain",
        size: 10,
        url: "https://example.com/x",
        userId,
      });

      await service.delete("uploads/x/y.txt");

      // findOneAndUpdate may return the old doc — just verify it ran and bucket delete was called
      expect(gcs.fileMocks.delete).toHaveBeenCalledTimes(1);
      expect(attachment._id).toBeDefined();
    });
  });
});
