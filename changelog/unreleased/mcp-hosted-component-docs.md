---
category: Fixed
---

The hosted Terreno MCP image now builds the full `@terreno/ui` props data and the versioned docs search corpus, so `terreno_get_component_docs` knows every component and `terreno_search_docs` searches versioned docs instead of only the bundled resources. The `terreno://docs/patterns` resource now shows SyncDB collection CRUD instead of the deprecated RTK pattern.
