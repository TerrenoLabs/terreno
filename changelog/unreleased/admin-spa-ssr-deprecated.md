---
category: Deprecated
---

`@terreno/admin-spa` `rewriteIndexHtml` and `injectBaseGlobal` are deprecated: the server-rendered build has no `index.html`, and `app/+html.tsx` writes `window.__ADMIN_SPA_BASE__` itself. They will be removed in the next major release.
