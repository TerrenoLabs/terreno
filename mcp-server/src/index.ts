#!/usr/bin/env bun

import "./instrument.js";

import * as Sentry from "@sentry/bun";
import {logger} from "@terreno/api";
import {createMcpHttpApp} from "./httpApp.js";
import {resolveMcpRateLimitConfig, resolveTrustProxyHops} from "./rateLimit.js";

const resolvePort = (): number => {
  const envPort = process.env.PORT;
  if (!envPort) {
    return 8080;
  }

  const parsedPort = Number.parseInt(envPort, 10);
  if (Number.isNaN(parsedPort)) {
    throw new Error(`Invalid PORT value: ${envPort}`);
  }

  return parsedPort;
};

const resolveHost = (): string => {
  const envHost = process.env.MCP_HOST ?? process.env.HOST;
  if (envHost) {
    return envHost;
  }

  return "0.0.0.0";
};

const main = async (): Promise<void> => {
  const {setupLogging} = (await import("@terreno/api")) as {
    setupLogging?: (options?: {disableConsoleColors?: boolean}) => void;
  };
  setupLogging?.({disableConsoleColors: process.env.NODE_ENV === "production"});
  const port = resolvePort();
  const host = resolveHost();
  const rateLimit = resolveMcpRateLimitConfig();
  const trustProxyHops = resolveTrustProxyHops();
  const app = createMcpHttpApp({host, rateLimit, trustProxyHops});

  app.listen(port, host, (error?: Error): void => {
    if (error) {
      logger.error("Failed to start server:", error);
      process.exit(1);
      return;
    }
    logger.info(`Terreno MCP server listening on ${host}:${port}`, {rateLimit, trustProxyHops});
  });
};

main().catch((error) => {
  Sentry.captureException(error);
  logger.error("Fatal error starting MCP server:", error);
  // Flush the captured exception before exiting so a bad config fails the deploy visibly.
  void Sentry.flush(2000).finally(() => process.exit(1));
});
