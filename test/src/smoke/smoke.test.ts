import {afterAll, afterEach, describe, expect, it} from "bun:test";
import {existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync} from "node:fs";
import {createServer} from "node:net";
import {tmpdir} from "node:os";
import {join} from "node:path";
import mongoose from "mongoose";

import {killLiveChildren, spawnTracked} from "./childProcesses";
import {freePort} from "./freePort";
import {runBin} from "./runBin";
import {smokeMongoUri, stopSmokeMongo} from "./smokeMongoUri";
import {spawnExampleBackend} from "./spawnExampleBackend";
import {type SpawnedProcess, spawnUntilReady} from "./spawnUntilReady";

const fixtureDir = mkdtempSync(join(tmpdir(), "terreno-smoke-"));

afterAll(() => {
  rmSync(fixtureDir, {force: true, recursive: true});
});

/** Writes a script into a temp dir so each test spawns a real child process. */
const writeFixture = (name: string, source: string): string => {
  const path = join(fixtureDir, name);
  mkdirSync(join(path, ".."), {recursive: true});
  writeFileSync(path, source);
  return path;
};

/** A zombie still answers `kill(pid, 0)`, so it counts as gone: it holds no port or pipe. */
const isAlive = (pid: number): boolean => {
  try {
    process.kill(pid, 0);
  } catch {
    return false;
  }
  try {
    const stat = readFileSync(`/proc/${pid}/stat`, "utf8");
    return stat.slice(stat.lastIndexOf(")") + 2, stat.lastIndexOf(")") + 3) !== "Z";
  } catch {
    return true;
  }
};

/** A killed child can linger until it is reaped, so give it a moment to disappear. */
const isGone = async (pid: number): Promise<boolean> => {
  expect(pid).toBeGreaterThan(0);
  for (let attempt = 0; attempt < 40; attempt++) {
    if (!isAlive(pid)) {
      return true;
    }
    await new Promise((resolve) => setTimeout(resolve, 50));
  }
  return false;
};

/** The error a promise rejects with; fails the test when it resolves instead. */
const rejectionOf = async (promise: Promise<unknown>): Promise<Error> => {
  try {
    await promise;
  } catch (error: unknown) {
    return error as Error;
  }
  throw new Error("expected the promise to reject");
};

const pidFrom = (text: string, label: string): number =>
  Number(text.match(new RegExp(`${label}=(\\d+)`))?.[1]);

/** Server fixture that also starts a grandchild, so tests can see the whole group die. */
const serverWithGrandchild = (): string =>
  writeFixture(
    "groupServer.ts",
    `const grandchild = Bun.spawn({cmd: ["sleep", "60"]});
console.info("grandchild=" + grandchild.pid);
Bun.serve({port: Number(process.env.PORT), fetch: () => new Response("ok")});`
  );

describe("freePort", () => {
  it("returns a port that a new server can bind", async () => {
    const port = await freePort();
    expect(port).toBeGreaterThan(0);

    const server = createServer();
    await new Promise<void>((resolve, reject) => {
      server.once("error", reject);
      server.listen(port, "127.0.0.1", () => resolve());
    });
    await new Promise<void>((resolve) => server.close(() => resolve()));
  });

  it("returns different ports on consecutive calls", async () => {
    const first = await freePort();
    const second = await freePort();
    expect(first).not.toBe(second);
  });
});

describe("spawnUntilReady", () => {
  let spawned: SpawnedProcess | undefined;

  afterEach(async () => {
    await spawned?.stop();
    spawned = undefined;
  });

  it("resolves once the url answers 2xx and stop() kills the child and its children", async () => {
    const port = await freePort();
    spawned = await spawnUntilReady({
      cmd: [process.execPath, serverWithGrandchild()],
      env: {PORT: String(port)},
      timeoutMs: 10000,
      url: `http://127.0.0.1:${port}/`,
    });

    const res = await fetch(`http://127.0.0.1:${port}/`);
    expect(await res.text()).toBe("ok");
    const grandchildPid = pidFrom(spawned.output(), "grandchild");
    expect(isAlive(spawned.pid)).toBe(true);
    expect(isAlive(grandchildPid)).toBe(true);

    await spawned.stop();
    expect(await isGone(spawned.pid)).toBe(true);
    expect(await isGone(grandchildPid)).toBe(true);
    // A second stop is a no-op.
    await spawned.stop();
  });

  it("stop() kills a child that ignores SIGTERM once stopGraceMs passes", async () => {
    const port = await freePort();
    spawned = await spawnUntilReady({
      cmd: [
        process.execPath,
        writeFixture(
          "ignoresSigterm.ts",
          `process.on("SIGTERM", () => {});
Bun.serve({port: Number(process.env.PORT), fetch: () => new Response("ok")});`
        ),
      ],
      env: {PORT: String(port)},
      stopGraceMs: 200,
      timeoutMs: 10000,
      url: `http://127.0.0.1:${port}/`,
    });

    const startedAt = performance.now();
    await spawned.stop();
    expect(performance.now() - startedAt).toBeLessThan(2000);
    expect(await isGone(spawned.pid)).toBe(true);
  });

  it("rejects with the child's output when the child exits before it is ready", async () => {
    const script = writeFixture(
      "crash.ts",
      `console.error("missing TOKEN_SECRET");
process.exit(3);`
    );
    const port = await freePort();

    const error = await rejectionOf(
      spawnUntilReady({
        cmd: [process.execPath, script],
        timeoutMs: 10000,
        url: `http://127.0.0.1:${port}/`,
      })
    );

    expect(error.message).toContain("exited with code 3 before");
    expect(error.message).toContain("missing TOKEN_SECRET");
  });

  it("rejects with the last status and kills the child when the url never answers 2xx", async () => {
    const port = await freePort();
    const script = writeFixture(
      "notFound.ts",
      `Bun.serve({port: Number(process.env.PORT), fetch: () => new Response("nope", {status: 404})});`
    );

    const error = await rejectionOf(
      spawnUntilReady({
        cmd: [process.execPath, script],
        env: {PORT: String(port)},
        timeoutMs: 5000,
        url: `http://127.0.0.1:${port}/health`,
      })
    );

    expect(error.message).toContain("not ready");
    expect(error.message).toContain("status 404");
    expect(await isGone(Number(error.message.match(/\(pid (\d+)\)/)?.[1]))).toBe(true);
  }, 20000);
});

describe("child cleanup", () => {
  it("kills tracked children that are still running", async () => {
    const child = spawnTracked({cmd: [process.execPath, "-e", "setInterval(() => {}, 1000)"]});
    killLiveChildren();
    expect(await child.exited).not.toBe(0);
    expect(child.signalCode).toBe("SIGKILL");
  });

  const writeParent = (name: string, ending: string): string =>
    writeFixture(
      name,
      `import {freePort} from ${JSON.stringify(join(__dirname, "freePort.ts"))};
import {spawnUntilReady} from ${JSON.stringify(join(__dirname, "spawnUntilReady.ts"))};
const port = await freePort();
const child = await spawnUntilReady({
  cmd: [process.execPath, ${JSON.stringify(serverWithGrandchild())}],
  env: {PORT: String(port)},
  url: "http://127.0.0.1:" + port + "/",
});
console.info("child=" + child.pid);
${ending}`
    );

  /** Reads the parent's stdout until it reports its child's pid. */
  const childPidFrom = async (stdout: ReadableStream<Uint8Array>): Promise<number> => {
    const decoder = new TextDecoder();
    let text = "";
    for await (const chunk of stdout) {
      text += decoder.decode(chunk, {stream: true});
      const pid = pidFrom(text, "child");
      if (pid > 0) {
        return pid;
      }
    }
    throw new Error(`parent printed no child pid: ${text}`);
  };

  it("kills a running child when the smoke exits without stopping it", async () => {
    const parent = Bun.spawn({
      cmd: [process.execPath, writeParent("crashingParent.ts", "process.exit(1);")],
      stdout: "pipe",
    });
    try {
      const childPid = await childPidFrom(parent.stdout);
      expect(await parent.exited).toBe(1);
      expect(await isGone(childPid)).toBe(true);
    } finally {
      parent.kill("SIGKILL");
    }
  });

  it("kills a running child and exits 143 when the smoke gets SIGTERM", async () => {
    const parent = Bun.spawn({
      cmd: [process.execPath, writeParent("waitingParent.ts", "setInterval(() => {}, 1000);")],
      stdout: "pipe",
    });
    try {
      const childPid = await childPidFrom(parent.stdout);
      expect(isAlive(childPid)).toBe(true);
      parent.kill("SIGTERM");
      expect(await parent.exited).toBe(143);
      expect(await isGone(childPid)).toBe(true);
    } finally {
      parent.kill("SIGKILL");
    }
  });
});

describe("runBin", () => {
  it("returns exit code, stdout, and stderr of a script run through bun", async () => {
    const script = writeFixture(
      "cli.ts",
      `console.info(process.argv.slice(2).join(","));
console.error("warned");
process.exit(Number(process.env.EXIT_CODE ?? 0));`
    );

    const ok = await runBin({args: ["a", "b"], bin: script});
    expect(ok).toEqual({exitCode: 0, stderr: "warned\n", stdout: "a,b\n"});

    const failed = await runBin({bin: script, env: {EXIT_CODE: "2"}});
    expect(failed.exitCode).toBe(2);
  });

  it("runs a command on PATH in a working directory", async () => {
    const result = await runBin({bin: "pwd", cwd: fixtureDir});
    expect(result).toEqual({exitCode: 0, stderr: "", stdout: `${fixtureDir}\n`});
  });

  it("rejects and kills the process when it exceeds timeoutMs", async () => {
    const script = writeFixture(
      "hang.ts",
      `console.info("hang=" + process.pid);
setInterval(() => {}, 1000);`
    );
    const error = await rejectionOf(runBin({bin: script, timeoutMs: 1000}));
    expect(error.message).toContain("timed out after 1000 ms");
    expect(await isGone(pidFrom(error.message, "hang"))).toBe(true);
  });

  it("times out on time and kills grandchildren that hold its output open", async () => {
    const startedAt = performance.now();
    const error = await rejectionOf(
      runBin({
        args: ["-c", 'sleep 30 & echo "sleeper=$!"; wait'],
        bin: "sh",
        timeoutMs: 500,
      })
    );
    expect(error.message).toContain("timed out after 500 ms");
    expect(performance.now() - startedAt).toBeLessThan(5000);
    expect(await isGone(pidFrom(error.message, "sleeper"))).toBe(true);
  });

  it("returns when the binary exits and kills what it left running", async () => {
    const result = await runBin({
      args: ["-c", 'sleep 30 & echo "sleeper=$!"'],
      bin: "sh",
      timeoutMs: 10000,
    });
    expect(result.exitCode).toBe(0);
    expect(await isGone(pidFrom(result.stdout, "sleeper"))).toBe(true);
  });
});

describe("smokeMongoUri", () => {
  const original = process.env.TERRENO_TEST_MONGODB_URI;

  afterEach(
    async () => {
      if (original === undefined) {
        delete process.env.TERRENO_TEST_MONGODB_URI;
      } else {
        process.env.TERRENO_TEST_MONGODB_URI = original;
      }
      await stopSmokeMongo();
    },
    {timeout: 30000}
  );

  it("uses TERRENO_TEST_MONGODB_URI with the database name when it is set", async () => {
    process.env.TERRENO_TEST_MONGODB_URI = "mongodb://sidecar:27017/?replicaSet=rs0";
    expect(await smokeMongoUri({databaseName: "apiSmoke"})).toBe(
      "mongodb://sidecar:27017/apiSmoke?replicaSet=rs0"
    );
    expect(await smokeMongoUri()).toBe("mongodb://sidecar:27017/terrenoSmoke?replicaSet=rs0");
  });

  it(
    "lets the next caller retry after the in-memory replica set fails to start",
    async () => {
      delete process.env.TERRENO_TEST_MONGODB_URI;
      const systemBinary = process.env.MONGOMS_SYSTEM_BINARY;
      process.env.MONGOMS_SYSTEM_BINARY = "/nonexistent/mongod";
      try {
        await expect(smokeMongoUri()).rejects.toThrow();
      } finally {
        if (systemBinary === undefined) {
          delete process.env.MONGOMS_SYSTEM_BINARY;
        } else {
          process.env.MONGOMS_SYSTEM_BINARY = systemBinary;
        }
      }
      expect(await smokeMongoUri({databaseName: "retrySmoke"})).toContain("/retrySmoke?");
    },
    {timeout: 90000}
  );

  it(
    "starts one in-memory replica set, shared by concurrent callers, when unset",
    async () => {
      delete process.env.TERRENO_TEST_MONGODB_URI;
      const [uri, sameServer] = await Promise.all([
        smokeMongoUri({databaseName: "smokeHelperTest"}),
        smokeMongoUri({databaseName: "otherSmoke"}),
      ]);
      expect(uri).toContain("/smokeHelperTest?");
      expect(sameServer).toBe(uri.replace("/smokeHelperTest?", "/otherSmoke?"));

      const connection = await mongoose.createConnection(uri).asPromise();
      try {
        const hello = await connection.db?.admin().command({hello: 1});
        expect(hello?.setName).toBeTruthy();
      } finally {
        await connection.close();
      }
    },
    {timeout: 90000}
  );
});

describe("spawnExampleBackend", () => {
  /** Fake backend whose `/health` echoes the env it was started with. */
  const writeFakeBackend = (): string => {
    const backendDir = mkdtempSync(join(fixtureDir, "fake-backend-"));
    writeFixture(
      join(backendDir.slice(fixtureDir.length + 1), "src/index.ts"),
      `Bun.serve({
  port: Number(process.env.PORT),
  fetch: (req) =>
    new URL(req.url).pathname === "/health"
      ? Response.json(process.env)
      : new Response("not found", {status: 404}),
});`
    );
    return backendDir;
  };

  it("defaults to the monorepo example-backend directory", () => {
    expect(existsSync(join(__dirname, "../../../example-backend/src/index.ts"))).toBe(true);
  });

  it("runs src/index.ts with auth secrets, Mongo, and the port, and waits for /health", async () => {
    const backend = await spawnExampleBackend({
      backendDir: writeFakeBackend(),
      env: {AUTH_PROVIDER: "better-auth", TOKEN_SECRET: "caller-secret"},
      mongoUri: "mongodb://127.0.0.1:27017/fake?replicaSet=rs0",
      timeoutMs: 10000,
    });
    try {
      expect(backend.baseUrl).toBe(`http://127.0.0.1:${backend.port}`);
      const env = (await (await fetch(`${backend.baseUrl}/health`)).json()) as Record<
        string,
        string | undefined
      >;
      expect(env).toMatchObject({
        AUTH_PROVIDER: "better-auth",
        BETTER_AUTH_URL: backend.baseUrl,
        CLINIC_DEMO_MODEL: "true",
        MONGO_URI: "mongodb://127.0.0.1:27017/fake?replicaSet=rs0",
        PORT: String(backend.port),
        TOKEN_SECRET: "caller-secret",
      });
      for (const key of [
        "BETTER_AUTH_SECRET",
        "REFRESH_TOKEN_SECRET",
        "SESSION_SECRET",
        "TOKEN_ISSUER",
      ]) {
        expect(env[key]).toBeTruthy();
      }
    } finally {
      await backend.stop();
    }
  });

  it("stops a backend whose SIGTERM hook keeps it serving without the 5 s grace", async () => {
    const backendDir = mkdtempSync(join(fixtureDir, "sigterm-backend-"));
    writeFixture(
      join(backendDir.slice(fixtureDir.length + 1), "src/index.ts"),
      // Like example-backend's jobs hook: SIGTERM stops a worker, and the HTTP server keeps the
      // process alive.
      `process.once("SIGTERM", () => {});
Bun.serve({port: Number(process.env.PORT), fetch: () => new Response("ok")});`
    );
    const backend = await spawnExampleBackend({backendDir, mongoUri: "mongodb://x/y"});

    const startedAt = performance.now();
    await backend.stop();
    expect(performance.now() - startedAt).toBeLessThan(2000);
    expect(await isGone(backend.pid)).toBe(true);
  });

  it("uses the requested port", async () => {
    const port = await freePort();
    const backend = await spawnExampleBackend({
      backendDir: writeFakeBackend(),
      mongoUri: "mongodb://x/y",
      port,
    });
    try {
      expect(backend.port).toBe(port);
      expect(backend.baseUrl).toBe(`http://127.0.0.1:${port}`);
    } finally {
      await backend.stop();
    }
  });
});
