# Generate a REST CLI from OpenAPI

Run this from an app repo that already serves `/openapi.json` (Terreno `setupServer` does).

1. Install the CLI: `bun add -g @terreno/cli` (or `bunx @terreno/cli`).
2. Generate the wrapper:

```bash
terreno generate rest-cli \
  --schema http://localhost:4000/openapi.json \
  --out ./tools/app-cli \
  --name myapp \
  --base-url http://localhost:4000
```

3. Call the API:

```bash
cd tools/app-cli
bun ./src/cli.ts list
bun ./src/cli.ts call todo_list --param limit=10 --token "$TERRENO_TOKEN"
bun ./src/cli.ts request GET /todos/{id} --param id=abc --json
```

Auth uses `--token` or `TERRENO_TOKEN`. Base URL uses `--base-url` or `TERRENO_API_URL`, then `servers[0].url` from the spec.

To list or call without generating a package:

```bash
terreno api list --schema http://localhost:4000/openapi.json
terreno api call todo_list --schema ./openapi.json --param limit=10
```

`generate rest-cli` writes `src/cli.ts` that imports `runAppRestCli` from `@terreno/cli`. Point that dependency at the published `@terreno/cli` version in apps outside this monorepo.
