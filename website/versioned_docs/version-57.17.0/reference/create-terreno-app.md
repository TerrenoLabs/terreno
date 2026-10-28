# create-terreno-app

Unscoped npm CLI that writes a deployable Terreno backend + Expo frontend to disk.

Operator walkthrough (Mongo replica set, seed, SDK, web, deploy): [Create a Terreno app](../how-to/create-a-terreno-app.md). First-run tutorial: [Getting started](../tutorials/getting-started.md).

## Install

```bash
bunx create-terreno-app my-app --display-name "My App"
```

npm (note the `--` before flags):

```bash
npm create terreno-app my-app -- --display-name "My App"
```

The published package name is `create-terreno-app`. Generated `@terreno/*`
dependencies pin `^<create-terreno-app version>`.

## CLI

```bash
bunx create-terreno-app <appName> --display-name <string> [--description <string>] [--mcp-server-url <url>] [--yes]
```

| Flag | Required | Default |
| --- | --- | --- |
| `appName` (positional) | yes | kebab-case (`^[a-z][a-z0-9-]*$`) |
| `--display-name` | unless `--yes` | derived from `appName` when `--yes` |
| `--description` | no | empty |
| `--mcp-server-url` | no | hosted Terreno MCP URL |
| `--yes` | no | off |

Writes `<cwd>/<appName>/`. Refuses a non-empty target except `.git` / `.gitignore`. Does not run `bun install`, Mongo, or seed.

Printed next steps install, seed, then start the backend. SDK and web run in a second terminal while the backend is up.

The generated Profile tab uses `@terreno/ui` `TapToEdit` with `PATCH /auth/me`. Fonts come from `@terreno/ui`. `app.json` leaves icon/splash/favicon unset. `metro.config.js` pins `jspdf` so Metro can bundle admin PDF export. Generated tsconfigs use no TypeScript 6 deprecated options and no `ignoreDeprecations` (see [TypeScript configuration](../explanation/typescript-configuration.md)). Auth routes use `<Stack.Protected>`.

## Library

`generateAllFiles` returns the file list; `writeScaffold` writes it to disk. The CLI is the only supported way to scaffold an app. MCP `terreno_bootstrap_ai_rules` can add editor rules after the CLI runs.
