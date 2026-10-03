import {APIError, logger} from "@terreno/api";
import {
  ASK_LIMITS,
  type AskFileRef,
  type AskResponse,
  type AskValidationError,
  checkAskFileBytes,
  fileNotOwnedError,
  isTextFileMimeType,
  parseAskDataUrl,
} from "@terreno/blocks";
import type {JSONValue, ToolResultPart} from "ai";
import type mongoose from "mongoose";

import {FileAttachment} from "../models/fileAttachment";
import type {AskFileDownloader} from "../types";
import {askFileHeading, truncatedAskFileNote, unloadedAskUploadsNote} from "./prompts";

type ToolResultOutput = ToolResultPart["output"];

type ContentOutput = Extract<ToolResultOutput, {type: "content"}>;

type ContentPart = ContentOutput["value"][number];

/** A file of a `files` answer with its bytes loaded and checked. */
export interface ResolvedAskFile {
  bytes: Uint8Array;
  fileId?: string;
  filename: string;
  mimeType: string;
}

/** A file as the conversation stores it: metadata only, with the size of its bytes. */
interface StoredAskFile {
  fileId?: string;
  filename: string;
  mimeType: string;
  size: number;
}

const OBJECT_ID_PATTERN = /^[0-9a-f]{24}$/i;

/** The 400 the answer path returns when an answer does not fit its ask. */
export const invalidAskResponseError = (fields: AskValidationError[]): APIError =>
  new APIError({
    detail: "The answer does not match the ask. See fields.",
    meta: {fields},
    status: 400,
    title: "Invalid askResponse",
  });

const decodeDataUrl = (url: string): Uint8Array | undefined => {
  const parsed = parseAskDataUrl(url);
  return parsed ? new Uint8Array(Buffer.from(parsed.base64, "base64")) : undefined;
};

/** The bytes of the caller's own upload, or undefined when it is not theirs or cannot be loaded. */
const loadUpload = async ({
  fileId,
  fileStorageService,
  userId,
}: {
  fileId: string;
  fileStorageService: AskFileDownloader | undefined;
  userId: mongoose.Types.ObjectId | undefined;
}): Promise<Uint8Array | undefined> => {
  if (!fileStorageService || !userId || !OBJECT_ID_PATTERN.test(fileId)) {
    return undefined;
  }
  const attachment = await FileAttachment.findOneOrNone({_id: fileId, deleted: false, userId});
  if (!attachment) {
    return undefined;
  }
  try {
    return new Uint8Array(await fileStorageService.download(attachment.gcsKey));
  } catch (error) {
    logger.warn("Could not download an upload sent as an ask answer", {
      error: error instanceof Error ? error.message : String(error),
      fileId,
    });
    return undefined;
  }
};

/**
 * Loads the bytes of every file in an accepted `files` answer: a data URL is decoded, and a
 * `fileId` must name an upload of the caller. Each file's bytes must fit the cap and match its
 * declared type. Throws a 400 with every file's errors in `meta.fields`.
 */
export const resolveAskFiles = async ({
  files,
  fileStorageService,
  maxFileSizeBytes,
  userId,
}: {
  files: AskFileRef[];
  fileStorageService: AskFileDownloader | undefined;
  maxFileSizeBytes: number;
  userId: mongoose.Types.ObjectId | undefined;
}): Promise<ResolvedAskFile[]> => {
  const loaded = await Promise.all(
    files.map(async (file, index) => {
      const bytes =
        file.url !== undefined
          ? decodeDataUrl(file.url)
          : await loadUpload({fileId: file.fileId ?? "", fileStorageService, userId});
      if (!bytes) {
        return {errors: [fileNotOwnedError({index})]};
      }
      const resolved: ResolvedAskFile = {
        bytes,
        filename: file.filename,
        mimeType: file.mimeType,
        ...(file.fileId === undefined ? {} : {fileId: file.fileId}),
      };
      return {
        errors: checkAskFileBytes({bytes, index, maxFileSizeBytes, mimeType: file.mimeType}),
        resolved,
      };
    })
  );
  const errors = loaded.flatMap((result) => result.errors);
  if (errors.length > 0) {
    throw invalidAskResponseError(errors);
  }
  return loaded.flatMap((result) => (result.resolved ? [result.resolved] : []));
};

const storedFile = ({bytes, fileId, filename, mimeType}: ResolvedAskFile): StoredAskFile => ({
  ...(fileId === undefined ? {} : {fileId}),
  filename,
  mimeType,
  size: bytes.length,
});

/**
 * The answer the conversation stores, logs, and replays on later turns: each file's `fileId`,
 * filename, type, and real size, without the bytes of a data URL.
 */
export const storedFilesAnswer = (files: ResolvedAskFile[]): AskResponse => ({
  action: "accept",
  content: {files: files.map(storedFile)},
});

const decodeText = (bytes: Uint8Array): string => new TextDecoder("utf-8").decode(bytes);

/** The text parts of a text-like file: its text cut to 100 KB on a character boundary, and a note. */
const textParts = (bytes: Uint8Array): ContentPart[] => {
  const {textMaxBytes} = ASK_LIMITS.files;
  if (bytes.length <= textMaxBytes) {
    return [{text: decodeText(bytes), type: "text"}];
  }
  let end = textMaxBytes;
  while (end > 0 && (bytes[end] & 0xc0) === 0x80) {
    end -= 1;
  }
  return [
    {text: decodeText(bytes.subarray(0, end)), type: "text"},
    {text: truncatedAskFileNote({keptBytes: end, totalBytes: bytes.length}), type: "text"},
  ];
};

const fileParts = (file: ResolvedAskFile): ContentPart[] => {
  const data = Buffer.from(file.bytes).toString("base64");
  if (file.mimeType.startsWith("image/")) {
    return [{data, mediaType: file.mimeType, type: "image-data"}];
  }
  if (!isTextFileMimeType(file.mimeType)) {
    return [{data, filename: file.filename, mediaType: file.mimeType, type: "file-data"}];
  }
  return textParts(file.bytes);
};

/**
 * The tool result the model sees for an accepted `files` answer: the stored answer as JSON, then
 * each file after a line that names it. Images become `image-data` parts, PDFs `file-data` parts,
 * and text, CSV, and JSON files text parts of at most 100 KB.
 */
export const askFilesModelOutput = (files: ResolvedAskFile[]): ContentOutput => ({
  type: "content",
  value: [
    {text: JSON.stringify(storedFilesAnswer(files)), type: "text"},
    ...files.flatMap((file, index): ContentPart[] => [
      {
        text: askFileHeading({
          count: files.length,
          filename: file.filename,
          mimeType: file.mimeType,
          position: index + 1,
          size: file.bytes.length,
        }),
        type: "text",
      },
      ...fileParts(file),
    ]),
  ],
});

/**
 * `toModelOutput` for the `ask_files` tool, for hosts that replay its result themselves: an
 * accepted answer shows each data URL's file, and names uploads without loading them. Other
 * answers stay JSON. The chat routes load uploads first and call `askFilesModelOutput`.
 */
export const askFilesToolModelOutput = ({output}: {output: AskResponse}): ToolResultOutput => {
  if (output.action !== "accept") {
    return {type: "json", value: output as JSONValue};
  }
  const refs = (output.content as {files?: AskFileRef[]}).files ?? [];
  const inline = refs.flatMap((ref): ResolvedAskFile[] => {
    const bytes = ref.url === undefined ? undefined : decodeDataUrl(ref.url);
    return bytes ? [{bytes, filename: ref.filename, mimeType: ref.mimeType}] : [];
  });
  const uploads = refs.filter((ref) => ref.url === undefined);
  const {value} = askFilesModelOutput(inline);
  if (uploads.length === 0) {
    return {type: "content", value};
  }
  return {
    type: "content",
    value: [...value, {text: unloadedAskUploadsNote(uploads), type: "text"}],
  };
};
