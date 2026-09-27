---
category: Changed
---

- `@terreno/ui`'s `Filter` is now `DropdownPanel`, reflecting that it is a general compositional dropdown (trigger + anchored panel + optional Apply/Clear/Cancel footer), not a filter-only control. `Filter` and `FilterProps` stay exported as deprecated aliases until Terreno 58; the `FilterSelectMenu` / `FilterBoolean` / `FilterAccordion` / `FilterChangesBadge` controls keep their names.
- `DropdownPanel` no longer runs off screen. The panel right-aligns to its trigger when a left-aligned panel would cross the right viewport edge, clamps to an 8px screen margin, flips above the trigger when there is no usable room below, and scrolls its body (footer pinned) when the content is taller than the space available. `align` and `maxPanelHeight` override the automatic behavior, and `computeDropdownPanelLayout` is exported for callers that position their own panels.
- `DropdownPanel` renders through the `TerrenoProvider` portal host on native, so the panel is no longer clipped inside scroll views or cards. Without a host it falls back to the previous inline overlay.
- `DropdownPanel` triggers are now styleable: `triggerVariant` (any `Button` variant), `applyButtonVariant`, `triggerSize` on labeled triggers, `fullWidth`, and `renderTrigger` for a fully custom trigger.
