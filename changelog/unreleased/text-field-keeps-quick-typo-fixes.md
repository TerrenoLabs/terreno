---
category: Fixed
---

`TextField` and `TextArea` on web no longer drop a typo fix made within half a second. The
oscillation guard used to suppress any change that undid the previous one within 500ms, so
typing a character and backspacing it right away put the character back. Changes the user
types, deletes, pastes, drops or undoes (judged by the DOM input event's `inputType`) now
bypass the guard. Spellcheck replacements, IME composition and changes with no input event
stay guarded.
