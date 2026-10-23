---
category: Fixed
---

`BetterAuthApp` stores Better Auth users, accounts, sessions, and verifications in the mongoose connection's database (the `dbName` passed to `mongoose.connect`) instead of the connection string's default database. Apps that connect with a `dbName` different from the URI's database should copy the `user`, `account`, `session`, and `verification` collections into the `dbName` database when upgrading.
