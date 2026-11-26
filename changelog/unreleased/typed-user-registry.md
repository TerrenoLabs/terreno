---
category: Added
---

`@terreno/api` apps register their user type once with `TerrenoRegister` and get a typed `user` in modelRouter actions, query filters, permissions, and hooks, with no `as unknown as UserDocument` cast. `@terreno/api/expressUser` types `req.user`, and `TerrenoUserModel` / `PassportUserModel` let any Mongoose user model be passed to a `userModel` option.
