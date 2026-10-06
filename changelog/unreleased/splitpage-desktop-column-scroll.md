---
category: Fixed
---

Web `SplitPage` desktop child columns scroll vertically again. The corner radius and clip sit on the pane, so `overflow: hidden` no longer blocks the column `ScrollView`. A child with `height: "100%"` stays within the visible pane and can scroll internally. `desktopChildrenMinWidth` horizontal scrolling, the list column, the narrow pagers, and native `SplitPage` are unchanged.
