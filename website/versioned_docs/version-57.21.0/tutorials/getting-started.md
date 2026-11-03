# Getting Started

Create a new Terreno app with the scaffolding CLI, then run it locally.

## Prerequisites

- [Bun](https://bun.sh/) installed
- MongoDB as a **replica set** (required for sync and realtime — see [deployment baseline](../explanation/deployment-baseline.md))

## 1. Scaffold a new app

From an empty parent directory:

```bash
bunx create-terreno-app my-app --display-name "My App"
```

npm alternative:

```bash
npm create terreno-app my-app -- --display-name "My App"
```

This writes `my-app/backend` and `my-app/frontend` plus deploy and agent config. The CLI does not install dependencies or seed data.

Full flag reference, layout, and deploy notes: [Create a Terreno app](../how-to/create-a-terreno-app.md).

## 2. Install dependencies

```bash
cd my-app
(cd backend && bun install)
(cd frontend && bun install)
```

## 3. Start MongoDB

Use Atlas or a local single-node replica set. The scaffolded `backend/.env` points at `mongodb://127.0.0.1:27017/my_app?replicaSet=rs0` (database name derived from `appName`).
Follow [Start MongoDB (replica set)](../how-to/create-a-terreno-app.md#3-start-mongodb-replica-set) for local commands.

## 4. Seed and start the backend

```bash
(cd backend && bun run seed)
(cd backend && bun run dev)
```

Backend runs at `http://localhost:4000`. OpenAPI spec at `/openapi.json`.

Seed users: `test@example.com` and `admin@example.com`, password `testpassword123`.

## 5. Start the frontend

Keep the backend running while generating the SDK.

```bash
(cd frontend && bun run sdk)
(cd frontend && bun run web)
```

Frontend runs at `http://localhost:8082`. Sign in with `test@example.com` / `testpassword123`.

## Explore the Terreno monorepo examples

If you are contributing to Terreno or want reference implementations inside this repository:

```bash
git clone https://github.com/TerrenoLabs/terreno.git
cd terreno && bun run bootstrap
```

| Service | Port | Command (from repo root) |
| --- | --- | --- |
| example-backend | 4000 | `bun run backend:dev` |
| example-frontend web | 8082 | `EXPO_PUBLIC_API_URL=http://localhost:4000 bun run frontend:web` |

The example backend needs `MONGO_URI` (replica set) and auth secrets — see the repository [AGENTS.md](https://github.com/TerrenoLabs/terreno/blob/master/AGENTS.md) (Cursor Cloud section). Seed with `bun run backend:seed` from the repo root.

## Next steps

- [Create a Terreno app](../how-to/create-a-terreno-app.md) — CLI flags, layout, deploy, MCP write path
- [How to create a model](../how-to/create-a-model.md) — Model conventions including required field descriptions
- [How-to guides](../how-to/) — Task-focused guides
- [Reference](../reference/) — Package and API details
