---
description: "Responsive layout policy — breakpoints, desktop floor, support levels. Use when changing width-dependent UI."
globs: ["ui/**", "admin-frontend/**", "admin-spa/**", "demo/**", "example-frontend/**"]
targets: ["cursor", "copilot", "claudecode", "devin"]
---

# Responsive design

Policy: `docs/explanation/responsive-design.md`. Width tables: `docs/reference/ui.md` (Media query helpers).

Viewport width uses the `sm` / `md` / `lg` / `xl` tokens. Do not target a device model. Do not add a raw pixel cutoff such as 768.

## Desktop floor

`isSupportedDesktopWidth({width})` is the desktop floor: web `lg` and native `xl`, both 1024pt.

- At or above that floor, desktop layouts (multi-panel, persistent sidebar, side-by-side editors) are allowed.
- Below that floor, use the mobile layout. Native `lg` (600–1023pt) stays mobile. Do not promote a tablet to the desktop split.

```typescript
import {isSupportedDesktopWidth} from "@terreno/ui";
import {useWindowDimensions} from "react-native";

const {width} = useWindowDimensions();
const isDesktopLayout = isSupportedDesktopWidth({width});
```

Prefer `Box` props (`smDirection`, `mdPadding`, `lgDisplay`, `xlDirection`) when the change is a style. The largest matching token wins.

## When width drops inside a supported breakpoint

- Collapse secondary panels.
- Move secondary actions into an overflow menu.
- Allow horizontal scrolling for a dense table on desktop.
- Reduce spacing before removing content.

Do not shrink type until it is unreadable, compress a layout into a strip, or hide a critical action with no other way to reach it. On native, do not recreate a desktop multi-panel layout or require a lot of horizontal scrolling.

## Support levels

A new feature names, per breakpoint, one of: fully supported, supported with adaptation, functionally available, not supported. Also name what happens below the minimum supported breakpoint. Implement and test only the levels the spec names.

Desktop tests cover `xl` and `lg`. Native tests cover `lg`, `md`, and `sm`. Widths below those floors need no breakpoint-specific tests; degrade gracefully when it is cheap.
