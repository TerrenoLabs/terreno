# Preview a component demo

Open a component demo and change the shareable query. The preview controls sit in the
navigation header on demo and dev component routes: dropdowns for theme, viewport, and
background, plus a settings button (sliders icon) that opens a modal for right-to-left,
reduced motion, locale, and the share query. In windows narrower than 768px every
preview control moves into that modal; the Dev/Demo mode link stays in the header. `?embed=1` applies the same query and hides
the controls.

```text
/demo/Button?theme=dark&viewport=375&background=inverse&locale=en-US&rtl=1&reducedMotion=1
```

| Query | Values |
| --- | --- |
| `theme` | `light` (default) or `dark` (canonical dark role remap) |
| `viewport` | `full` (default), `320`, `375`, `1024`, `1280` |
| `background` | `default`, `inverse`, `transparent` |
| `locale` | Passed to components that already read a locale, such as consent |
| `rtl` | `1` sets document direction to `rtl` on web |
| `reducedMotion` | `1` sets `data-reduced-motion="1"` on the document element |

Reload keeps the query. The settings modal shows the current query when any value is not the default. Choosing a control's default removes that key from the URL. Leaving the component route restores the app theme and, on web, document direction and reduced motion. Custom palettes stay on `/palette`.
