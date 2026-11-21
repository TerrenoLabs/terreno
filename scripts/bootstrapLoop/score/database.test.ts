import {describe, expect, it} from "bun:test";
import {createServer} from "node:net";

import {startReplicaSetMongo} from "./database";

describe("startReplicaSetMongo", () => {
  it("refuses a port that another process already listens on", async () => {
    const server = createServer();
    await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
    const address = server.address();
    const port = typeof address === "object" && address ? address.port : 0;
    try {
      await expect(startReplicaSetMongo({appDir: "/nonexistent", env: {}, port})).rejects.toThrow(
        `port ${String(port)} is already in use`
      );
    } finally {
      server.close();
    }
  });
});
