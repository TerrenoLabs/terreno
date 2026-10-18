# create-terreno-app

Generates a full-stack Terreno application scaffold (backend, frontend, CI, MCP
config, consumer Dockerfile, and env examples).

## Install

```bash
bunx create-terreno-app my-app --display-name "My App"
```

npm equivalent:

```bash
npm create terreno-app my-app -- --display-name "My App"
```

Docs: [Create a Terreno app](https://github.com/TerrenoLabs/terreno/blob/master/docs/how-to/create-a-terreno-app.md)
and [CLI reference](https://github.com/TerrenoLabs/terreno/blob/master/docs/reference/create-terreno-app.md).

## CLI

| Flag | Required | Default |
| --- | --- | --- |
| `appName` (positional) | yes | kebab-case directory and package name |
| `--display-name` | unless `--yes` | derived from `appName` when `--yes` |
| `--description` | no | empty |
| `--mcp-server-url` | no | hosted Terreno MCP URL |
| `--yes` | no | off |

The CLI writes `<cwd>/<appName>/` and refuses to overwrite a target that already
contains anything other than `.git` or `.gitignore`. It does not run
`bun install` or seed scripts.

## Library exports

- `generateAllFiles` — returns the scaffold file list
- `writeScaffold` — writes the scaffold to disk (used by the CLI)
