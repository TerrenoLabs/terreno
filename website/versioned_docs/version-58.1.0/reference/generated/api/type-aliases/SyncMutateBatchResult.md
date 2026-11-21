> **SyncMutateBatchResult** = \{ `ack`: [`SyncAck`](../interfaces/SyncAck.md); `type`: `"ack"`; \} \| \{ `nack`: [`SyncNack`](../interfaces/SyncNack.md); `type`: `"nack"`; \}

One result per PROCESSED mutation in a batch, in request order.
