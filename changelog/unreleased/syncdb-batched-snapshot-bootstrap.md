---
category: Changed
---

SyncDB bootstraps and reconciles every stream through one `POST /sync/snapshot/batch` request
per round instead of one `GET /sync/snapshot` per stream. A reconnect with nothing new now costs
2 requests however many collections the app syncs. The client sends the next round while it
writes the current one and writes rows in chunks of 500 so the UI keeps responding. Clients fall
back to per-stream paging against servers without the batch route. The web IndexedDB persister
no longer serializes the whole store once per transaction: it serializes once per write.
