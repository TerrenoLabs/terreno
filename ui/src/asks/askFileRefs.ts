import type {AskFileRef} from "@terreno/blocks";

import type {SelectedFile} from "../FilePickerButton";

/**
 * Turns the files a user picked for a `files` ask into the refs its answer sends. Hosts with file
 * storage upload each file and return `{fileId}` refs; others encode `{url}` data URLs. Throw to
 * keep the ask open: the card shows that the files could not be sent.
 */
export type AskFilesResolver = (files: SelectedFile[]) => Promise<AskFileRef[]>;

/** The MIME type without parameters, lowercased: "Text/CSV; charset=utf-8" becomes "text/csv". */
export const normalizeMimeType = (mimeType: string): string =>
  (mimeType.split(";")[0] ?? "").trim().toLowerCase();

/**
 * Types pickers report when they do not know the file's type. Windows browsers report a CSV as
 * `application/vnd.ms-excel` when Excel is installed.
 */
const GENERIC_MIME_TYPES: readonly string[] = [
  "",
  "application/octet-stream",
  "application/vnd.ms-excel",
];

/** The type of each extension a `files` ask can accept. */
const MIME_TYPE_BY_EXTENSION: Record<string, string> = {
  csv: "text/csv",
  gif: "image/gif",
  jpeg: "image/jpeg",
  jpg: "image/jpeg",
  json: "application/json",
  pdf: "application/pdf",
  png: "image/png",
  txt: "text/plain",
  webp: "image/webp",
};

/**
 * A picked file's MIME type, normalized. When the picker reports no type or a generic one, the
 * type of the file's extension, if a `files` ask can accept that extension.
 */
export const selectedFileMimeType = (file: {mimeType: string; name: string}): string => {
  const reported = normalizeMimeType(file.mimeType);
  if (!GENERIC_MIME_TYPES.includes(reported)) {
    return reported;
  }
  const extension = file.name.includes(".") ? file.name.split(".").pop()?.toLowerCase() : "";
  return MIME_TYPE_BY_EXTENSION[extension ?? ""] ?? reported;
};

const readViaFileReader = (blob: Blob): Promise<string> =>
  new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = (): void => {
      const result = String(reader.result ?? "");
      resolve(result.slice(result.indexOf(",") + 1));
    };
    reader.onerror = (): void => reject(reader.error ?? new Error("The file could not be read."));
    reader.readAsDataURL(blob);
  });

const readViaArrayBuffer = async (blob: Blob): Promise<string> => {
  const bytes = new Uint8Array(await blob.arrayBuffer());
  let binary = "";
  for (const byte of bytes) {
    binary += String.fromCharCode(byte);
  }
  return btoa(binary);
};

const base64Of = async (uri: string): Promise<string> => {
  const response = await fetch(uri);
  const blob = await response.blob();
  return typeof FileReader === "undefined" ? readViaArrayBuffer(blob) : readViaFileReader(blob);
};

const decodedLength = (base64: string): number =>
  Math.floor((base64.length * 3) / 4) - (base64.endsWith("==") ? 2 : base64.endsWith("=") ? 1 : 0);

/**
 * Reads a picked file into a `{url}` ref: a base64 data URL whose media type is the file's
 * `selectedFileMimeType`, with the size of its bytes.
 */
export const selectedFileToDataUrlRef = async (file: SelectedFile): Promise<AskFileRef> => {
  const mimeType = selectedFileMimeType(file);
  const base64 = await base64Of(file.uri);
  return {
    filename: file.name,
    mimeType,
    size: decodedLength(base64),
    url: `data:${mimeType};base64,${base64}`,
  };
};

/** The default `AskFilesResolver`: every file as a data URL, for hosts without file storage. */
export const resolveAskFilesAsDataUrls: AskFilesResolver = (files) =>
  Promise.all(files.map(selectedFileToDataUrlRef));
