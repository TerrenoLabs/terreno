---
category: Changed
---

`@terreno/ui` default `primary500` is `#0C80A7`. `primary300` stays `#40B8E0` and `primary400` stays `#0E9DCD`. Light-mode `surface.primary` still maps to `primary400`. New `surface.primaryDark` maps to `primary500` in light mode and `primary300` in dark mode. Primary `Button` fills use `surface.primaryDark` (`#0C80A7` in light mode, `#40B8E0` in dark mode), including the active fill for variants other than primary and destructive. Dark-mode `border.ai` follows `primary500`, so it is `#0C80A7`. `IconButton`, `Slider`, and `DataTable` still use `surface.primary`.
