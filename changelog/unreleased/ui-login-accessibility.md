---
category: Fixed
---

- `LoginScreen` names each email and password input by its field label for screen readers,
  instead of the generic "Text input field".
- `Avatar` takes keyboard focus only when it is editable (`status="imagePicker"`), so a display
  avatar, such as the one on a remembered-account card, is no longer an empty tab stop.
