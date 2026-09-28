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
 * declared type, with the size of its bytes.
 */
export const selectedFileToDataUrlRef = async (file: SelectedFile): Promise<AskFileRef> => {
  const mimeType = normalizeMimeType(file.mimeType);
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
