import {appendFileSync, existsSync, mkdirSync, statSync, writeFileSync} from "node:fs";
import {join} from "node:path";
import express from "express";
import {DateTime} from "luxon";

const MAX_BATCH_ENTRIES = 100;
const MAX_LEVEL_LENGTH = 32;
const MAX_MESSAGE_LENGTH = 8000;
const MAX_STACK_LENGTH = 16_000;
const BROWSER_LOG_BODY_LIMIT_BYTES = 256 * 1024;
const BROWSER_LOG_BODY_LIMIT = "256kb";
const MAX_BROWSER_LOG_FILE_BYTES = 5 * 1024 * 1024;

const shouldEnableBrowserLogs = (): boolean => {
  if (process.env.NODE_ENV === "production") {
    return false;
  }
  if (process.env.TERRENO_BROWSER_LOGS === "false" || process.env.TERRENO_BROWSER_LOGS === "0") {
    return false;
  }
  if (process.env.TERRENO_BROWSER_LOGS === "true" || process.env.TERRENO_BROWSER_LOGS === "1") {
    return true;
  }
  return process.env.NODE_ENV === "development";
};

interface BrowserLogPayload {
  level?: string;
  message?: unknown;
  stack?: string;
  timestamp?: string;
}

const isLoopbackAddress = (address: string | undefined): boolean => {
  return address === "127.0.0.1" || address === "::1" || address === "::ffff:127.0.0.1";
};

const isBrowserLogRequestAllowed = (req: express.Request): boolean => {
  return Boolean(req.user) || isLoopbackAddress(req.socket.remoteAddress);
};

/**
 * Dev-only ingestion for the Terreno MCP `read_logs` tool: POST batches of client
 * console / global error lines as JSONL under `.terreno/logs/browser.log`.
 */
export const addTerrenoDevBrowserLogsRoute = (app: express.Application): void => {
  if (!shouldEnableBrowserLogs()) {
    return;
  }

  app.post("/__terreno/browser-logs", express.json({limit: BROWSER_LOG_BODY_LIMIT}), (req, res) => {
    if (!isBrowserLogRequestAllowed(req)) {
      res
        .status(403)
        .json({error: "Browser log ingestion requires a local or authenticated client"});
      return;
    }
    const parsedBodySize = Buffer.byteLength(JSON.stringify(req.body ?? null));
    if (parsedBodySize > BROWSER_LOG_BODY_LIMIT_BYTES) {
      res.status(413).json({error: "Browser log payload may not exceed 256 kB"});
      return;
    }
    const body = req.body as {entries?: unknown} | undefined;
    if (!Array.isArray(body?.entries) || body.entries.length === 0) {
      res.status(400).json({error: "Expected { entries: [...] }"});
      return;
    }
    if (body.entries.length > MAX_BATCH_ENTRIES) {
      res.status(413).json({error: `A batch may contain at most ${MAX_BATCH_ENTRIES} entries`});
      return;
    }

    const logDir = join(process.cwd(), ".terreno", "logs");
    mkdirSync(logDir, {recursive: true});
    const path = join(logDir, "browser.log");
    const lines: string[] = [];

    for (const row of body.entries) {
      if (typeof row !== "object" || row === null) {
        continue;
      }
      const r = row as BrowserLogPayload;
      const level = (typeof r.level === "string" ? r.level : "info").slice(0, MAX_LEVEL_LENGTH);
      const rawMessage =
        typeof r.message === "string" ? r.message : JSON.stringify(r.message ?? "");
      lines.push(
        JSON.stringify({
          level,
          message: rawMessage.slice(0, MAX_MESSAGE_LENGTH),
          source: "browser",
          stack: typeof r.stack === "string" ? r.stack.slice(0, MAX_STACK_LENGTH) : undefined,
          timestamp:
            typeof r.timestamp === "string" && r.timestamp ? r.timestamp : DateTime.now().toISO(),
        })
      );
    }

    if (lines.length > 0) {
      const payload = `${lines.join("\n")}\n`;
      const currentSize = existsSync(path) ? statSync(path).size : 0;
      if (currentSize + Buffer.byteLength(payload) > MAX_BROWSER_LOG_FILE_BYTES) {
        writeFileSync(path, payload, {encoding: "utf-8", mode: 0o600});
      } else {
        appendFileSync(path, payload, {encoding: "utf-8", mode: 0o600});
      }
    }

    res.status(204).end();
  });
};
