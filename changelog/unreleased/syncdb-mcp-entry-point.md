---
category: Breaking
---

`@terreno/syncdb`: `useMCPTools` (and `MCPToolInfo`, `UseMCPToolsOptions`, `UseMCPToolsResult`) moved from `@terreno/syncdb/app` to the new `@terreno/syncdb/mcp` entry point. Change `import {useMCPTools} from "@terreno/syncdb/app"` to `import {useMCPTools} from "@terreno/syncdb/mcp"`. The hook imports the optional `@modelcontextprotocol/client` peer at the top level, so exporting it from `/app` broke every app that imported `/app` without that package installed, including apps scaffolded by `create-terreno-app`, which import `installDevConsoleLogger` from `/app`.
