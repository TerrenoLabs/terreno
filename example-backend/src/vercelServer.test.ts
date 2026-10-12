/** Verifies the Vercel Functions entry (src/app.ts) boots onto a host-owned http.Server. */
import {afterAll, beforeAll, describe, expect, it} from "bun:test";
import type {Server} from "node:http";
import type {AddressInfo} from "node:net";

describe("Vercel entry", () => {
  let server: Server;
  let baseUrl: string;

  beforeAll(async () => {
    // Importing the entry boots it, as Vercel's launcher does.
    server = (await import("./app")).default;
  });

  afterAll(async () => {
    server.closeAllConnections();
    await new Promise<void>((resolve) => {
      server.close(() => resolve());
    });
  });

  it("leaves listening to the host", async () => {
    expect(server.listening).toBe(false);
    await new Promise<void>((resolve) => {
      server.listen(0, "127.0.0.1", () => resolve());
    });
    baseUrl = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  });

  it("serves the Express app on the host's server", async () => {
    const res = await fetch(`${baseUrl}/openapi.json`);
    expect(res.status).toBe(200);
    const body = (await res.json()) as {openapi: string};
    expect(body.openapi).toBe("3.0.0");
  });

  it("mounts socket.io on the same server", async () => {
    // engine.io answers its own path with a JSON error; Express would answer 404.
    const res = await fetch(`${baseUrl}/socket.io/?EIO=4&transport=unknown`);
    expect(res.status).toBe(400);
    const body = (await res.json()) as {code: number; message: string};
    expect(body.message).toBe("Transport unknown");
  });
});
