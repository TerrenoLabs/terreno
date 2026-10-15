---
category: Deprecated
---

`terreno-mcp-local` adds `get_client_state`, which inspects either the RTK Query store or a SyncDB client and returns a `layer` field (`rtk`, `syncdb`, `syncdb+rtk`, or `none`). `get_rtk_state` is now a deprecated alias for one release and returns the same wrapped response. `terreno state` uses the new tool.
