### @terreno/syncdb

Use SyncDB for collection CRUD. Reads come from the local TinyBase store; writes
use `useMutate` or `client.mutate` and enter the durable outbox.

When debugging a running app, invoke the `debug-syncdb-with-mcp` skill and use
the `terreno` CLI (or the same tools over the local Terreno MCP) before arbitrary
runtime evaluation. The CLI needs no MCP configuration:

1. Create the client with `debug: true` in development.
2. Run `terreno state` (`get_syncdb_state`) for entities, tombstones, pending mutations, outbox,
   conflicts, cursors, streams, repair markers, status, and debug events.
3. Run `terreno syncdb snapshot capture` (`syncdb_snapshot`) before and after reproduction,
   then `terreno syncdb snapshot compare`.
4. Set `TERRENO_MCP_EVAL=1` only when state changes are required; use
   `terreno syncdb action` (`syncdb_action`) for mutations, local-only edits, outbox flush, reconcile,
   resync, conflict resolution, retries, offline simulation, and snapshot merge.

Sensitive fields are redacted from MCP responses. Direct local edits and snapshot
merges bypass normal mutation/outbox semantics; use them only to reproduce or
repair local-state problems.

Full workflow: `docs/how-to/debug-with-mcp.md`. API details:
`docs/reference/syncdb.md` and `docs/reference/mcp-server.md`.
