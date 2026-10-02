# Responsive design

Terreno apps run on desktop web and native mobile. Responsive behavior follows the workflow, the available viewport, and how important that workflow is on that surface.

The goal is not to make every screen work everywhere. The goal is the best experience on the devices and workflows people actually use. Design specs name the supported breakpoints and the support level for each feature. Implement and test only those behaviors.

Breakpoints are viewport width in points, not a device model and not a physical screen resolution. Browser chrome, a resized window, split screen, and display scaling all change the available width.

## Surfaces

Primary devices define the design target. Support for other devices comes from the breakpoint system.

| Surface | Who it is for | Where it runs | Design target | Role |
| --- | --- | --- | --- | --- |
| Desktop web | People doing data-heavy work | Web, validated in Chrome | 13" laptop at `xl` (≥ 1280pt), such as a MacBook Air 13" | Primary experience. Full functionality, including complex review and multi-panel workflows. |
| Primary mobile | People whose main experience is the phone or tablet | iOS and Android | Large phone / small tablet at native `lg` (600–1023pt), such as a Samsung A11 | Full supported mobile workflows. |
| Reduced mobile | People who need emergency or lightweight access | iOS and Android | Common phones | A reduced set of workflows. Not a replacement for desktop. |

Other browsers are outside the desktop support contract. Do not create a layout for an individual phone or tablet model.

## Support levels

Every feature names one of these levels at each breakpoint it claims.

| Level | Definition | Example |
| --- | --- | --- |
| Fully supported | Designed and tested at this breakpoint. Intended workflows work. | A filter with search, groups, saved filters, and bulk actions on desktop `lg` and `xl`. |
| Supported with adaptation | Still fully usable. Layout or interaction is simpler so it fits. | The same filter on a tighter width becomes one category at a time, or moves advanced options behind an "Advanced filters" action. |
| Functionally available | Essential workflows can be finished. Complexity is intentionally omitted. | On reduced mobile, the filter keeps search and one or two high-value filters. |
| Not supported | Not available, not optimized, or not guaranteed. | The advanced filter below the minimum supported breakpoint. The app may still open. Layout and functionality are not guaranteed. |

### What a feature spec must define

| Item | Required? |
| --- | --- |
| Supported surfaces (desktop web, primary mobile, reduced mobile) | Yes |
| Supported breakpoints (`sm`, `md`, `lg`, `xl`) | Yes |
| Support level at each of those breakpoints | Yes |
| Behavior when a breakpoint is not supported | Yes |
| Layout changes at supported breakpoints | When the layout changes |

## Breakpoints

Tokens are platform-specific. `lg` is not the same width on web and native. The tables and the constants `WEB_BREAKPOINT_MIN_WIDTH` and `NATIVE_BREAKPOINT_MIN_WIDTH` are the same contract. API details: [Media query helpers](../reference/ui.md#media-query-helpers).

### Desktop web

The desktop web app is optimized for desktop. The minimum supported desktop breakpoint is `lg`.

| Category | Token | Viewport | Meaning |
| --- | --- | --- | --- |
| Primary desktop | `xl` | ≥ 1280pt | Full desktop layouts, multi-panel workflows, dense data. |
| Smaller desktop | `lg` | 1024–1279pt | Minimum supported desktop. Collapse secondary content, adjust panels, or simplify controls. Keep core workflows. |
| Below supported desktop | below `lg` | < 1024pt | Not a supported desktop experience. The app may stay reachable. Layouts are not guaranteed. |

On web, `sm` (320) and `md` (375) still classify widths below 1024 so a layout can stay reachable.

Test `xl` fully, including complex layouts and multi-panel interactions. Test `lg` to confirm critical workflows stay usable when space shrinks. Do not do breakpoint-specific testing below `lg`. Degrade gracefully there when it is cheap.

### Native mobile

| Category | Token | Viewport | Meaning |
| --- | --- | --- | --- |
| Extra large | `xl` | ≥ 1024pt | Not a supported mobile layout. Use desktop web where it exists. |
| Large mobile / tablet | `lg` | 600–1023pt | Primary tablet experience. Optimize supported mobile workflows here. |
| Standard mobile | `md` | 375–599pt | Common phone. Supported workflows stay usable. |
| Small mobile | `sm` | 320–374pt | Small phone. Critical workflows stay functional. Extra scrolling or a simpler layout is expected. |
| Below supported mobile | below `sm` | < 320pt | Not supported. The app may stay reachable. Layouts are not guaranteed. |

Test native `lg`, `md`, and `sm` unless the spec says otherwise. Do not do breakpoint-specific testing below `sm`.

A larger mobile screen does not automatically get the desktop layout. Use a breakpoint only when the layout actually changes.

`isSupportedDesktopWidth({width})` is the desktop floor: web `lg` and native `xl`, both 1024pt. Below that, do not ship a desktop multi-panel layout.

## Adapting a layout

### Desktop

Support a primary laptop display, a resized browser window, split screen, and a smaller window that is still inside `lg` or `xl`. Keep the workflow as width drops inside that range.

When width drops:

- Collapse secondary panels.
- Allow horizontal scrolling for a dense table.
- Move secondary actions into an overflow menu.
- Reduce spacing before removing content.

Do not shrink content until it is unreadable, compress a layout into a strip, or hide a critical workflow with no other way to reach it.

### Native

Mobile layouts favor finishing the task over matching desktop feature parity.

Reduced mobile, when a desktop workflow is too complex:

- Simplify the workflow.
- Reduce the available actions.
- Keep the high-value, time-sensitive tasks.
- Send people to desktop when the workflow needs it.

Do not recreate a desktop layout on mobile, support every desktop workflow, show a dense table or a multi-panel layout, or require a lot of horizontal scrolling.

Primary mobile should stay clear, readable, touch-friendly, and focused on the supported workflows.

## Checklist

Before building a new experience, answer these:

1. Is this desktop-only, mobile-only, or both? Is the workflow required on reduced mobile, or only on primary mobile?
2. What is the minimum supported width? When space decreases, does content collapse, stack, scroll, or hide?
3. What is the primary goal, which information is essential, and which actions are secondary?
4. Does this need a breakpoint, or a mobile variant of a component? Does it match an existing responsive pattern?

## Framework component audit

Audited against this policy. Pixel cutoffs that were not a breakpoint token were moved onto `isSupportedDesktopWidth`.

| Component | Result |
| --- | --- |
| `Box` responsive props (`sm` / `md` / `lg` / `xl`) | Compliant. One shared dimension listener. The largest matching token wins. |
| `DashboardGrid` | Compliant. Column counts follow `sm`, `md`, and `lg` (`xl` uses the `lg` count). |
| `SplitPage` (web) | Compliant. Side-by-side layout follows `isNarrowViewport()` unless the caller passes `narrowBelowWidth`. |
| `SplitPage` (native) | Compliant. Stacked list/detail at every native width, including tablet `lg`. Native tablets do not inherit the desktop split. |
| `Modal` | Compliant. Action sheet on native, centered dialog on web. |
| `DataTable` | Partial. Web keeps inline filters. Native collapses filters into one sheet. Horizontal scroll stays on for wide tables, including native, which is more scrolling than reduced mobile should require. |
| `Text` / `Heading` | Compliant. Separate web and native type scales. Type does not shrink again inside `sm`. |
| `Card` | Fixed. Container and display variants used a 768pt cutoff. They now follow the desktop floor. |
| `MarkdownEditor` | Fixed. Side-by-side edit/preview used a 768pt cutoff. It now follows the desktop floor. |
| `AdminShell` | Fixed. The sidebar became a hamburger drawer below 768pt. It now does that below the desktop floor. |
| `AdminFilterDrawer` | Fixed. The bottom sheet used the same 768pt cutoff. It now follows the desktop floor. `ADMIN_FILTER_MOBILE_BREAKPOINT` is 1024. |
| `DateTimeField` | Partial. Inline controls switch to an action sheet when the parent is narrower than 395pt, and also when `isNarrowViewport()` is true. 395pt is the field's own minimum, not a viewport token. |
| `Image` (`fullWidth`) | Gap. Width is read from `Dimensions` once at module load, so it does not track resize or rotation. |
| `SideDrawer` | Partial. Width is 40% on web and 95% on native, by platform rather than by breakpoint token. |

Do not add a new raw pixel cutoff. Use `Box` breakpoint props, `useResponsiveBreakpoint`, or `isSupportedDesktopWidth`.
