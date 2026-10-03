import {afterEach, beforeEach, describe, it} from "bun:test";
import {assert} from "chai";

import {
  normalizeMimeType,
  resolveAskFilesAsDataUrls,
  selectedFileMimeType,
  selectedFileToDataUrlRef,
} from "./askFileRefs";

const TEXT = "Coffee, 4.50\nBagel, 3.25\n";
const textUri = (mimeType: string): string =>
  `data:${mimeType};base64,${Buffer.from(TEXT).toString("base64")}`;

describe("askFileRefs", () => {
  it("normalizes a MIME type to its lowercase type without parameters", () => {
    assert.equal(normalizeMimeType("Text/CSV; charset=utf-8"), "text/csv");
    assert.equal(normalizeMimeType("image/png"), "image/png");
  });

  it("takes the type from the extension when the picker reports none or a generic one", () => {
    assert.equal(selectedFileMimeType({mimeType: "", name: "day.CSV"}), "text/csv");
    assert.equal(
      selectedFileMimeType({mimeType: "application/octet-stream", name: "notes.txt"}),
      "text/plain"
    );
    assert.equal(
      selectedFileMimeType({mimeType: "application/vnd.ms-excel", name: "export.csv"}),
      "text/csv"
    );
    assert.equal(selectedFileMimeType({mimeType: "", name: "scan.jpeg"}), "image/jpeg");
    assert.equal(
      selectedFileMimeType({mimeType: "application/octet-stream", name: "plan.pdf"}),
      "application/pdf"
    );
    assert.equal(selectedFileMimeType({mimeType: "", name: "total.json"}), "application/json");
  });

  it("keeps a specific reported type, and a generic one it cannot improve on", () => {
    assert.equal(selectedFileMimeType({mimeType: "Image/PNG", name: "photo.jpg"}), "image/png");
    assert.equal(
      selectedFileMimeType({mimeType: "application/octet-stream", name: "archive.zip"}),
      "application/octet-stream"
    );
    assert.equal(
      selectedFileMimeType({mimeType: "application/vnd.ms-excel", name: "sheet.xls"}),
      "application/vnd.ms-excel"
    );
    assert.equal(selectedFileMimeType({mimeType: "", name: "README"}), "");
  });

  it("sends the extension's type in the data URL when the picker reports a generic one", async () => {
    const ref = await selectedFileToDataUrlRef({
      mimeType: "application/vnd.ms-excel",
      name: "items.csv",
      uri: textUri("application/vnd.ms-excel"),
    });

    assert.equal(ref.mimeType, "text/csv");
    assert.isTrue(ref.url.startsWith("data:text/csv;base64,"));
  });

  it("reads a picked file into a data URL of its declared type, with its byte size", async () => {
    const ref = await selectedFileToDataUrlRef({
      mimeType: "text/csv; charset=utf-8",
      name: "items.csv",
      uri: textUri("application/octet-stream"),
    });

    assert.deepEqual(ref, {
      filename: "items.csv",
      mimeType: "text/csv",
      size: Buffer.byteLength(TEXT),
      url: `data:text/csv;base64,${Buffer.from(TEXT).toString("base64")}`,
    });
  });

  it("resolves every file in order", async () => {
    const refs = await resolveAskFilesAsDataUrls([
      {mimeType: "text/plain", name: "a.txt", uri: textUri("text/plain")},
      {mimeType: "image/png", name: "b.png", uri: "data:image/png;base64,iVBORw0KGgo="},
    ]);

    assert.deepEqual(
      refs.map(({filename, mimeType, size}) => ({filename, mimeType, size})),
      [
        {filename: "a.txt", mimeType: "text/plain", size: Buffer.byteLength(TEXT)},
        {filename: "b.png", mimeType: "image/png", size: 8},
      ]
    );
  });

  describe("with FileReader, as on web", () => {
    const originalFileReader = globalThis.FileReader;

    /** Reads a blob the way a browser FileReader does, or fails when the blob is empty. */
    class FakeFileReader {
      error: Error | null = null;
      onerror: (() => void) | null = null;
      onload: (() => void) | null = null;
      result: string | null = null;

      readAsDataURL(blob: Blob): void {
        void blob.arrayBuffer().then((buffer) => {
          if (buffer.byteLength === 0) {
            this.error = new Error("The file is empty.");
            this.onerror?.();
            return;
          }
          this.result = `data:${blob.type};base64,${Buffer.from(buffer).toString("base64")}`;
          this.onload?.();
        });
      }
    }

    beforeEach(() => {
      globalThis.FileReader = FakeFileReader as unknown as typeof FileReader;
    });

    afterEach(() => {
      globalThis.FileReader = originalFileReader;
    });

    it("reads the file's bytes through FileReader", async () => {
      const ref = await selectedFileToDataUrlRef({
        mimeType: "text/plain",
        name: "items.txt",
        uri: textUri("text/plain"),
      });

      assert.deepEqual(ref, {
        filename: "items.txt",
        mimeType: "text/plain",
        size: Buffer.byteLength(TEXT),
        url: `data:text/plain;base64,${Buffer.from(TEXT).toString("base64")}`,
      });
    });

    it("rejects when FileReader cannot read the file", async () => {
      let error: unknown;
      try {
        await selectedFileToDataUrlRef({
          mimeType: "text/plain",
          name: "empty.txt",
          uri: "data:text/plain;base64,",
        });
      } catch (caught) {
        error = caught;
      }

      assert.instanceOf(error, Error);
      assert.equal((error as Error).message, "The file is empty.");
    });
  });
});
