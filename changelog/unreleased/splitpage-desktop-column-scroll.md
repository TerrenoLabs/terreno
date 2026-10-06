---
category: Fixed
---

Web `SplitPage` desktop child columns scroll vertically again. The corner radius and clip sit on the pane, so `overflow: hidden` no longer blocks the column `ScrollView`. A child with `height: "100%"` stays within the visible pane and can scroll internally. Narrow web pager pages use the measured pane height, so that same full-height child can scroll internally while the page still clips its rounded corners. `desktopChildrenMinWidth` horizontal scrolling, the list column, and native `SplitPage` are unchanged.
