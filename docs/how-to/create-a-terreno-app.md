# Create a Terreno app

Scaffold a deployable full-stack Terreno app (backend, Expo frontend, seed script, consumer `Dockerfile`, CI, MCP config) with one non-interactive command.

The CLI writes files only — it does not run `bun install`, start MongoDB, or seed data.

## Prerequisites

- [Bun](https://bun.sh/) (or Node/npm for `npm create`)
- An empty target directory (see [Non-empty targets](#non-empty-targets))
- MongoDB as a **replica set** before running the backend (see [Start MongoDB](#3-start-mongodb-replica-set))

## 1. Scaffold the app

From the parent directory where you want `<appName>/`:

```bash
bunx create-terreno-app my-app --display-name "My App"
```

npm alternative (note the `--` before flags):

```bash
npm create terreno-app my-app -- --display-name "My App"
```

Derive the display name from `appName` when you do not need a custom title:

```bash
bunx create-terreno-app my-app --yes
```

Optional flags:

| Flag | Required | Default |
| --- | --- | --- |
| `appName` (positional) | yes | — kebab-case directory and package name (`^[a-z][a-z0-9-]*$`) |
| `--display-name` | unless `--yes` | derived from `appName` when `--yes` |
| `--description` | no | empty |
| `--mcp-server-url` | no | `https://mcp.terreno.app` |
| `--yes` | no | off |

The CLI creates `<cwd>/<appName>/`. Package source: [`create-terreno-app/`](https://github.com/TerrenoLabs/terreno/tree/master/create-terreno-app) in the Terreno monorepo.

## Non-empty targets

The CLI refuses to write when the target already contains anything other than `.git` or `.gitignore`. It exits non-zero and leaves existing files unchanged.

Initializing git first is fine:

```bash
mkdir my-app && cd my-app && git init
cd .. && bunx create-terreno-app my-app --yes
```

## Generated layout

| Path | Purpose |
| --- | --- |
| `backend/` | Express/Mongoose API (`@terreno/api`, Better Auth, admin, sync) |
| `frontend/` | Expo universal app (`@terreno/ui`, `@terreno/syncdb`, `@terreno/rtk`) |
| `Dockerfile` | Consumer backend image (`backend/` only — not the Terreno monorepo) |
| `.dockerignore` | Excludes local env secrets, dependencies, and build output from the image context |
| `backend/.env`, `frontend/.env` | Gitignored local-dev defaults (written on scaffold) |
| `backend/.env.example`, `frontend/.env.example` | Committed templates for production and export |
| `.github/workflows/` | Backend and frontend CI |
| `.cursor/mcp.json`, `.cursorrules`, `CLAUDE.md` | Agent tooling |
| `README.md` | App-specific next steps and deploy links |

Generated `@terreno/*` dependencies pin to `^<create-terreno-app version>` at scaffold time.

## 2. Install dependencies

```bash
cd my-app
(cd backend && bun install)
(cd frontend && bun install)
```

## 3. Start MongoDB (replica set)

Sync and realtime require a replica set (even a single-node dev set). See the [deployment baseline](../explanation/deployment-baseline.md).

From the generated app root, run this local single-node example after `mongod` is available:

```bash
mkdir -p .devdata/mongo
mongod --replSet rs0 --port 27017 --bind_ip 127.0.0.1 --dbpath .devdata/mongo &
# Initiate once (use node for the driver command if bun errors on bson):
node -e 'import("mongodb").then(async ({MongoClient})=>{const c=new MongoClient("mongodb://127.0.0.1:27017/?directConnection=true");await c.connect();await c.db("admin").command({replSetInitiate:{_id:"rs0",members:[{_id:0,host:"127.0.0.1:27017"}]}}).catch(()=>{});await c.close();})'
```

The scaffold sets `MONGO_URI` in `backend/.env` to `mongodb://127.0.0.1:27017/<app_name>?replicaSet=rs0` (hyphens in `appName` become underscores in the database name). Copy from `backend/.env.example` when you need production values.

## 4. Seed login users

With MongoDB running as a replica set:

```bash
(cd backend && bun run seed)
```

Creates:

| Email | Password | Notes |
| --- | --- | --- |
| `test@example.com` | `testpassword123` | Standard user |
| `admin@example.com` | `testpassword123` | Admin user |

Seed behavior and flags: [Seed a database](seed-a-database.md). Better Auth setup: [Configure Better Auth](configure-better-auth.md).

## 5. Run the stack

Terminal 1 — API (default port `4000`):

```bash
(cd backend && bun run dev)
```

Health check: `curl http://localhost:4000/health` → `"healthy":true`.

Terminal 2 — web UI (port `8082`):

```bash
(cd frontend && bun run sdk)   # after backend is up; regenerates OpenAPI hooks
(cd frontend && bun run web)
```

Open `http://localhost:8082` and sign in as `test@example.com` / `testpassword123`.

`frontend/.env` defaults `EXPO_PUBLIC_API_URL` to `http://localhost:4000`. For production web builds, set it **before** export — see [Build for web](build-for-web.md).

## Deploy

Read the [deployment baseline](../explanation/deployment-baseline.md) first.

**Backend:** the root `Dockerfile` builds only `backend/` on `oven/bun`, listens on `PORT` (default `8080` in the image), binds `0.0.0.0`, and exposes `GET /health`. It does not copy Terreno monorepo packages.

```bash
docker build -t my-app-backend .
docker run --rm -p 8080:8080 \
  -e MONGO_URI='mongodb+srv://...' \
  -e BETTER_AUTH_SECRET='...' \
  -e BETTER_AUTH_URL='https://api.example.com' \
  my-app-backend
```

Cloud Run concepts and commands: [Deploy backend to Cloud Run](deploy-backend-to-cloud-run.md). That guide targets Terreno's monorepo example; for a generated app, keep the root `Dockerfile`, port `8080`, and Better Auth variables shown here. The generated backend throws if `BETTER_AUTH_SECRET` is unset. `GET /users` list and read require an admin.

**Frontend:** [Build for web](build-for-web.md) — set `EXPO_PUBLIC_API_URL` at export time.

## Monorepo examples (secondary)

To explore Terreno itself without scaffolding a new app, clone the [Terreno monorepo](https://github.com/TerrenoLabs/terreno) and use `example-backend` / `example-frontend`. See [Getting started](../tutorials/getting-started.md#explore-the-terreno-monorepo-examples).
