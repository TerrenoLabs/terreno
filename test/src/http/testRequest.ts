import {createServer, type RequestListener, type Server} from "node:http";
import supertest from "supertest";

/**
 * An HTTP server for supertest that binds 127.0.0.1 and closes after each request under Bun.
 *
 * `supertest(app)` starts its server with `listen(0)`, which under Bun binds only the IPv6
 * wildcard (`*:<port>`), and then sends the request to `127.0.0.1:<port>`. On macOS another
 * process can hold that same port on 127.0.0.1 at the same time, so the request reaches that
 * process and the test sees its 404 or 401. Binding 127.0.0.1 keeps the port ours.
 *
 * supertest closes its server after a request only when `server._handle` is set, a Node
 * internal that Bun leaves undefined, so under Bun every request leaked a listening server.
 * The server marks `_handle` once listening so supertest closes it as it does under Node.
 */
export const createLoopbackServer = (app: RequestListener): Server => {
  const server = createServer(app);
  const listen = server.listen.bind(server) as (...args: unknown[]) => Server;
  const internal = server as unknown as {_handle?: unknown};
  // supertest calls listen(0); any further arguments (a callback) pass through.
  server.listen = ((port?: number, ...rest: unknown[]): Server => {
    const result = listen(port, "127.0.0.1", ...rest);
    if (internal._handle === undefined) {
      internal._handle = true;
    }
    return result;
  }) as Server["listen"];
  return server;
};

/**
 * `supertest(app)`, bound to 127.0.0.1. Use it in place of `supertest(app)` in Bun tests.
 */
export const testRequest = (app: RequestListener): ReturnType<typeof supertest> =>
  supertest(createLoopbackServer(app));
