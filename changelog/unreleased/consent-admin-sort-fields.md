---
category: Fixed
---

The admin consent form list loads again. `ConsentFormList` sorts by `-created` (and by its Title, Type, Version, Active, and Order columns), but `ConsentApp`'s `/consent-forms` router did not declare those as `sortFields`, so every list request returned 400 `sort-field-not-allowed`. Both `/consent-forms` and `/consent-responses` now allow sorting by the fields their admin metadata marks sortable; other fields are still rejected.
