import {describe, expect, it} from "bun:test";

import {parseSocketTransports} from "./parseSocketTransports";

describe("parseSocketTransports", (): void => {
  it("keeps the client default when unset or empty", (): void => {
    expect(parseSocketTransports(undefined)).toBeUndefined();
    expect(parseSocketTransports("")).toBeUndefined();
    expect(parseSocketTransports(true)).toBeUndefined();
  });

  it("parses a websocket-only setting", (): void => {
    expect(parseSocketTransports("websocket")).toEqual(["websocket"]);
  });

  it("keeps order, trims, and drops unknown transports", (): void => {
    expect(parseSocketTransports(" polling , websocket, webtransport")).toEqual([
      "polling",
      "websocket",
    ]);
    expect(parseSocketTransports("webtransport")).toBeUndefined();
  });
});
