---
category: Fixed
---

`SocialLoginButton` now follows later changes to its `loading` prop instead of reading it only on
the first render, so a parent can start or clear the spinner after mount.
