/**
 * Vercel Functions entry. Vercel's Express preset serves the default export of the first
 * `app`/`index`/`server` file (root, then `src/`) whose source imports express, so this
 * file comes before `src/index.ts`, which stays the Cloud Run entry that listens on PORT.
 */
import "./instrument";
import type {Server} from "node:http";
import type express from "express";

import {createVercelServer} from "./vercelServer";

const {server}: {app: express.Application; server: Server} = await createVercelServer();

export default server;
