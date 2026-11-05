# User guide

The end-user guide for the example app: one page per feature, in the words users see on
screen, which chat agents read to answer "how do I…" questions.

Run `bun run check:user-guide` after you edit a page. The page format, frontmatter, and
writing bar are in the planning plugin's
[user-guide contract](../../plugins/terreno-planning/references/user-guide.md). To draft
pages for features that shipped without one, run the `backfill-user-guide` skill.

## Pages

| Area | Page | Audience | Title |
| --- | --- | --- | --- |
| account | [sign-up.md](account/sign-up.md) | user | Create an account |
| account | [sign-in.md](account/sign-in.md) | user | Sign in |
| account | [reset-password.md](account/reset-password.md) | user | Reset your password |
| account | [verify-email.md](account/verify-email.md) | user | Confirm your email address |
| account | [profile.md](account/profile.md) | user | Update your profile |
| account | [notification-preferences.md](account/notification-preferences.md) | user | Choose how you get notifications |
| admin | [manage-records.md](admin/manage-records.md) | admin | Browse and edit records in the admin panel |
| admin | [set-user-password.md](admin/set-user-password.md) | admin | Set a user's password |
| ai | [chat.md](ai/chat.md) | user | Chat with the AI assistant |
| documents | [files.md](documents/files.md) | user | Store and organize files |
| todos | [manage-todos.md](todos/manage-todos.md) | user | Add, complete, rename, and delete todos |
