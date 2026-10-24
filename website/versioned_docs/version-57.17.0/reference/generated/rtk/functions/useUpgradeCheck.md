> **useUpgradeCheck**(`options?`): `UseUpgradeCheckResult`

Checks the running app build number against the backend's VersionConfig
thresholds and returns the current upgrade status.

- `isRequired` — the build is below the required threshold; the caller
  should block the UI (e.g. with `UpgradeRequiredScreen`).
- `isWarning` — the build is below the warning threshold; the caller
  can render a dismissible `Banner` or similar prompt.

The polling interval is server-driven: the first successful `/version-check`
response returns `pollingIntervalMs` from the backend's VersionConfig and the
hook uses that value for all subsequent intervals. Pass `pollingIntervalMs` in
options as a local fallback that is active until the first server response
arrives. Pass `recheckOnForeground` to also re-check when the app/tab
returns to the foreground.

## Parameters

### options?

`UseUpgradeCheckOptions`

Optional fallback polling interval and foreground re-check configuration.

## Returns

`UseUpgradeCheckResult`

Current upgrade status, messages, and an `onUpdate` callback.
