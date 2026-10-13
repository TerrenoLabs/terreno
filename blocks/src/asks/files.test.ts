import {describe, expect, it} from "bun:test";
import {
  checkAskFileBytes,
  fileNotOwnedError,
  isTextFileMimeType,
  parseAskDataUrl,
  sniffFileBytes,
} from "./files";
import type {FilesAskInput} from "./schema";
import {validateAskResponse} from "./validateResponse";

const RECEIPT_INPUT: FilesAskInput = {
  accept: ["image", "pdf"],
  maxFiles: 3,
  prompt: "Upload a photo of the receipt.",
};

const MB = 1024 * 1024;

const bytesOf = (...values: (number | string)[]): Uint8Array =>
  new Uint8Array(
    values.flatMap((value) =>
      typeof value === "string" ? [...Buffer.from(value, "utf8")] : [value]
    )
  );

const PNG = bytesOf(0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 13, "IHDR");
const JPEG = bytesOf(0xff, 0xd8, 0xff, 0xe0, 0, 16, "JFIF");
const GIF = bytesOf("GIF89a", 1, 0, 1, 0);
const WEBP = bytesOf("RIFF", 36, 0, 0, 0, "WEBPVP8 ");
const PDF = bytesOf("%PDF-1.7\n%âãÏÓ\n");

const dataUrl = (mimeType: string, bytes: Uint8Array): string =>
  `data:${mimeType};base64,${Buffer.from(bytes).toString("base64")}`;

const check = (files: unknown[], input: FilesAskInput = RECEIPT_INPUT, maxFileSizeBytes?: number) =>
  validateAskResponse({
    input,
    kind: "files",
    maxFileSizeBytes,
    response: {action: "accept", content: {files}},
  }).map(({code, path}) => ({code, path}));

const uploaded = {
  fileId: "6710c2a4f1",
  filename: "receipt.jpg",
  mimeType: "image/jpeg",
  size: 482113,
};

describe("validateAskResponse for files", () => {
  it("accepts uploaded files and data URLs within the count, types, and cap", () => {
    expect(check([uploaded])).toEqual([]);
    expect(
      check([
        uploaded,
        {
          filename: "scan.pdf",
          mimeType: "application/pdf",
          size: PDF.length,
          url: dataUrl("application/pdf", PDF),
        },
      ])
    ).toEqual([]);
  });

  it("accepts decline by default and rejects it when allowDecline is false", () => {
    expect(
      validateAskResponse({input: RECEIPT_INPUT, kind: "files", response: {action: "decline"}})
    ).toEqual([]);
    expect(
      validateAskResponse({
        input: {...RECEIPT_INPUT, allowDecline: false},
        kind: "files",
        response: {action: "decline"},
      }).map((error) => error.code)
    ).toEqual(["DECLINE_NOT_ALLOWED"]);
  });

  it("FILE_COUNT for fewer than minFiles or more than maxFiles", () => {
    expect(check([])).toEqual([{code: "FILE_COUNT", path: "content.files"}]);
    expect(check([uploaded, uploaded, uploaded, uploaded])).toEqual([
      {code: "FILE_COUNT", path: "content.files"},
    ]);
    expect(
      validateAskResponse({
        input: {...RECEIPT_INPUT, maxFiles: 2, minFiles: 2},
        kind: "files",
        response: {action: "accept", content: {files: [uploaded]}},
      })
    ).toEqual([
      {
        code: "FILE_COUNT",
        fix: "Send exactly 2 files in content.files.",
        message: "This ask takes exactly 2 files; the answer has 1.",
        path: "content.files",
      },
    ]);
  });

  it("FILE_TYPE_NOT_ACCEPTED for a declared type the accept list does not allow", () => {
    expect(
      validateAskResponse({
        input: RECEIPT_INPUT,
        kind: "files",
        response: {
          action: "accept",
          content: {files: [{...uploaded, filename: "notes.txt", mimeType: "text/plain"}]},
        },
      })
    ).toEqual([
      {
        code: "FILE_TYPE_NOT_ACCEPTED",
        fix: "Send a file of type image/jpeg, image/png, image/gif, image/webp, application/pdf.",
        message: '"notes.txt" is text/plain, which this ask does not accept.',
        path: "content.files[0].mimeType",
      },
    ]);
  });

  it("FILE_TOO_LARGE above the 10 MB default or the host's cap", () => {
    expect(check([{...uploaded, size: 10 * MB}])).toEqual([]);
    expect(
      validateAskResponse({
        input: RECEIPT_INPUT,
        kind: "files",
        response: {action: "accept", content: {files: [{...uploaded, size: 10.5 * MB}]}},
      })
    ).toEqual([
      {
        code: "FILE_TOO_LARGE",
        fix: "Send a file of 10 MB or less.",
        message: "The file is 10.5 MB, but the limit is 10 MB.",
        path: "content.files[0].size",
      },
    ]);
    expect(check([{...uploaded, size: 10 * MB + 1}])).toEqual([
      {code: "FILE_TOO_LARGE", path: "content.files[0].size"},
    ]);
    expect(check([{...uploaded, size: 2 * MB}], RECEIPT_INPUT, MB)).toEqual([
      {code: "FILE_TOO_LARGE", path: "content.files[0].size"},
    ]);
  });

  it("measures a data URL by its bytes, not its declared size", () => {
    const url = dataUrl("image/png", new Uint8Array(2048));
    expect(
      check([{filename: "a.png", mimeType: "image/png", size: 1, url}], RECEIPT_INPUT, 1024)
    ).toEqual([{code: "FILE_TOO_LARGE", path: "content.files[0].size"}]);
  });

  it("MIME_MISMATCH when the data URL's media type is not the declared type", () => {
    expect(
      check([
        {
          filename: "a.png",
          mimeType: "image/png",
          size: PNG.length,
          url: dataUrl("image/gif", PNG),
        },
      ])
    ).toEqual([{code: "MIME_MISMATCH", path: "content.files[0].url"}]);
  });

  it("needs exactly one of fileId and a base64 data URL", () => {
    const {fileId: _fileId, ...withoutId} = uploaded;
    expect(check([withoutId])).toEqual([{code: "MISSING_REQUIRED", path: "content.files[0]"}]);
    expect(check([{...uploaded, url: dataUrl("image/jpeg", JPEG)}])).toEqual([
      {code: "INVALID_FORMAT", path: "content.files[0].url"},
    ]);
    for (const url of [
      "https://example.com/a.jpg",
      "data:image/jpeg,raw",
      "data:image/jpeg;base64,@@@",
    ]) {
      expect(check([{...withoutId, url}])).toEqual([
        {code: "INVALID_FORMAT", path: "content.files[0].url"},
      ]);
    }
  });

  it("rejects unknown keys, blank filenames, and negative sizes", () => {
    expect(check([{...uploaded, filename: " ", path: "/tmp/a", size: -1}])).toEqual([
      {code: "TOO_SHORT", path: "content.files[0].filename"},
      {code: "UNKNOWN_KEY", path: "content.files[0].path"},
      {code: "RANGE_INVALID", path: "content.files[0].size"},
    ]);
  });
});

describe("parseAskDataUrl", () => {
  it("returns the lowercase media type without parameters, and the payload", () => {
    expect(parseAskDataUrl("data:Text/Plain;charset=utf-8;base64,aGk=")).toEqual({
      base64: "aGk=",
      mediaType: "text/plain",
    });
  });

  it("rejects remote URLs, URL-encoded data, and bad base64", () => {
    expect(parseAskDataUrl("https://example.com/a.png")).toBeUndefined();
    expect(parseAskDataUrl("data:text/plain,hi")).toBeUndefined();
    expect(parseAskDataUrl("data:;base64,aGk=")).toBeUndefined();
    expect(parseAskDataUrl("data:text/plain;base64,aGk")).toBeUndefined();
    expect(parseAskDataUrl("data:text/plain;base64")).toBeUndefined();
  });
});

describe("sniffFileBytes", () => {
  it("reads images and PDFs from their signatures", () => {
    expect(sniffFileBytes(PNG)).toBe("image/png");
    expect(sniffFileBytes(JPEG)).toBe("image/jpeg");
    expect(sniffFileBytes(GIF)).toBe("image/gif");
    expect(sniffFileBytes(bytesOf("GIF87a"))).toBe("image/gif");
    expect(sniffFileBytes(WEBP)).toBe("image/webp");
    expect(sniffFileBytes(PDF)).toBe("application/pdf");
  });

  it("reads UTF-8 without NUL as text, with or without a byte order mark", () => {
    expect(sniffFileBytes(bytesOf("date,amount\n2026-09-28,12.50\n"))).toBe("text");
    expect(sniffFileBytes(bytesOf(0xef, 0xbb, 0xbf, "Grüße ✓"))).toBe("text");
    expect(sniffFileBytes(new Uint8Array())).toBe("text");
  });

  it("reads anything else as unknown", () => {
    expect(sniffFileBytes(bytesOf(0xc3, 0x28))).toBe("unknown");
    expect(sniffFileBytes(bytesOf("a", 0, "b"))).toBe("unknown");
    expect(sniffFileBytes(bytesOf("RIFF", 0, 0, 0, 0, "WAVE"))).toBe("unknown");
  });
});

describe("checkAskFileBytes", () => {
  const checkBytes = (bytes: Uint8Array, mimeType: string, maxFileSizeBytes = MB) =>
    checkAskFileBytes({bytes, index: 1, maxFileSizeBytes, mimeType});

  it("accepts bytes that match the declared type", () => {
    expect(checkBytes(PNG, "image/png")).toEqual([]);
    expect(checkBytes(PDF, "application/pdf")).toEqual([]);
    expect(checkBytes(bytesOf("hello"), "text/plain")).toEqual([]);
    expect(checkBytes(bytesOf("a,b\n1,2"), "text/csv")).toEqual([]);
    expect(checkBytes(bytesOf('{"total": 12.5}'), "application/json")).toEqual([]);
  });

  it("MIME_MISMATCH when the bytes are another type", () => {
    expect(checkBytes(PNG, "image/jpeg")).toEqual([
      {
        code: "MIME_MISMATCH",
        fix: "Send the file with its real type, or a file that is image/jpeg.",
        message: "The file is declared as image/jpeg, but its bytes are image/png.",
        path: "content.files[1].mimeType",
      },
    ]);
    expect(checkBytes(bytesOf("not an image"), "image/png")[0]?.message).toBe(
      "The file is declared as image/png, but its bytes are text."
    );
    expect(checkBytes(PNG, "text/plain")[0]?.code).toBe("MIME_MISMATCH");
    expect(checkBytes(bytesOf(0xc3, 0x28), "text/csv")[0]?.message).toBe(
      "The file is declared as text/csv, but its bytes are no accepted type."
    );
  });

  it("MIME_MISMATCH when a JSON file does not parse", () => {
    expect(checkBytes(bytesOf("{total: 12}"), "application/json")[0]?.code).toBe("MIME_MISMATCH");
  });

  it("FILE_TOO_LARGE when the bytes are over the cap, whatever size was declared", () => {
    expect(checkBytes(new Uint8Array(2048), "text/plain", 1024)).toEqual([
      {
        code: "FILE_TOO_LARGE",
        fix: "Send a file of 1 KB or less.",
        message: "The file is 2 KB, but the limit is 1 KB.",
        path: "content.files[1].size",
      },
    ]);
  });
});

describe("fileNotOwnedError", () => {
  it("points at the fileId of the file", () => {
    expect(fileNotOwnedError({index: 2})).toEqual({
      code: "FILE_NOT_OWNED",
      fix: "Upload the file with POST /files/upload and send the id it returns, or send a data: URL.",
      message: "The file id does not name one of your uploads.",
      path: "content.files[2].fileId",
    });
  });
});

describe("isTextFileMimeType", () => {
  it("is true for the types that reach the model as text", () => {
    expect(["text/plain", "text/csv", "application/json"].every(isTextFileMimeType)).toBe(true);
    expect(isTextFileMimeType("image/png")).toBe(false);
    expect(isTextFileMimeType("application/pdf")).toBe(false);
  });
});
