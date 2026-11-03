---
category: Fixed
---

`@terreno/api`: admin responses keep ObjectId, Date and other non-plain values intact. `scrubAdminFields` used to copy the own keys of every object it reached, so an ObjectId in an array field (or a bare ObjectId ref) came back as a plain `{i0, i1, i2, i3}` object and a Date became `{}`. It now scrubs only plain objects and Mongoose documents, and never treats a bare ObjectId as a populated document.
