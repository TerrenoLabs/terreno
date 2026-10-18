import {
  type AskErrorDraft,
  type AskValidationError,
  finalizeAskErrors,
  formatAskPath,
} from "./errors";

/** What a `files` ask may accept, and the MIME types each value allows. */
export const ASK_FILE_ACCEPT_MIME_TYPES = {
  csv: ["text/csv"],
  image: ["image/jpeg", "image/png", "image/gif", "image/webp"],
  json: ["application/json"],
  pdf: ["application/pdf"],
  text: ["text/plain"],
} as const;

/** The values of a `files` ask's `accept` list, in the order the docs and prompt list them. */
export const ASK_FILE_ACCEPT = ["image", "pdf", "text", "csv", "json"] as const;

export type AskFileAccept = (typeof ASK_FILE_ACCEPT)[number];

export type AskFileMimeType = (typeof ASK_FILE_ACCEPT_MIME_TYPES)[AskFileAccept][number];

/** The MIME types an `accept` list allows, each listed once, in `accept` order. */
export const acceptedFileMimeTypes = (accept: readonly AskFileAccept[]): AskFileMimeType[] => [
  ...new Set(accept.flatMap((value) => ASK_FILE_ACCEPT_MIME_TYPES[value])),
];

const TEXT_MIME_TYPES: readonly string[] = ["text/plain", "text/csv", "application/json"];

/** Whether a file of this type reaches the model as text rather than as bytes. */
export const isTextFileMimeType = (mimeType: string): boolean => TEXT_MIME_TYPES.includes(mimeType);

const BASE64_PATTERN = /^[A-Za-z0-9+/]*={0,2}$/;

/**
 * Splits a base64 `data:` URL into its media type (lowercase, without parameters) and payload.
 * Returns undefined for anything else, including URL-encoded data URLs and remote URLs.
 */
export const parseAskDataUrl = (url: string): {base64: string; mediaType: string} | undefined => {
  if (!url.startsWith("data:")) {
    return undefined;
  }
  const comma = url.indexOf(",");
  if (comma === -1) {
    return undefined;
  }
  const params = url.slice("data:".length, comma).split(";");
  if (params.length < 2 || params.at(-1)?.toLowerCase() !== "base64") {
    return undefined;
  }
  const mediaType = params[0].trim().toLowerCase();
  const base64 = url.slice(comma + 1);
  if (mediaType === "" || base64.length % 4 !== 0 || !BASE64_PATTERN.test(base64)) {
    return undefined;
  }
  return {base64, mediaType};
};

/** The number of bytes a base64 payload decodes to. */
export const base64ByteLength = (base64: string): number => {
  const padding = base64.endsWith("==") ? 2 : base64.endsWith("=") ? 1 : 0;
  return (base64.length / 4) * 3 - padding;
};

const startsWith = (bytes: Uint8Array, signature: readonly number[], offset = 0): boolean =>
  bytes.length >= offset + signature.length &&
  signature.every((byte, index) => bytes[offset + index] === byte);

const ascii = (text: string): number[] => [...text].map((character) => character.charCodeAt(0));

/** What the bytes of a file are: one of the accepted binary types, UTF-8 text, or unknown. */
export type SniffedFileType =
  | "application/pdf"
  | "image/gif"
  | "image/jpeg"
  | "image/png"
  | "image/webp"
  | "text"
  | "unknown";

const decodeUtf8 = (bytes: Uint8Array): string | undefined => {
  try {
    return new TextDecoder("utf-8", {fatal: true}).decode(bytes);
  } catch {
    return undefined;
  }
};

/**
 * Reads a file's type from its first bytes. Images and PDFs are matched by their signatures;
 * anything else that is valid UTF-8 with no NUL character is text.
 */
export const sniffFileBytes = (bytes: Uint8Array): SniffedFileType => {
  if (startsWith(bytes, [0xff, 0xd8, 0xff])) {
    return "image/jpeg";
  }
  if (startsWith(bytes, [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])) {
    return "image/png";
  }
  if (startsWith(bytes, ascii("GIF87a")) || startsWith(bytes, ascii("GIF89a"))) {
    return "image/gif";
  }
  if (startsWith(bytes, ascii("RIFF")) && startsWith(bytes, ascii("WEBP"), 8)) {
    return "image/webp";
  }
  if (startsWith(bytes, ascii("%PDF-"))) {
    return "application/pdf";
  }
  const text = decodeUtf8(bytes);
  if (text === undefined || text.includes("\u0000")) {
    return "unknown";
  }
  return "text";
};

const isJson = (bytes: Uint8Array): boolean => {
  try {
    JSON.parse(decodeUtf8(bytes) ?? "");
    return true;
  } catch {
    return false;
  }
};

const bytesMatchType = (bytes: Uint8Array, mimeType: string): boolean => {
  const sniffed = sniffFileBytes(bytes);
  if (!isTextFileMimeType(mimeType)) {
    return sniffed === mimeType;
  }
  if (sniffed !== "text") {
    return false;
  }
  return mimeType !== "application/json" || isJson(bytes);
};

const describeSniffed = (bytes: Uint8Array): string => {
  const sniffed = sniffFileBytes(bytes);
  if (sniffed === "text") {
    return "text";
  }
  if (sniffed === "unknown") {
    return "no accepted type";
  }
  return sniffed;
};

const oneDecimal = (value: number): number => Math.round(value * 10) / 10;

/** "512 bytes", "4.5 KB", or "10 MB". */
const formatBytes = (bytes: number): string => {
  if (bytes < 1024) {
    return bytes === 1 ? "1 byte" : `${bytes} bytes`;
  }
  if (bytes < 1024 * 1024) {
    return `${oneDecimal(bytes / 1024)} KB`;
  }
  return `${oneDecimal(bytes / 1024 / 1024)} MB`;
};

export const fileTooLargeDraft = ({
  maxFileSizeBytes,
  segments,
  size,
}: {
  maxFileSizeBytes: number;
  segments: readonly PropertyKey[];
  size: number;
}): AskErrorDraft => ({
  code: "FILE_TOO_LARGE",
  fix: `Send a file of ${formatBytes(maxFileSizeBytes)} or less.`,
  message: `The file is ${formatBytes(size)}, but the limit is ${formatBytes(maxFileSizeBytes)}.`,
  segments,
});

/**
 * Checks the bytes of the file at `content.files[index]` on the server: they must fit the per-file
 * cap and match the declared MIME type (a JSON file must also parse).
 */
export const checkAskFileBytes = ({
  bytes,
  index,
  maxFileSizeBytes,
  mimeType,
}: {
  bytes: Uint8Array;
  index: number;
  maxFileSizeBytes: number;
  mimeType: string;
}): AskValidationError[] => {
  const segments = ["content", "files", index];
  if (bytes.length > maxFileSizeBytes) {
    return finalizeAskErrors([
      fileTooLargeDraft({maxFileSizeBytes, segments: [...segments, "size"], size: bytes.length}),
    ]);
  }
  if (bytesMatchType(bytes, mimeType)) {
    return [];
  }
  return finalizeAskErrors([
    {
      code: "MIME_MISMATCH",
      fix: `Send the file with its real type, or a file that is ${mimeType}.`,
      message: `The file is declared as ${mimeType}, but its bytes are ${describeSniffed(bytes)}.`,
      segments: [...segments, "mimeType"],
    },
  ]);
};

/** The error for a `fileId` that the caller did not upload, or that the host cannot load. */
export const fileNotOwnedError = ({index}: {index: number}): AskValidationError => ({
  code: "FILE_NOT_OWNED",
  fix: "Upload the file with POST /files/upload and send the id it returns, or send a data: URL.",
  message: "The file id does not name one of your uploads.",
  path: formatAskPath(["content", "files", index, "fileId"]),
});
