import {type Mock, mock} from "bun:test";
import {Readable, Writable} from "node:stream";
import {DateTime} from "luxon";

import {createMockGroup} from "./mockGroup";

export type GcsObjectMetadata = Record<string, unknown>;

export interface GcsStoredObject {
  contents: Buffer;
  metadata: GcsObjectMetadata;
}

export interface GcsSaveOptions {
  contentType?: string;
  metadata?: GcsObjectMetadata;
  [key: string]: unknown;
}

export interface GcsGetFilesQuery {
  delimiter?: string;
  prefix?: string;
  [key: string]: unknown;
}

/** A file handle from `bucket.file(name)`. Its methods are the shared `fileMocks`. */
export interface GcsMockFile {
  bucket: GcsMockBucket;
  createReadStream: GcsFileMocks["createReadStream"];
  createWriteStream: GcsFileMocks["createWriteStream"];
  delete: GcsFileMocks["delete"];
  download: GcsFileMocks["download"];
  exists: GcsFileMocks["exists"];
  getMetadata: GcsFileMocks["getMetadata"];
  getSignedUrl: GcsFileMocks["getSignedUrl"];
  /** Current stored metadata, or `{}` when the object does not exist. */
  readonly metadata: GcsObjectMetadata;
  name: string;
  publicUrl: () => string;
  save: GcsFileMocks["save"];
  setMetadata: GcsFileMocks["setMetadata"];
}

export interface GcsMockBucket {
  deleteFiles: GcsMock["deleteFiles"];
  file: GcsMock["file"];
  getFiles: GcsMock["getFiles"];
  name: string;
}

/**
 * Shared across every file handle; each call runs with `this` bound to the file. Assert with
 * `fileMocks.save.mock.contexts[0].name` or `gcs.file.mock.calls` when the path matters.
 */
export interface GcsFileMocks {
  createReadStream: Mock<(this: GcsMockFile) => Readable>;
  createWriteStream: Mock<(this: GcsMockFile, options?: GcsSaveOptions) => Writable>;
  delete: Mock<(this: GcsMockFile, options?: {ignoreNotFound?: boolean}) => Promise<[unknown]>>;
  download: Mock<(this: GcsMockFile) => Promise<[Buffer]>>;
  exists: Mock<(this: GcsMockFile) => Promise<[boolean]>>;
  getMetadata: Mock<(this: GcsMockFile) => Promise<[GcsObjectMetadata]>>;
  getSignedUrl: Mock<(this: GcsMockFile, config?: Record<string, unknown>) => Promise<[string]>>;
  save: Mock<
    (this: GcsMockFile, data: string | Uint8Array, options?: GcsSaveOptions) => Promise<void>
  >;
  setMetadata: Mock<
    (this: GcsMockFile, metadata: GcsObjectMetadata) => Promise<[GcsObjectMetadata]>
  >;
}

export interface GcsMock {
  /** `new Storage(options)` — every instance is the shared `storage`. */
  Storage: Mock<(options?: Record<string, unknown>) => {bucket: GcsMock["bucket"]}>;
  storage: {bucket: GcsMock["bucket"]};
  /** `storage.bucket(name)`. */
  bucket: Mock<(name: string) => GcsMockBucket>;
  /** `bucket.file(name)` — `this` is the bucket. */
  file: Mock<(this: GcsMockBucket, name: string) => GcsMockFile>;
  /** `bucket.getFiles(query)` — resolves `[files, null, {prefixes}]` like the real API. */
  getFiles: Mock<
    (
      this: GcsMockBucket,
      query?: GcsGetFilesQuery
    ) => Promise<[GcsMockFile[], null, {prefixes: string[]}]>
  >;
  /** `bucket.deleteFiles({prefix})`. */
  deleteFiles: Mock<(this: GcsMockBucket, query?: {prefix?: string}) => Promise<void>>;
  fileMocks: GcsFileMocks;
  /** Reads an object from the in-memory store. */
  getObject: (params: {bucket: string; name: string}) => GcsStoredObject | undefined;
  /** Every stored object key as `bucket/name`, sorted. */
  listObjects: () => string[];
  /** Seeds an object without going through the mocks (no calls are recorded). */
  putObject: (params: {
    bucket: string;
    contentType?: string;
    contents: string | Uint8Array;
    name: string;
  }) => void;
  /** Clears calls, overrides, and the in-memory store. */
  reset: () => void;
}

const objectKey = (bucket: string, name: string): string => `${bucket}/${name}`;

const notFoundError = (bucket: string, name: string): Error & {code: number} =>
  Object.assign(new Error(`No such object: ${bucket}/${name}`), {code: 404});

const toBuffer = (data: string | Uint8Array): Buffer =>
  typeof data === "string" ? Buffer.from(data) : Buffer.from(data);

/**
 * Registers `mock.module("@google-cloud/storage", ...)` backed by an in-memory object store, so
 * uploads can be downloaded, listed, streamed, and deleted again. Missing objects reject with a
 * `code: 404` error the way GCS does. `@google-cloud/storage` does not need to be installed.
 */
export const registerGcsMock = (): GcsMock => {
  const group = createMockGroup();
  const objects = new Map<string, GcsStoredObject>();

  const store = ({
    bucket,
    contents,
    name,
    options,
  }: {
    bucket: string;
    contents: Buffer;
    name: string;
    options?: GcsSaveOptions;
  }): void => {
    const contentType = options?.contentType ?? options?.metadata?.contentType;
    objects.set(objectKey(bucket, name), {
      contents,
      metadata: {
        ...(options?.metadata ?? {}),
        bucket,
        contentType,
        name,
        size: String(contents.length),
        updated: DateTime.utc().toISO(),
      },
    });
  };

  const requireObject = (file: GcsMockFile): GcsStoredObject => {
    const stored = objects.get(objectKey(file.bucket.name, file.name));
    if (!stored) {
      throw notFoundError(file.bucket.name, file.name);
    }
    return stored;
  };

  const fileMocks: GcsFileMocks = {
    createReadStream: group.fn(function (this: GcsMockFile): Readable {
      const stored = objects.get(objectKey(this.bucket.name, this.name));
      if (!stored) {
        const error = notFoundError(this.bucket.name, this.name);
        return new Readable({
          read(): void {
            this.destroy(error);
          },
        });
      }
      return Readable.from([stored.contents]);
    }),
    createWriteStream: group.fn(function (this: GcsMockFile, options?: GcsSaveOptions): Writable {
      const chunks: Buffer[] = [];
      return new Writable({
        final: (callback): void => {
          store({
            bucket: this.bucket.name,
            contents: Buffer.concat(chunks),
            name: this.name,
            options,
          });
          callback();
        },
        write: (chunkData: Buffer | string, _encoding, callback): void => {
          chunks.push(toBuffer(chunkData));
          callback();
        },
      });
    }),
    delete: group.fn(async function (
      this: GcsMockFile,
      options?: {ignoreNotFound?: boolean}
    ): Promise<[unknown]> {
      const deleted = objects.delete(objectKey(this.bucket.name, this.name));
      if (!deleted && !options?.ignoreNotFound) {
        throw notFoundError(this.bucket.name, this.name);
      }
      return [{}];
    }),
    download: group.fn(async function (this: GcsMockFile): Promise<[Buffer]> {
      return [Buffer.from(requireObject(this).contents)];
    }),
    exists: group.fn(async function (this: GcsMockFile): Promise<[boolean]> {
      return [objects.has(objectKey(this.bucket.name, this.name))];
    }),
    getMetadata: group.fn(async function (this: GcsMockFile): Promise<[GcsObjectMetadata]> {
      return [{...requireObject(this).metadata}];
    }),
    getSignedUrl: group.fn(async function (
      this: GcsMockFile,
      _config?: Record<string, unknown>
    ): Promise<[string]> {
      return [
        `https://storage.googleapis.com/${this.bucket.name}/${encodeURI(this.name)}?X-Goog-Signature=mock`,
      ];
    }),
    save: group.fn(async function (
      this: GcsMockFile,
      data: string | Uint8Array,
      options?: GcsSaveOptions
    ): Promise<void> {
      store({bucket: this.bucket.name, contents: toBuffer(data), name: this.name, options});
    }),
    setMetadata: group.fn(async function (
      this: GcsMockFile,
      metadata: GcsObjectMetadata
    ): Promise<[GcsObjectMetadata]> {
      const stored = requireObject(this);
      stored.metadata = {...stored.metadata, ...metadata};
      return [{...stored.metadata}];
    }),
  };

  const createFile = (bucket: GcsMockBucket, name: string): GcsMockFile => ({
    bucket,
    ...fileMocks,
    get metadata(): GcsObjectMetadata {
      return objects.get(objectKey(bucket.name, name))?.metadata ?? {};
    },
    name,
    publicUrl: (): string => `https://storage.googleapis.com/${bucket.name}/${encodeURI(name)}`,
  });

  const namesInBucket = (bucketName: string, prefix: string): string[] =>
    [...objects.keys()]
      .filter((key) => key.startsWith(`${bucketName}/${prefix}`))
      .map((key) => key.slice(bucketName.length + 1))
      .sort();

  const file = group.fn(function (this: GcsMockBucket, name: string): GcsMockFile {
    return createFile(this, name);
  });

  const getFiles = group.fn(async function (
    this: GcsMockBucket,
    query?: GcsGetFilesQuery
  ): Promise<[GcsMockFile[], null, {prefixes: string[]}]> {
    const prefix = query?.prefix ?? "";
    const delimiter = query?.delimiter;
    const files: GcsMockFile[] = [];
    const prefixes = new Set<string>();
    for (const name of namesInBucket(this.name, prefix)) {
      const rest = name.slice(prefix.length);
      const delimiterIndex = delimiter ? rest.indexOf(delimiter) : -1;
      if (delimiter && delimiterIndex >= 0) {
        prefixes.add(`${prefix}${rest.slice(0, delimiterIndex + delimiter.length)}`);
        continue;
      }
      files.push(createFile(this, name));
    }
    return [files, null, {prefixes: [...prefixes]}];
  });

  const deleteFiles = group.fn(async function (
    this: GcsMockBucket,
    query?: {prefix?: string}
  ): Promise<void> {
    for (const name of namesInBucket(this.name, query?.prefix ?? "")) {
      objects.delete(objectKey(this.name, name));
    }
  });

  const bucket = group.fn((name: string): GcsMockBucket => ({deleteFiles, file, getFiles, name}));
  const storage = {bucket};
  const Storage = group.fn((_options?: Record<string, unknown>) => storage);

  const reset = (): void => {
    group.reset();
    objects.clear();
  };

  mock.module("@google-cloud/storage", () => ({default: {Storage}, Storage}));

  return {
    bucket,
    deleteFiles,
    file,
    fileMocks,
    getFiles,
    getObject: ({bucket: bucketName, name}): GcsStoredObject | undefined =>
      objects.get(objectKey(bucketName, name)),
    listObjects: (): string[] => [...objects.keys()].sort(),
    putObject: ({bucket: bucketName, contentType, contents, name}): void => {
      store({bucket: bucketName, contents: toBuffer(contents), name, options: {contentType}});
    },
    reset,
    Storage,
    storage,
  };
};
