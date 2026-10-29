---
category: Changed
---

`@terreno/admin-frontend` renders a nested (non-array) object field that has `items` in its admin config as a titled group with one control per subfield, instead of a JSON text box. Groups recurse to any depth and also render inside array-of-subdocument items. `Mixed`, `Map`, and objects without `items` keep the JSON editor, and a field `widget` still takes precedence. Subfield test IDs use the dotted path (`admin-field-tasks.enabled`, group `admin-field-group-tasks`); inside array items, nested groups are prefixed with the array key and item index (`admin-field-servers.0.media.port`). New array items and create-mode nested objects start from subfield defaults and leave out system fields and enums, refs, dates, and `Mixed` subfields that have no default. Save still sends the whole object for the field.
