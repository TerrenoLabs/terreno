# Admin regression suite

Area: ADMIN
Owner: Josh Gachnang
Last full run: never

Walk these cases with an admin account on web and a second, non-admin account signed in on a
phone. Both run against the same deployed example-backend.

| ID | Case | Steps | Expected | Platforms | Automated by | Added |
| --- | --- | --- | --- | --- | --- | --- |
| ADMIN-001 | An admin edit reaches the owner's phone live | A non-admin user is signed in on a phone with the Todos tab open and one todo titled "Buy milk". On web, an admin opens the Admin Panel, opens that todo, changes its title to "Buy oat milk", and saves | Within 10 seconds, without pulling to refresh or reopening the app, the phone's Todos list shows "Buy oat milk" | iOS, Android | manual | e2e-and-regression-testing |
| ADMIN-002 | A published announcement shows on a phone | A non-admin user is signed in on a phone. On web, an admin creates and publishes an announcement from the Admin Panel, then the user force quits and reopens the app | The announcement shows once on the phone with the admin's title and body, and does not show again after it is dismissed and the app is reopened | iOS, Android | manual | e2e-and-regression-testing |
