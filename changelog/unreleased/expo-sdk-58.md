---
category: Breaking
---

- Terreno 58 targets Expo SDK 58 (`~58.0.14`), React Native `0.88.0`, and React `19.3.0`. `@terreno/ui` peers `react-native` `0.88.0`. Native catalog moves with the SDK: `react-native-gesture-handler` `~3.3.0`, `react-native-reanimated` `4.7.1` + `react-native-worklets` `0.13.0`, `react-native-screens` `~4.30.0`, `react-native-webview` `14.0.1`, `@sentry/react-native` `~8.28.0`, `@shopify/flash-list` `2.3.2`, `@shopify/react-native-skia` `2.14.0`. Rebuild dev clients and store binaries.
- Expo Router 58: set `export const unstable_settings = {initialRouteName}` on the layout instead of passing `initialRouteName` to `<Slot>` / navigators. `SidebarNavigation` ignores the prop.
- Expo Router 58 static rendering: a custom `app/+html.tsx` must render `headNodes` and `bodyNodes` from `useServerDocumentContext()` (`expo-router/html`), or exported pages ship without their JavaScript. `example-frontend` is updated.
- React Native 0.88 generated types: type refs as `ViewInstance`, `TextInstance`, `ScrollViewInstance`, and `TextInputInstance` (`Box.scrollRef`, `TextField.inputRef`, `Text` `ref`).
- `create-terreno-app` scaffolds Expo `~58.0.14`, React Native `0.88.0`, and React `19.3.0`.
