---
category: Added
---

File uploads can be turned off with the `file-uploads` feature flag. `POST /files/upload`, document storage uploads, and chat attachments return 403 when the flag is off. The example app hides the upload controls. A missing flag leaves uploads enabled.
