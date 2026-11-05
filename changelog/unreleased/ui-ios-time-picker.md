---
category: Fixed
---

`@terreno/ui`: the `DateTimeActionSheet` time wheels show their numbers on physical iPhones. iOS now uses UIPickerView's natural 216pt height. The forced 104pt height looked fine in the simulator but showed empty rows on devices. Wheel items also take the theme's text color on iOS, not just Android, so they're no longer white on white on a dark-mode phone.
