import {afterEach, describe, expect, it} from "bun:test";
import {join} from "node:path";

const script = join(import.meta.dir, "admin-spa-image-smoke.sh");
const BRAND = "Acme Console";

interface StubOptions {
  loginStatus?: number;
  loginBody?: string;
  loginContentType?: string;
  loaderContentType?: string;
  loaderCacheControl?: string;
  loaderStatus?: number;
}

interface RunResult {
  code: number;
  output: string;
}

const servers: ReturnType<typeof Bun.serve>[] = [];

const goodHtml = `<html><body><h1>${BRAND}</h1><input data-testid="admin-spa-login-email" /></body></html>`;

const startStub = (options: StubOptions = {}): string => {
  const server = Bun.serve({
    fetch: (req) => {
      const {pathname} = new URL(req.url);
      if (pathname === "/console/login") {
        return new Response(options.loginBody ?? goodHtml, {
          headers: {"Content-Type": options.loginContentType ?? "text/html; charset=utf-8"},
          status: options.loginStatus ?? 200,
        });
      }
      if (pathname === "/_expo/loaders/login") {
        return new Response(JSON.stringify({data: {}}), {
          headers: {
            "Cache-Control": options.loaderCacheControl ?? "no-store, private",
            "Content-Type": options.loaderContentType ?? "application/json",
          },
          status: options.loaderStatus ?? 200,
        });
      }
      return new Response("not found", {status: 404});
    },
    port: 0,
  });
  servers.push(server);
  return `http://127.0.0.1:${server.port}`;
};

const run = async (args: string[], env: Record<string, string | undefined>): Promise<RunResult> => {
  const proc = Bun.spawn(["bash", script, ...args], {
    env: {...process.env, ADMIN_SPA_SMOKE_BRAND: undefined, ...env},
    stderr: "pipe",
    stdout: "pipe",
  });
  const [stdout, stderr, code] = await Promise.all([
    new Response(proc.stdout).text(),
    new Response(proc.stderr).text(),
    proc.exited,
  ]);
  return {code, output: `${stdout}\n${stderr}`};
};

afterEach(() => {
  while (servers.length > 0) {
    servers.pop()?.stop(true);
  }
});

describe("admin-spa-image-smoke.sh", () => {
  it("exits 0 when SSR login HTML and the no-store, private loader are served", async () => {
    const result = await run([startStub()], {ADMIN_SPA_SMOKE_BRAND: BRAND});
    expect(result.output).not.toContain("No such file");
    expect(result.code).toBe(0);
  });

  it("exits 1 naming the login check when /console/login answers 503", async () => {
    const result = await run([startStub({loginBody: "unavailable", loginStatus: 503})], {
      ADMIN_SPA_SMOKE_BRAND: BRAND,
    });
    expect(result.code).toBe(1);
    expect(result.output).toMatch(/login/i);
    expect(result.output).toContain("503");
  });

  it("exits 1 when the HTML lacks admin-spa-login-email", async () => {
    const result = await run([startStub({loginBody: `<html><body>${BRAND}</body></html>`})], {
      ADMIN_SPA_SMOKE_BRAND: BRAND,
    });
    expect(result.code).toBe(1);
    expect(result.output).toContain("admin-spa-login-email");
  });

  it("exits 1 when the HTML lacks the brand", async () => {
    const result = await run(
      [startStub({loginBody: `<html><input data-testid="admin-spa-login-email" /></html>`})],
      {ADMIN_SPA_SMOKE_BRAND: BRAND}
    );
    expect(result.code).toBe(1);
    expect(result.output).toContain(BRAND);
  });

  it("exits 1 when the loader Cache-Control is no-store without private", async () => {
    const result = await run([startStub({loaderCacheControl: "no-store"})], {
      ADMIN_SPA_SMOKE_BRAND: BRAND,
    });
    expect(result.code).toBe(1);
    expect(result.output).toMatch(/loader/i);
  });

  it("exits 1 when the loader is not JSON", async () => {
    const result = await run([startStub({loaderContentType: "text/html"})], {
      ADMIN_SPA_SMOKE_BRAND: BRAND,
    });
    expect(result.code).toBe(1);
    expect(result.output).toMatch(/loader/i);
  });

  it("exits 1 with a message when the login response is not HTML (edge)", async () => {
    const result = await run([startStub({loginContentType: "application/json"})], {
      ADMIN_SPA_SMOKE_BRAND: BRAND,
    });
    expect(result.code).toBe(1);
    expect(result.output).toMatch(/login/i);
  });

  it("exits 1 with a usage message when the base-url argument is missing", async () => {
    const result = await run([], {ADMIN_SPA_SMOKE_BRAND: BRAND});
    expect(result.code).toBe(1);
    // The script's own message, not curl's complaint about an empty URL.
    expect(result.output).toContain("<base-url> argument");
    expect(result.output).toContain("Usage:");
  });

  it("exits 1 naming the loader when /_expo/loaders/login answers 503 with JSON", async () => {
    const result = await run([startStub({loaderStatus: 503})], {ADMIN_SPA_SMOKE_BRAND: BRAND});
    expect(result.code).toBe(1);
    expect(result.output).toMatch(/loader/i);
    expect(result.output).toContain("503");
  });

  it("exits 1 listing ADMIN_SPA_SMOKE_BRAND when it is unset", async () => {
    const result = await run([startStub()], {});
    expect(result.code).toBe(1);
    expect(result.output).toContain("ADMIN_SPA_SMOKE_BRAND");
  });

  it("exits 1 listing ADMIN_SPA_SMOKE_BRAND when it is empty (edge)", async () => {
    const result = await run([startStub()], {ADMIN_SPA_SMOKE_BRAND: ""});
    expect(result.code).toBe(1);
    expect(result.output).toContain("ADMIN_SPA_SMOKE_BRAND");
  });

  it("lists both missing items when argument and env are both absent (edge)", async () => {
    const result = await run([], {});
    expect(result.code).toBe(1);
    expect(result.output).toContain("ADMIN_SPA_SMOKE_BRAND");
  });
});
