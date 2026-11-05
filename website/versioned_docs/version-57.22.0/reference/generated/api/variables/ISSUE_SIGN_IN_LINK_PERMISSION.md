> `const` **ISSUE\_SIGN\_IN\_LINK\_PERMISSION**: `object`

The RBAC statement `issue-sign-in-link` needs on top of `user:manageSecurity` (D11). Only
`superadmin` holds it by default (through `*`); without RBAC the actor needs `admin: true`.

## Type Declaration

### user

> `readonly` **user**: readonly \[`"issueSignInLink"`\]
