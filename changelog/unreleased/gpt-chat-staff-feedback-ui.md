---
category: Changed
---

- `GPTChat` history rows move rename and delete into a three-dot overflow menu. Rename uses an outlined pencil in the dark secondary color; titles truncate before the menu trigger at any sidebar width.
- `GPTChat` shows "Scroll to bottom" only when content sits below the viewport, never in an empty chat.
- The `GPTChat` composer grows with long text up to 200px, then scrolls. `TextField` / `TextArea` accept `maxHeight` to cap `grow`.
- Generated images in `GPTChat` offer copy-image and (web) download. Copying an image-only reply copies the image instead of text.
- `FilePickerButton` opens an anchored dropdown instead of a modal. On web, **Document** now opens the file picker, and both options return `data:` URLs instead of `blob:` URLs.
