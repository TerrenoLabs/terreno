> `const` **SECURITY\_NOTIFICATION\_TEMPLATES**: `Record`\<[`SecurityActionId`](../type-aliases/SecurityActionId.md), [`SecurityMailTemplateId`](../type-aliases/SecurityMailTemplateId.md) \| `null`\>

Which template each security action sends; every action is listed. `null` sends nothing:
`send-password-reset`'s own reset email is the notice, and a second email would be noise.
`issue-sign-in-link` emails the user (who always has an email; the action refuses users
without one) that a link exists, never the link itself.
