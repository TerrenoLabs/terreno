# SyncDB regression suite

Area: SYNC
Owner: Josh Gachnang
Last full run: never

Walk these cases on a release build on a physical phone, against a deployed example-backend.
Turn the network off with airplane mode, not by stopping the backend, so the operating system
reports the device as offline.

| ID | Case | Steps | Expected | Platforms | Automated by | Added |
| --- | --- | --- | --- | --- | --- | --- |
| SYNC-001 | An offline edit replays after airplane mode | Signed in on a phone with the Todos tab open and one todo, and the same account open on web: turn on airplane mode, mark the todo complete, wait 30 seconds, then turn airplane mode off | The phone shows the todo complete at once while offline. Within 10 seconds of reconnecting, web shows it complete without a reload, and the phone shows no conflict | iOS, Android | manual | e2e-and-regression-testing |
| SYNC-002 | An offline create survives a force quit | Signed in on a phone in airplane mode: create a todo titled "Offline note", force quit the app, reopen it still in airplane mode, then turn airplane mode off | After reopening offline the list still shows "Offline note". After reconnecting it appears on web for the same account within 10 seconds, exactly once | iOS, Android | manual | e2e-and-regression-testing |
| SYNC-003 | Switching accounts on one phone leaks no rows | Signed in on a phone as user A with at least two todos: open Profile, tap "Logout", then sign in as user B, who has no todos | User B's Todos tab is empty, both before and after the first sync completes. None of user A's todos appear at any point | iOS, Android | manual | e2e-and-regression-testing |
