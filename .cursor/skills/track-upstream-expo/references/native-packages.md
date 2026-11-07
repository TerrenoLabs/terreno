# Native packages that change the EAS fingerprint

Update these **only** on a `release-*` Expo SDK branch. A bump here changes
native binaries. Expo Updates / OTA stay valid only while this set is frozen
on master.

Source of versions: root `package.json` `catalog`. Apps must keep `"catalog:"`.

## Always (catalog names)

| Package | Why it is native |
| --- | --- |
| `react-native` | Core native runtime |
| `react-native-gesture-handler` | Native gesture view |
| `react-native-reanimated` | Native worklets / UI runtime |
| `react-native-worklets` | Required peer of Reanimated on current SDKs |
| `react-native-screens` | Native navigation screens |
| `react-native-safe-area-context` | Native safe-area module |
| `react-native-webview` | Native webview |
| `react-native-svg` | Native SVG |
| `react-native-drawer-layout` | Native drawer |
| `@react-native-async-storage/async-storage` | Native storage |
| `@react-native-community/datetimepicker` | Native picker |
| `@react-native-community/slider` | Native slider |
| `@react-native-picker/picker` | Native picker |
| `@sentry/react-native` | Native SDK |
| `@shopify/flash-list` | Native list |
| `@shopify/react-native-skia` | Native Skia |
| `@stripe/stripe-react-native` | Native Stripe SDK + config plugin |
| `react-native-purchases`, `react-native-purchases-ui` | Native RevenueCat SDK (bump together) |
| `expo` and every `expo-*` / `@expo/*` / `babel-preset-expo` already in the catalog | SDK-aligned native or config-plugin packages |
| `react`, `react-dom`, `react-test-renderer`, `@types/react` | SDK-coupled JS, not native, but must move with RN |

## Also bump when already in the catalog

Any other `react-native-*` or `@react-native-*` catalog entry. Scan:

```bash
bun -e 'const p=require("./package.json"); console.log(Object.keys(p.catalog).filter(k=>/react-native|^@react-native|^@shopify\/(flash-list|react-native)|@sentry\/react-native|^expo($|-)|@expo\//.test(k)).sort().join("\n"))'
```

## Leave off this train

JS-only catalog entries (`luxon`, `mongoose`, `axios`, `zod`, and similar).
Those can move on master patches without a new binary.

## How to choose the version

1. After `npx expo install expo@<probed> --fix` in `example-frontend` (and
   `demo` / `admin-spa` if their manifests diverge), copy the resolved versions
   into the root catalog.
2. For a listed package Expo did not touch, `npm view <pkg> version` and try
   that version. Revert that one package if compile or expo-doctor fails.
3. One catalog pin per package. Never split `example-frontend` vs `demo`.
