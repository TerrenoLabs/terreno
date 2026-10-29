---
category: Fixed
---

`GET /oauth/authorize` accepts a loopback `redirect_uri` (`localhost`, `127.0.0.1`, or `[::1]`) on any port when a registered URI has the same scheme, host, path, and query (RFC 8252 §7.3). The authorization code is returned to the port the client sent. Those three hosts do not match each other, and every other redirect URI must still match exactly.
