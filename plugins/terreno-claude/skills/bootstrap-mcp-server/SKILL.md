---
name: bootstrap-mcp-server
description: Bootstrap a backend-only Terreno MCP server that ships as a single Bun executable with the admin console embedded. Scaffolds the backend with create-terreno-app, drops the frontend, registers MCP tools, service tokens, optional MCP OAuth using the admin console's consent screen, a request log, tool on/off switches, and the MCP admin screens, then compiles everything (admin SPA included) into one binary. Trigger with "bootstrap an MCP server", "new Terreno MCP server", "MCP-only backend", or "ship the MCP server as a binary". Not for a full Expo app (use the terreno_bootstrap prompt / create-terreno-app) or for adding MCP tools to an existing app (see docs/how-to/expose-mcp-tools.md).
targets: ['*']
---

# Bootstrap an MCP server

The MCP-only sibling of the `terreno_bootstrap` prompt. Output: one directory with a Terreno
backend whose product surface is `POST /mcp`, an admin console at `/console`, and a
`bun run build:binary` script that emits **one executable** with the admin SPA
embedded. MongoDB stays external (a replica set, as for every Terreno backend).

Requires the `@terreno/*` release that ships `mcpAdminModels`, `mcpRequestLog`,
`mcpToolSettings`, and the admin SPA consent route (check `CHANGELOG.md` for "MCP admin screens";
`create-terreno-app` scaffolds that version or newer).

## When to use

- The user wants a remote MCP server (Claude.ai / ChatGPT connectors, Claude Code, Cursor,
  Perplexity) backed by Terreno auth, permissions, and models.
- The user wants that server deployable as a single file (`scp` + `systemd`, a tiny container,
  or a homelab box behind a Cloudflare Tunnel).

## Inputs

Ask only for what is missing:

1. `appName` (kebab-case) and `appDisplayName`.
2. Public origin the server will be reached at (for example `https://mcp.example.com`). Needed
   for `PUBLIC_API_URL`, the OAuth `issuer`, and the Better Auth URL. Use
   `http://localhost:4000` until the user has one.
3. Which clients must connect: static-key clients (Perplexity, Cursor, Claude Code) need
   **service tokens**; Claude.ai / ChatGPT connectors need **MCP OAuth**. Default: both.

## Steps

Complete each step before the next. Each ends with a check.

### 1. Scaffold the backend only

```bash
bunx create-terreno-app <appName> --display-name "<appDisplayName>"
cd <appName>
rm -rf frontend            # MCP-only: the admin console is the only UI
```

Remove `frontend` from the root workspace list and root scripts. Check: `bun install` succeeds
and `cd backend && bun run compile` (or `bunx tsc --noEmit`) passes.

### 2. Add the admin packages

```bash
cd backend
bun add @terreno/admin-backend @terreno/admin-spa
```

Register, in this order, after `BetterAuthApp`:

```typescript
import {AdminApp, mcpAdminModels, mcpAdminScripts} from "@terreno/admin-backend";
import {AdminSpaServeApp} from "@terreno/admin-spa";

terreno
  .register(
    new AdminApp({
      models: [...appAdminModels, ...mcpAdminModels({requestLog: true, toolSettings: true})],
      scripts: mcpAdminScripts(),
    })
  )
  .register(
    new AdminSpaServeApp({
      appConfig: {brandName: APP_NAME, providers: ["email"]},
      basePath: "/console",
      // Set by src/embeddedAssets.ts in the compiled binary; undefined in dev.
      distDir: process.env.ADMIN_SPA_DIST_DIR,
    })
  );
```

`mcpAdminModels({requestLog: true, toolSettings: true})` adds the **MCP** sidebar group (service
tokens, OAuth clients, OAuth connections, request log, tools; keep the two flags matched to the
`TerrenoApp` options) and `mcpAdminScripts()` adds `mcp-sign-out-everywhere`. If the
app uses RBAC (`accessControl`), spread `mcpAdminStatements` into its statements. See
`docs/how-to/manage-mcp-in-admin.md`. Check: `curl -I localhost:4000/console` returns 200 (the
published package ships the prebuilt SPA).

### 3. Turn on the MCP surface

In the `TerrenoApp` options:

```typescript
mcpServiceTokens: {enabled: true, publicMcpUrl: process.env.PUBLIC_API_URL},
mcpOAuth: process.env.MCP_OAUTH_ENABLED === "true"
  ? {
      allowedRedirectHosts: ["claude.ai", "chatgpt.com"],
      consentUrl: `${process.env.PUBLIC_API_URL}/console/oauth/consent`,
      dynamicClientRegistration: true,
      enabled: true,
      issuer: process.env.PUBLIC_API_URL!,
    }
  : undefined,
mcpRequestLog: {enabled: true, retentionDays: 30},   // metadata only, never tool arguments
mcpToolSettings: true,                               // admin on/off switch per tool
rateLimit: {store: "memory", trustProxy: "loopback"},   // registration and token endpoints are unauthenticated
```

Expose tools with `mcp: {methods: ["list", "read"]}` on `modelRouter` and custom tools with
`registerMCPTool` (see `docs/how-to/expose-mcp-tools.md`). Ship at least one tool, or `/mcp` is
not mounted.

**Consent screen (OAuth only).** `consentUrl` points at the admin console's built-in consent
screen (`@terreno/admin-spa`, route `/oauth/consent`). Any signed-in user can approve there, not
only admins; a signed-out user signs in and comes back. Keep the `/console` part equal to
`AdminSpaServeApp`'s `basePath`. Check: `curl -s -X POST localhost:4000/mcp` returns 401 with a
`WWW-Authenticate: Bearer resource_metadata=...` header when OAuth is on.

### 4. Check the MCP admin screens

Seed an admin, sign in at `/console`, and open the **MCP** group. Check: **MCP tools** lists every
tool with `enabled: true`; switching one off removes it from `tools/list`.

### 5. Embed the admin console in the binary

`bun build --compile` resolves `__dirname` to `$bunfs`, so `AdminSpaServeApp` cannot find the
SPA bundle on disk. The published `@terreno/admin-spa` already ships its prebuilt export in
`node_modules/@terreno/admin-spa/dist`; embed that and extract it at boot. No Expo or Node build
step is needed.

`scripts/generateEmbeddedAssets.ts` (writes a manifest of `with {type: "file"}` imports):

```typescript
import {readdirSync, statSync, writeFileSync} from "node:fs";
import {join, relative, resolve} from "node:path";

const root = resolve(process.argv[2] ?? "node_modules/@terreno/admin-spa/dist");
const files: string[] = [];
const walk = (dir: string): void => {
  for (const name of readdirSync(dir)) {
    const path = join(dir, name);
    if (statSync(path).isDirectory()) {
      walk(path);
    } else {
      files.push(path);
    }
  }
};
walk(root);
const lines = files.map((file, i) => `import f${i} from ${JSON.stringify(file)} with {type: "file"};`);
lines.push(
  `export const ADMIN_SPA_FILES: {path: string; file: string}[] = [${files
    .map((file, i) => `{path: ${JSON.stringify(relative(root, file))}, file: f${i}}`)
    .join(",\n")}];`
);
writeFileSync("src/embeddedAdminSpa.generated.ts", `${lines.join("\n")}\n`);
```

Commit `src/embeddedAdminSpa.generated.ts` as this stub so a fresh clone typechecks and
`bun run dev` works. `build:binary` (step 6) restores it after compiling:

```typescript
export const ADMIN_SPA_FILES: {path: string; file: string}[] = [];
```

`src/embeddedAdminSpa.ts`, imported at the top of `src/index.ts` before the server module:

```typescript
import {mkdirSync, writeFileSync} from "node:fs";
import {tmpdir} from "node:os";
import {dirname, join} from "node:path";
import {ADMIN_SPA_FILES} from "./embeddedAdminSpa.generated";

// Extract the embedded admin bundle once per process so AdminSpaServeApp can serve it from disk.
if (ADMIN_SPA_FILES.length > 0 && !process.env.ADMIN_SPA_DIST_DIR) {
  const out = join(tmpdir(), `<appName>-admin-spa-${process.pid}`);
  for (const {path, file} of ADMIN_SPA_FILES) {
    const dest = join(out, path);
    mkdirSync(dirname(dest), {recursive: true});
    writeFileSync(dest, new Uint8Array(await Bun.file(file).arrayBuffer()));
  }
  process.env.ADMIN_SPA_DIST_DIR = out;
}
```

With the stub (dev), nothing is extracted and `AdminSpaServeApp` uses its package default. If the
app later adds migrations, embed `migrations/` the same way and set `MIGRATIONS_DIR`.

### 6. Build the binary

Add to `backend/package.json`:

```json
"build:binary": "bun scripts/generateEmbeddedAssets.ts && bun build --compile --minify src/index.ts --outfile dist/<appName> && git checkout src/embeddedAdminSpa.generated.ts"
```

Cross-compile with `--target=bun-linux-x64` (or `bun-linux-arm64`, `bun-darwin-arm64`). Expect a
binary over 100 MB: the Bun runtime plus about 120 admin assets (fonts, images, JS).

### 7. Verify the binary on its own

Copy the binary to an empty directory (or move `node_modules` aside) so nothing resolves from
disk, then:

```bash
MONGO_URI=... BETTER_AUTH_SECRET=... PUBLIC_API_URL=http://localhost:4000 ./dist/<appName> &
curl -sf localhost:4000/health
curl -sf -o /dev/null -w '%{http_code}\n' localhost:4000/console              # 200
curl -sf localhost:4000/console/app-config.json
curl -sf -o /dev/null -w '%{http_code}\n' localhost:4000/console/_expo/static/js/web/<entry>.js  # 200
curl -s -X POST localhost:4000/mcp -H 'content-type: application/json' \
  -H "authorization: Bearer mcp_..." \
  -d '{"jsonrpc":"2.0","id":1,"method":"tools/list"}'
```

Seed an admin, log in at `/console`, mint a service token with `POST /mcp/service-tokens`, run
`tools/list` with it, and confirm a row appears in **MCP request log** after a `tools/call`. Save a screenshot of the MCP admin
group to `/opt/cursor/artifacts/` when that directory exists.

### 8. Expose it

Never put `localhost:4000` on the internet by port-forwarding. Follow
`docs/how-to/expose-mcp-server-safely.md`: a named Cloudflare Tunnel, Cloudflare Access on
`/admin`, plus `/console` and `/api/auth` when every OAuth approver is in the Access policy
(never `/mcp`, `/.well-known`, or `/oauth/*`), OAuth `issuer`
equal to the tunnel hostname, rate limiting on with `trustProxy` set for the proxy in front.

## Done when

- `./dist/<appName>` starts with only Mongo and env vars, and the step 7 checks pass.
- `/console` shows the MCP admin group, and a service token minted there lists tools.
- With `MCP_OAUTH_ENABLED=true`, Claude.ai's custom connector completes the consent flow
  against the public hostname.

## Pitfalls

- A quick tunnel (`trycloudflare.com`) hostname changes on every run. OAuth discovery and
  registered clients break; use a named tunnel.
- `dynamicClientRegistration` with an empty `allowedRedirectHosts` throws at startup on purpose.
- Non-admin users can open `/console/oauth/consent` to approve a connection; the rest of the
  console shows them the forbidden page. That is expected.
- Run one binary per Mongo database.
- The OAuth consent routes trust the Better Auth session cookie because `BetterAuthApp`
  mounts its session middleware before `TerrenoApp` adds `/oauth/*`. Register `BetterAuthApp`
  on the same `TerrenoApp`; do not mount it on a separate Express app.
