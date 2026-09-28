# Preview a component demo

Open a component demo and change the shareable query. The preview bar is on demo and
dev component routes. `?embed=1` applies the same query and hides the bar.

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

Reload keeps the query. Choosing a control's default removes that key from the URL. Leaving the component route restores the app theme and, on web, document direction and reduced motion. Custom palettes stay on `/palette`.
