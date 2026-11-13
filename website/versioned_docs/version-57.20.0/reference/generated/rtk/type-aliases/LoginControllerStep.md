> **LoginControllerStep** = `"checking"` \| `"login"` \| `"twoFactor"` \| `"signedIn"`

- `checking`: looking for a live session; show a spinner.
- `login`: show the login screen.
- `twoFactor`: show the inline two-factor challenge.
- `signedIn`: `onSignedIn` ran; the app is navigating away.
