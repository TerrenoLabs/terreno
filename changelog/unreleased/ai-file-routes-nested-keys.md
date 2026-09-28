---
category: Fixed
---

`GET` and `DELETE /files/*gcsKey` find uploads by their full key. Express 5 passes the wildcard as path segments, so a key with slashes, such as the `uploads/<userId>/<ms>-<name>` key every upload gets, returned 404.
