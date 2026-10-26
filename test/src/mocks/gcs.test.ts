import {beforeEach, describe, expect, it} from "bun:test";
import {Readable, type Writable} from "node:stream";
import {pipeline} from "node:stream/promises";

import {type GcsMockFile, registerGcsMock} from "./gcs";

const gcs = registerGcsMock();

interface StorageModule {
  Storage: new (
    options?: Record<string, unknown>
  ) => {
    bucket: (name: string) => {
      deleteFiles: (query?: {prefix?: string}) => Promise<void>;
      file: (name: string) => GcsMockFile;
      getFiles: (query?: {
        delimiter?: string;
        prefix?: string;
      }) => Promise<[GcsMockFile[], null, {prefixes: string[]}]>;
    };
  };
  default: {Storage: unknown};
}

const loadStorage = async (): Promise<StorageModule> =>
  (await import("@google-cloud/storage")) as unknown as StorageModule;

const readAll = async (stream: Readable): Promise<string> => {
  const chunks: Buffer[] = [];
  for await (const chunk of stream) {
    chunks.push(Buffer.from(chunk));
  }
  return Buffer.concat(chunks).toString("utf8");
};

describe("registerGcsMock", () => {
  beforeEach((): void => {
    gcs.reset();
  });

  it("saves, downloads, reads metadata, signs, and deletes objects", async (): Promise<void> => {
    const {Storage, default: defaultExport} = await loadStorage();
    expect(defaultExport.Storage).toBe(gcs.Storage);
    const bucket = new Storage({projectId: "p"}).bucket("uploads");
    const file = bucket.file("docs/a b.txt");

    await file.save("hello", {contentType: "text/plain", metadata: {custom: "yes"}});

    expect(gcs.Storage).toHaveBeenCalledWith({projectId: "p"});
    expect(gcs.bucket).toHaveBeenCalledWith("uploads");
    expect(gcs.file).toHaveBeenCalledWith("docs/a b.txt");
    expect(gcs.fileMocks.save).toHaveBeenCalledTimes(1);
    expect((gcs.fileMocks.save.mock.contexts[0] as unknown as GcsMockFile).name).toBe(
      "docs/a b.txt"
    );
    expect(gcs.listObjects()).toEqual(["uploads/docs/a b.txt"]);
    expect(gcs.getObject({bucket: "uploads", name: "docs/a b.txt"})?.contents.toString()).toBe(
      "hello"
    );

    const [contents] = await file.download();
    expect(contents.toString()).toBe("hello");
    const [metadata] = await file.getMetadata();
    expect(metadata).toMatchObject({
      bucket: "uploads",
      contentType: "text/plain",
      custom: "yes",
      name: "docs/a b.txt",
      size: "5",
    });
    expect(typeof metadata.updated).toBe("string");
    expect(file.metadata.size).toBe("5");
    expect((await file.exists())[0]).toBe(true);
    expect((await file.setMetadata({contentType: "text/markdown"}))[0].contentType).toBe(
      "text/markdown"
    );
    expect((await file.getSignedUrl({action: "read"}))[0]).toBe(
      "https://storage.googleapis.com/uploads/docs/a%20b.txt?X-Goog-Signature=mock"
    );
    expect(file.publicUrl()).toBe("https://storage.googleapis.com/uploads/docs/a%20b.txt");

    await file.delete();
    expect((await file.exists())[0]).toBe(false);
    expect(file.metadata).toEqual({});
  });

  it("rejects missing objects with a 404 code unless ignoreNotFound", async (): Promise<void> => {
    const {Storage} = await loadStorage();
    const file = new Storage().bucket("b").file("missing");

    await expect(file.download()).rejects.toMatchObject({code: 404});
    await expect(file.getMetadata()).rejects.toMatchObject({code: 404});
    await expect(file.setMetadata({a: 1})).rejects.toMatchObject({code: 404});
    await expect(file.delete()).rejects.toMatchObject({code: 404});
    await expect(file.delete({ignoreNotFound: true})).resolves.toEqual([{}]);
    await expect(readAll(file.createReadStream())).rejects.toMatchObject({code: 404});
  });

  it("streams writes and reads through the store", async (): Promise<void> => {
    const {Storage} = await loadStorage();
    const file = new Storage().bucket("b").file("stream.bin");

    await pipeline(
      Readable.from([Buffer.from("ab"), "cd"]),
      file.createWriteStream({metadata: {contentType: "application/octet-stream"}}) as Writable
    );

    expect(await readAll(file.createReadStream())).toBe("abcd");
    expect(file.metadata.contentType).toBe("application/octet-stream");
  });

  it("lists files and folder prefixes and deletes by prefix", async (): Promise<void> => {
    gcs.putObject({bucket: "b", contents: "1", contentType: "text/plain", name: "root.txt"});
    gcs.putObject({bucket: "b", contents: "2", name: "docs/one.txt"});
    gcs.putObject({bucket: "b", contents: new Uint8Array([51]), name: "docs/sub/two.txt"});
    gcs.putObject({bucket: "other", contents: "x", name: "docs/elsewhere.txt"});
    const {Storage} = await loadStorage();
    const bucket = new Storage().bucket("b");

    const [topFiles, nextQuery, topResponse] = await bucket.getFiles({delimiter: "/"});
    expect(topFiles.map((file) => file.name)).toEqual(["root.txt"]);
    expect(topFiles[0]?.metadata.contentType).toBe("text/plain");
    expect(nextQuery).toBeNull();
    expect(topResponse.prefixes).toEqual(["docs/"]);

    const [docsFiles, , docsResponse] = await bucket.getFiles({delimiter: "/", prefix: "docs/"});
    expect(docsFiles.map((file) => file.name)).toEqual(["docs/one.txt"]);
    expect(docsResponse.prefixes).toEqual(["docs/sub/"]);

    const [allFiles] = await bucket.getFiles();
    expect(allFiles.map((file) => file.name)).toEqual([
      "docs/one.txt",
      "docs/sub/two.txt",
      "root.txt",
    ]);

    await bucket.deleteFiles({prefix: "docs/"});
    expect(gcs.listObjects()).toEqual(["b/root.txt", "other/docs/elsewhere.txt"]);
    await bucket.deleteFiles();
    expect(gcs.listObjects()).toEqual(["other/docs/elsewhere.txt"]);
  });

  it("reset clears the store, calls, and overrides", async (): Promise<void> => {
    gcs.putObject({bucket: "b", contents: "x", name: "a"});
    gcs.getFiles.mockRejectedValueOnce(Object.assign(new Error("Not Found"), {code: 404}));
    const {Storage} = await loadStorage();
    await expect(new Storage().bucket("b").getFiles()).rejects.toThrow("Not Found");

    gcs.reset();

    expect(gcs.listObjects()).toEqual([]);
    expect(gcs.getFiles).toHaveBeenCalledTimes(0);
    const [files] = await new Storage().bucket("b").getFiles();
    expect(files).toEqual([]);
  });
});
