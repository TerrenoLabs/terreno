---
category: Changed
---

`terraform/` now holds only reusable modules. Terreno's own GCP deployment (example backend, jobs worker, hosted MCP server) moved to `infra/flourish/`, which uses the shared modules through a symlink; CI stages a dereferenced copy for Infra Manager. No infrastructure changes: resource addresses are unchanged.
