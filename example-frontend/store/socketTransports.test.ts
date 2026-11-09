import {describe, expect, it} from "bun:test";

import {socketTransports} from "./socketTransports";

describe("socketTransports", (): void => {
  it("keeps the client default when the manifest has no SOCKET_TRANSPORTS", (): void => {
    // tests/testPreload.ts gives expo-constants an empty `extra`, like a non-Vercel build.
    expect(socketTransports).toBeUndefined();
  });
});
