---
category: Fixed
---

- `@terreno/admin-frontend`: the Configuration screen shows saved values after a reload when the
  admin shell talks to the API over admin RPC. The RPC values query returned the `{data}` response
  envelope, so every field rendered empty.
