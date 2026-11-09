import {Storage, type StorageOptions} from "@google-cloud/storage";
import {DateTime} from "luxon";

import {FileAttachment} from "../models/fileAttachment";

export interface UploadFileParams {
  buffer: Buffer;
  filename: string;
  mimeType: string;
  userId: import("mongoose").Types.ObjectId;
}

export interface UploadFileResult {
  filename: string;
  gcsKey: string;
  /** The `FileAttachment` id, sent as `fileId` in an answer to a `files` ask. */
  id: string;
  mimeType: string;
  size: number;
  url: string;
}

export class FileStorageService {
  private storage: Storage;
  private bucketName: string;

  constructor({bucketName, storageOptions}: {bucketName: string; storageOptions?: StorageOptions}) {
    this.storage = new Storage(storageOptions);
    this.bucketName = bucketName;
  }

  private get bucket() {
    return this.storage.bucket(this.bucketName);
  }

  async upload({buffer, filename, mimeType, userId}: UploadFileParams): Promise<UploadFileResult> {
    const timestamp = DateTime.now().toMillis();
    const sanitizedFilename = filename.replace(/[^a-zA-Z0-9._-]/g, "_");
    const gcsKey = `uploads/${userId.toString()}/${timestamp}-${sanitizedFilename}`;

    const file = this.bucket.file(gcsKey);
    await file.save(buffer, {
      contentType: mimeType,
      metadata: {userId: userId.toString()},
    });

    const url = `https://storage.googleapis.com/${this.bucketName}/${gcsKey}`;

    const attachment = await FileAttachment.create({
      filename,
      gcsKey,
      mimeType,
      size: buffer.length,
      url,
      userId,
    });

    return {filename, gcsKey, id: attachment._id.toString(), mimeType, size: buffer.length, url};
  }

  /** The bytes of an upload, so a `files` ask answer can reach the model. */
  async download(gcsKey: string): Promise<Buffer> {
    const [contents] = await this.bucket.file(gcsKey).download();
    return contents;
  }

  async getSignedUrl(gcsKey: string): Promise<string> {
    const file = this.bucket.file(gcsKey);
    const [url] = await file.getSignedUrl({
      action: "read",
      expires: DateTime.now().plus({hours: 1}).toMillis(),
      version: "v4",
    });
    return url;
  }

  async delete(gcsKey: string): Promise<void> {
    const file = this.bucket.file(gcsKey);
    await file.delete({ignoreNotFound: true});

    await FileAttachment.findOneAndUpdate({gcsKey}, {deleted: true});
  }
}
