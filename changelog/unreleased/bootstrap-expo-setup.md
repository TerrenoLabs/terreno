---
category: Added
---

`create-terreno-app --expo` and `terreno bootstrap app --expo` set up Expo after writing the app: they install the frontend dependencies, sign in with `eas login` (or use `EXPO_TOKEN`), create the EAS project with `eas init`, and set up Android and iOS build credentials with `eas credentials:configure-build`. `--expo-account` picks the owning Expo account and `--expo-platform` limits the credentials step. `--bundle-id` writes the iOS bundle identifier and Android package into `app.json`. Generated apps now include `frontend/eas.json` with `development`, `preview`, and `production` build profiles. Without `--expo` the scaffold is unchanged apart from that file.
