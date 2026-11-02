/**
 * Real-process smoke for @terreno/test. Run `bun e2e/smoke.ts` after `bun run compile`.
 *
 * Imports the compiled package by name and checks the smoke helpers other packages build on:
 * `smokeMongoUri` yields a replica set that serves a change stream, and `spawnUntilReady` waits
 * for a child HTTP server (this file re-run with `serve`) that reports not-ready at first, then
 * `stop()` takes it down. Exits non-zero on the first failed check.
 */

import {
  freePort,
  type SpawnedProcess,
  smokeMongoUri,
  spawnUntilReady,
  stopSmokeMongo,
} from "@terreno/test";
import {DateTime} from "luxon";

const SERVE_ARG = "serve";
// The child answers 503 to this many `/ready` requests, so readiness has to be polled for.
const NOT_READY_REQUESTS = 3;
const CHANGE_EVENT_TIMEOUT_MS = 10000;

interface ReadyBody {
  notReadyServed: number;
  pid: number;
}

/** Child: a plain Bun HTTP server that turns ready after `NOT_READY_REQUESTS` 503s. */
const serve = async (): Promise<void> => {
  let notReadyServed = 0;
  Bun.serve({
    fetch: (request: Request): Response => {
      if (new URL(request.url).pathname !== "/ready") {
        return new Response("not found", {status: 404});
      }
      if (notReadyServed < NOT_READY_REQUESTS) {
        notReadyServed += 1;
        return new Response("starting", {status: 503});
      }
      return Response.json({notReadyServed, pid: process.pid} satisfies ReadyBody);
    },
    hostname: "127.0.0.1",
    port: Number(process.env.PORT),
  });
  console.info(`[testSmoke] serving on port ${process.env.PORT}`);
};

const checkChangeStream = async (): Promise<void> => {
  const uri = await smokeMongoUri({databaseName: "testSmoke"});
  if (!uri.includes("/testSmoke")) {
    throw new Error(`smokeMongoUri: database name missing from ${uri}`);
  }
  const {default: mongoose} = await import("mongoose");
  const connection = await mongoose.createConnection(uri).asPromise();
  try {
    const collection = connection.db?.collection("smokeEvents");
    if (!collection) {
      throw new Error("smokeMongoUri: connection has no database");
    }
    const marker = `smoke-${DateTime.now().toMillis()}`;
    const stream = collection.watch<{marker: string}>([{$match: {"fullDocument.marker": marker}}], {
      maxAwaitTimeMS: 500,
    });
    try {
      // The first tryNext() runs the aggregate, so the stream is open before the insert.
      await stream.tryNext();
      await collection.insertOne({marker});
      let timer: ReturnType<typeof setTimeout> | undefined;
      const change = await Promise.race([
        stream.next(),
        new Promise<never>((_resolve, reject) => {
          timer = setTimeout(
            () => reject(new Error(`change stream: no event within ${CHANGE_EVENT_TIMEOUT_MS} ms`)),
            CHANGE_EVENT_TIMEOUT_MS
          );
        }),
      ]).finally(() => clearTimeout(timer));
      if (change.operationType !== "insert" || change.fullDocument?.marker !== marker) {
        throw new Error(
          `change stream: expected insert of ${marker}, got ${JSON.stringify(change)}`
        );
      }
    } finally {
      await stream.close();
    }
  } finally {
    await connection.close();
  }
  console.info("✅ smokeMongoUri serves a replica set with a working change stream");
};

const checkSpawnUntilReady = async (): Promise<void> => {
  const port = await freePort();
  const readyUrl = `http://127.0.0.1:${port}/ready`;
  let server: SpawnedProcess | undefined;
  try {
    server = await spawnUntilReady({
      cmd: [process.execPath, __filename, SERVE_ARG],
      env: {PORT: String(port)},
      url: readyUrl,
    });

    const res = await fetch(readyUrl);
    const text = await res.text();
    if (res.status !== 200) {
      throw new Error(`GET /ready: expected 200 after spawnUntilReady, got ${res.status}: ${text}`);
    }
    const body = JSON.parse(text) as ReadyBody;
    if (body.notReadyServed !== NOT_READY_REQUESTS) {
      throw new Error(
        `spawnUntilReady: child served ${body.notReadyServed} not-ready answers, expected ${NOT_READY_REQUESTS}`
      );
    }
    if (body.pid !== server.pid || body.pid === process.pid) {
      throw new Error(
        `GET /ready: answered by pid ${body.pid}, not the spawned child ${server.pid}`
      );
    }
    console.info(
      `✅ spawnUntilReady polled through ${NOT_READY_REQUESTS} 503s until the child was ready`
    );

    await server.stop();
    const isStillServing = await fetch(readyUrl, {signal: AbortSignal.timeout(1000)}).then(
      () => true,
      () => false
    );
    if (isStillServing) {
      throw new Error("stop(): the child still answers after stop");
    }
    console.info("✅ stop() takes the child down");
  } catch (error: unknown) {
    if (server) {
      console.error(`--- child output ---\n${server.output()}`);
    }
    throw error;
  } finally {
    await server?.stop();
  }
};

/** Parent: runs each check in turn. */
const run = async (): Promise<void> => {
  const startedAt = DateTime.now();
  try {
    await checkChangeStream();
    await checkSpawnUntilReady();
  } finally {
    await stopSmokeMongo();
  }
  console.info(`test smoke passed in ${DateTime.now().diff(startedAt).toMillis()} ms`);
};

const main = process.argv[2] === SERVE_ARG ? serve : run;
main().then(
  () => {
    if (main === run) {
      process.exit(0);
    }
  },
  (error: unknown) => {
    console.error(`❌ ${error instanceof Error ? error.message : String(error)}`);
    process.exit(1);
  }
);
