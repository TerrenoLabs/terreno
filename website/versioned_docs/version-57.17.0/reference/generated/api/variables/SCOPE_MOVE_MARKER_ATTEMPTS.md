> `const` **SCOPE\_MOVE\_MARKER\_ATTEMPTS**: `3` = `3`

C4: how many times a scope-move marker insert is attempted before giving up. Losing the
marker loses the old stream's tombstone forever (the exact race C4 exists to eliminate),
so a transient failure (replica step-down, transient network error) is retried.
