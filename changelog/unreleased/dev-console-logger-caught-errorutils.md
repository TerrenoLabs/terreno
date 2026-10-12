---
category: Fixed
---

`installTerrenoDevConsoleLogger` no longer logs `Requiring unknown module "<id>"` on the first lazy component load on web (for example `ConsentNavigator` after login). Metro reports the missing split-bundle module to `ErrorUtils` while Expo's web `import()` probes it, and Expo then catches the rethrown error and loads the bundle. The logger now records an `ErrorUtils` error only after the previous handler consumes it. An error that is rethrown and never caught is still logged by the window listeners, and unhandled rejections now include the `Error` stack.
