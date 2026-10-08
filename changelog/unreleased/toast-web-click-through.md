---
category: Fixed
---

On web, an open toast no longer blocks clicks on the rest of the page at the same height.
The toast's `SafeAreaView` and the `Toast` layout wrapper span the full width (up to 900px)
around the visible toast and swallowed clicks there. Both now use `pointerEvents: "box-none"`,
so only the visible toast is interactive.
