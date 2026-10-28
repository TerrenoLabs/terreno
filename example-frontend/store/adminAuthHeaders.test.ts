import {afterEach, describe, expect, it} from "bun:test";
import {setTokenSource} from "@terreno/rtk";

import {getAdminAuthHeaders} from "./adminAuthHeaders";

const sourceWithToken = (token: string | null): Parameters<typeof setTokenSource>[0] => ({
  getToken: async (): Promise<string | null> => token,
  getUserId: async (): Promise<string | null> => (token ? "user-1" : null),
  onAuthChange: (): (() => void) => (): void => {},
});

describe("getAdminAuthHeaders", () => {
  afterEach(() => {
    setTokenSource(undefined);
  });

  it("sends the registered token source's token as a bearer header", async () => {
    setTokenSource(sourceWithToken("admin-token"));
    expect(await getAdminAuthHeaders()).toEqual({Authorization: "Bearer admin-token"});
  });

  it("sends no header when the source has no token", async () => {
    setTokenSource(sourceWithToken(null));
    expect(await getAdminAuthHeaders()).toEqual({});
  });

  it("sends no header when no token source is registered", async () => {
    setTokenSource(undefined);
    expect(await getAdminAuthHeaders()).toEqual({});
  });
});
