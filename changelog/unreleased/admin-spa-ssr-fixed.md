---
category: Fixed
---

- The admin configuration screen shows stored values again: `useConfigurationApi`'s values query unwraps the API's `{data}` envelope.
- syncdb window hydration no longer lets a REST page overwrite a newer synced entity. REST rows only fill ids the store lacks, and a stored entity at least as new as the fetched one is kept, so a live delta is never skipped.
