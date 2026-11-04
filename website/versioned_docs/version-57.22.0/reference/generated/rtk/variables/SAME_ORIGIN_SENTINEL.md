> `const` **SAME\_ORIGIN\_SENTINEL**: `"__SAME_ORIGIN__"` = `"__SAME_ORIGIN__"`

Sentinel value for `BASE_URL`. When set in `app.json` `extra.BASE_URL`, the
base URL resolves to the runtime page origin (`window.location.origin`).
Used by same-origin deployments such as the standalone admin SPA.
