---
category: Added
---

- `ListDetailLayout`, `ListDetailIndex`, and `useListDetail` in `@terreno/ui`: a route-driven list/detail layout for an Expo Router group's `_layout.tsx`, like a mail inbox. Phones push the detail route; when the layout is at least 768px wide (tablets, wide browsers, inside a sidebar), the list stays in a left pane and the detail opens beside it. The open item lives in the URL, so deep links and back work, and it stays open across rotation and resize. See `docs/how-to/build-list-detail-screens.md`. `SplitPage` is unchanged; its docs now point new screens to `ListDetailLayout`.
- `Box` `accessibilityState.selected`. A clickable row sends it as `aria-current="true"` on web; a selectable `accessibilityRole` (`tab`, `option`, `row`, ...) sends `aria-selected`.
