import {describe, expect, it} from "bun:test";

import {askFilesModelOutput, askFilesToolModelOutput, storedFilesAnswer} from "./askFiles";

const TEXT = "date,total\n2026-09-28,7.75\n";
const TEXT_URL = `data:text/csv;base64,${Buffer.from(TEXT).toString("base64")}`;

describe("askFiles", () => {
  describe("storedFilesAnswer", () => {
    it("keeps each file's id, name, type, and real size, without its bytes", () => {
      expect(
        storedFilesAnswer([
          {
            bytes: new Uint8Array([1, 2, 3]),
            fileId: "f1",
            filename: "a.png",
            mimeType: "image/png",
          },
          {bytes: new Uint8Array(5), filename: "b.txt", mimeType: "text/plain"},
        ])
      ).toEqual({
        action: "accept",
        content: {
          files: [
            {fileId: "f1", filename: "a.png", mimeType: "image/png", size: 3},
            {filename: "b.txt", mimeType: "text/plain", size: 5},
          ],
        },
      });
    });
  });

  describe("askFilesModelOutput", () => {
    it("sends JSON files as text", () => {
      const bytes = new Uint8Array(Buffer.from('{"total": 7.75}'));

      expect(
        askFilesModelOutput([{bytes, filename: "total.json", mimeType: "application/json"}]).value
      ).toEqual([
        {
          text: JSON.stringify({
            action: "accept",
            content: {files: [{filename: "total.json", mimeType: "application/json", size: 15}]},
          }),
          type: "text",
        },
        {text: "File 1 of 1: total.json (application/json, 15 bytes)", type: "text"},
        {text: '{"total": 7.75}', type: "text"},
      ]);
    });
  });

  describe("askFilesToolModelOutput", () => {
    it("keeps a declined or cancelled answer as JSON", () => {
      expect(askFilesToolModelOutput({output: {action: "decline"}})).toEqual({
        type: "json",
        value: {action: "decline"},
      });
      expect(
        askFilesToolModelOutput({output: {action: "cancel", reason: "user_sent_message"}})
      ).toEqual({type: "json", value: {action: "cancel", reason: "user_sent_message"}});
    });

    it("shows a data URL's file and names uploads it cannot load", () => {
      const upload = {fileId: "f1", filename: "a.png", mimeType: "image/png", size: 3};

      expect(
        askFilesToolModelOutput({
          output: {
            action: "accept",
            content: {
              files: [
                {filename: "day.csv", mimeType: "text/csv", size: TEXT.length, url: TEXT_URL},
                upload,
              ],
            },
          },
        })
      ).toEqual({
        type: "content",
        value: [
          {
            text: JSON.stringify({
              action: "accept",
              content: {files: [{filename: "day.csv", mimeType: "text/csv", size: TEXT.length}]},
            }),
            type: "text",
          },
          {text: `File 1 of 1: day.csv (text/csv, ${TEXT.length} bytes)`, type: "text"},
          {text: TEXT, type: "text"},
          {text: `Uploads not loaded here: ${JSON.stringify([upload])}`, type: "text"},
        ],
      });
    });
  });
});
