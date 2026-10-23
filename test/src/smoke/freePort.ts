import {createServer} from "node:net";

/**
 * Asks the OS for an unused TCP port on 127.0.0.1 so parallel or repeated smokes never fight
 * over a fixed port. The port is free when this resolves; bind it promptly.
 */
export const freePort = async (): Promise<number> => {
  const server = createServer();
  await new Promise<void>((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", () => resolve());
  });
  const address = server.address();
  await new Promise<void>((resolve) => server.close(() => resolve()));
  if (!address || typeof address === "string") {
    throw new Error("freePort: the OS did not assign a TCP port");
  }
  return address.port;
};
