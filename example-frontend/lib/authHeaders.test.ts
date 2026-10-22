import {describe, expect, it} from "bun:test";

import {bearerAuthHeaders} from "./authHeaders";

describe("bearerAuthHeaders", () => {
  it("returns a bearer header for the session token", async () => {
    expect(await bearerAuthHeaders(async () => "session-token")).toEqual({
      Authorization: "Bearer session-token",
    });
  });

  it("returns no headers when signed out", async () => {
    expect(await bearerAuthHeaders(async () => null)).toEqual({});
  });

  it("returns no headers when the token read fails", async () => {
    const originalWarn = console.warn;
    console.warn = (): void => {};
    try {
      expect(
        await bearerAuthHeaders(async () => {
          throw new Error("storage unavailable");
        })
      ).toEqual({});
    } finally {
      console.warn = originalWarn;
    }
  });
});
