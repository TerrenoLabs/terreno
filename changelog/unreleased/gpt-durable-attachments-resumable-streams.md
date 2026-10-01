---
category: Added
---

- `/gpt/prompt` rejects client-only attachment URLs (`blob:`, `file:`, `content:`, `ph:`) with `400` before streaming. With `fileStorageService` configured, `data:` attachments are uploaded and history stores the storage `url` plus `gcsKey`; later turns send the model signed URLs.
- `/gpt/prompt` saves the turn before streaming, sends a first `{historyId, started: true, streamId}` event, and persists partial reply text about every second with `status: "streaming"`. The finished reply is saved with `status: "complete"`; a failed one keeps its partial text with `status: "error"`.
- New `GET /gpt/histories/:id/stream` re-attaches to an in-flight reply after a reload or remount (`offset` skips text the client already shows). The example app reopens the last chat after a reload and resumes its live reply.
