> **SyncMutationOutcome** = \{ `ack`: [`SyncAck`](../interfaces/SyncAck.md); `type`: `"ack"`; \} \| \{ `nack`: [`SyncNack`](../interfaces/SyncNack.md); `type`: `"nack"`; \}

Outcome of applying a sync mutation: an ack for the client, or a typed nack.
