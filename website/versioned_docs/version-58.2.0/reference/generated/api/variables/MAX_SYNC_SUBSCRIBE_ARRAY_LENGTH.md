> `const` **MAX\_SYNC\_SUBSCRIBE\_ARRAY\_LENGTH**: `100` = `100`

C8: maximum entries accepted in a single `sync:subscribe`/`sync:unsubscribe`
`collections` array — checked BEFORE iterating so an oversized array is rejected
with no per-entry work.
