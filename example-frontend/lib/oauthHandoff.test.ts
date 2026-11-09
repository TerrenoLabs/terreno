import {describe, expect, it} from "bun:test";

describe("oauthHandoff", () => {
  it("settles false at startup without a browser window or one-time token", async () => {
    const {oauthHandoff} = await import("./oauthHandoff");
    expect(await oauthHandoff).toBe(false);
  });
});
