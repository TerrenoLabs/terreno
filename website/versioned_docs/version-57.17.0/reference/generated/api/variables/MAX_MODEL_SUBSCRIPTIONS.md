> `const` **MAX\_MODEL\_SUBSCRIPTIONS**: `50` = `50`

Caps on per-socket subscriptions. Prevents a malicious or buggy client from
exhausting server memory by opening unbounded subscriptions.
