import {describe, expect, it} from "bun:test";
import type {Server} from "node:http";
import type {AddressInfo} from "node:net";

import {authWithToken} from "./authWithToken";
import {getBaseServer} from "./getBaseServer";
import {createLoopbackServer, testRequest} from "./testRequest";

// Records where a supertest server listened and whether it was closed afterwards.
const watch = (server: Server): {address: () => AddressInfo | null; closes: () => number} => {
  let address: AddressInfo | null = null;
  let closes = 0;
  server.on("listening", () => {
    address = server.address() as AddressInfo;
  });
  server.on("close", () => {
    closes++;
  });
  return {address: () => address, closes: () => closes};
};

describe("testRequest", () => {
  it("serves the request from a server bound to 127.0.0.1", async () => {
    const app = getBaseServer();
    app.get("/ping", (_req, res) => {
      res.json({pong: true});
    });

    const request = testRequest(app).get("/ping");
    const seen = watch(request.app as Server);
    const res = await request;

    expect(res.status).toBe(200);
    expect(res.body).toEqual({pong: true});
    expect(seen.address()?.address).toBe("127.0.0.1");
    expect(seen.address()?.family).toBe("IPv4");
  });

  it("closes the server once the request settles", async () => {
    const app = getBaseServer();
    app.get("/ping", (_req, res) => {
      res.json({pong: true});
    });

    const request = testRequest(app).get("/ping");
    const server = request.app as Server;
    const seen = watch(server);
    await request;

    expect(seen.closes()).toBe(1);
    const port = seen.address()?.port;
    await expect(fetch(`http://127.0.0.1:${port}/ping`)).rejects.toThrow();
  });
});

describe("createLoopbackServer", () => {
  it("binds 127.0.0.1 even when asked for every address", async () => {
    const server = createLoopbackServer((_req, res) => {
      res.end("ok");
    });
    await new Promise<void>((resolve) => {
      server.listen(0, () => resolve());
    });
    const address = server.address() as AddressInfo;
    await new Promise<void>((resolve) => {
      server.close(() => resolve());
    });

    expect(address.address).toBe("127.0.0.1");
  });

  it("is what agents from authWithToken listen on", async () => {
    const app = getBaseServer();
    app.get("/whoami", (req, res) => {
      res.json({authorization: req.headers.authorization});
    });

    const agent = await authWithToken(app, {token: "tok"});
    const seen = watch((agent as unknown as {app: Server}).app);
    const res = await agent.get("/whoami");

    expect(res.body.authorization).toBe("Bearer tok");
    expect(seen.address()?.address).toBe("127.0.0.1");
  });
});
