import {createServer, type Server} from "node:http";
import type express from "express";

import {start} from "./server";

export interface VercelServer {
  app: express.Application;
  server: Server;
}

/**
 * Boots the backend onto an `http.Server` this process never listens on. Vercel serves the
 * exported server as-is, WebSocket upgrades included; exporting the bare Express app would
 * leave `/socket.io/` unmounted.
 */
export const createVercelServer = async (): Promise<VercelServer> => {
  const server = createServer();
  const app = await start(false, server);
  return {app, server};
};
