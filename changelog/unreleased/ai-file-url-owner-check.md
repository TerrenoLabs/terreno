---
category: Breaking
---

Security: `GET /files/*gcsKey` (`addFileRoutes`, `AiApp` with `gcsBucket`) now requires authentication and returns a signed URL only for the caller's own upload. Before, anyone could get a signed URL for any stored key, and keys are guessable (`uploads/<userId>/<ms>-<name>`). Another user's file, including for an admin, returns 404 like a missing file, so keys cannot be probed. Send the user's session token with the request; an unauthenticated request now returns 401.
