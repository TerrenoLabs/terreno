---
category: Fixed
---

`create-terreno-app` did nothing when run through its package bin (`bunx create-terreno-app`,
`npx create-terreno-app`): the entry check compared the module URL with the unresolved
`node_modules/.bin` symlink. It now resolves the path first.
