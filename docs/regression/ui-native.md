# Native UI regression suite

Area: NATIVE
Owner: Josh Gachnang
Last full run: never

Walk these cases on a fresh install on a physical phone. Delete the app first so the operating
system asks for each permission again. NATIVE-001 and NATIVE-002 need a development build,
because Profile shows "Send test push" only in development builds; the others run on either.

| ID | Case | Steps | Expected | Platforms | Automated by | Added |
| --- | --- | --- | --- | --- | --- | --- |
| NATIVE-001 | Allowing notifications enables push | On a fresh install of a development build, sign in, tap Allow on the system notification prompt, open Profile, tap "Send test push", then lock the phone | The system prompt appears once, right after sign-in. A test notification shows on the lock screen within 1 minute | iOS, Android | manual | e2e-and-regression-testing |
| NATIVE-002 | Denying notifications registers no device | On a fresh install of a development build, sign in as an account with no other signed-in devices, tap Don't Allow on the system notification prompt, then open Profile and tap "Send test push" | The app keeps working on Todos. Profile shows "No registered push tokens for this account." under the push button, and the prompt does not reappear on the next launch | iOS, Android | manual | e2e-and-regression-testing |
| NATIVE-003 | A consent signature can be drawn with a finger | On a fresh install, sign in as an account that has never accepted the consent forms. On each consent screen that asks for a signature, draw a signature with one finger, then accept every form | The stroke follows the finger and the screen does not scroll while drawing. After the last form the app opens on Todos, and after a force quit and reopen no consent screen shows again | iOS, Android | manual | e2e-and-regression-testing |
| NATIVE-004 | The keyboard does not cover a focused field | Signed in on a phone in portrait: open Profile, scroll to the "API Key" field in the Gemini API Key card, and tap it | The keyboard opens and the focused field stays visible above it, with its "API Key" label on screen | iOS, Android | manual | e2e-and-regression-testing |
