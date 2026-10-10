import {describe, expect, it} from "bun:test";
import {DateTime} from "luxon";

import {createPhotoImageResolver} from "./photoLibraryImages";

describe("createPhotoImageResolver", () => {
  it("resolves a photo library id to its signed URL", async () => {
    const calls: string[] = [];
    const resolveImage = createPhotoImageResolver({
      fetchUrl: async (id) => {
        calls.push(id);
        return {url: `https://storage.example.test/${id}.png`};
      },
    });

    expect(await resolveImage("6ac7232b8a6d6ccc431f86c5")).toBe(
      "https://storage.example.test/6ac7232b8a6d6ccc431f86c5.png"
    );
    expect(calls).toEqual(["6ac7232b8a6d6ccc431f86c5"]);
  });

  it("fetches each id once while its URL is fresh", async () => {
    const calls: string[] = [];
    const resolveImage = createPhotoImageResolver({
      fetchUrl: async (id) => {
        calls.push(id);
        return {url: `https://storage.example.test/${id}.png`};
      },
    });

    await Promise.all([resolveImage("a1"), resolveImage("a1"), resolveImage("b2")]);
    await resolveImage("a1");

    expect(calls).toEqual(["a1", "b2"]);
  });

  it("fetches again once the cached URL is close to expiring", async () => {
    let now = DateTime.fromISO("2026-10-08T12:00:00Z");
    const calls: string[] = [];
    const resolveImage = createPhotoImageResolver({
      fetchUrl: async (id) => {
        calls.push(id);
        return {url: `https://storage.example.test/${id}-${calls.length}.png`};
      },
      now: () => now,
    });

    expect(await resolveImage("a1")).toBe("https://storage.example.test/a1-1.png");
    now = now.plus({minutes: 51});
    expect(await resolveImage("a1")).toBe("https://storage.example.test/a1-2.png");
  });

  it("returns undefined when the lookup fails, and retries on the next call", async () => {
    let shouldFail = true;
    const resolveImage = createPhotoImageResolver({
      fetchUrl: async (id) => {
        if (shouldFail) {
          throw {data: {title: "Document not found"}, status: 404};
        }
        return {url: `https://storage.example.test/${id}.png`};
      },
    });

    expect(await resolveImage("roast-lamb")).toBeUndefined();
    shouldFail = false;
    expect(await resolveImage("roast-lamb")).toBe("https://storage.example.test/roast-lamb.png");
  });

  it("returns undefined when the response has no URL", async () => {
    const resolveImage = createPhotoImageResolver({
      fetchUrl: async () => ({}),
    });

    expect(await resolveImage("a1")).toBeUndefined();
  });

  it("unwraps a {data: {url}} body", async () => {
    const resolveImage = createPhotoImageResolver({
      fetchUrl: async () => ({data: {url: "https://storage.example.test/wrapped.png"}}),
    });

    expect(await resolveImage("a1")).toBe("https://storage.example.test/wrapped.png");
  });
});
